pub mod llm;
pub mod prompts;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, NaiveDate, Timelike, Utc};
use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, GenericImageView};
use serde_json::{json, Value};
use tauri::async_runtime::JoinHandle;

use crate::db::{
    AnalysisProgress, AppUsage, DailyAnalysisResult, Screenshot, TaskMemory, WindowSwitch, WorkItem,
};
use crate::logger;
use crate::runtime::Runtime;

/// 定时触发时自动补生成最近多少天内缺失的日报
const BACKFILL_DAYS: i64 = 30;
const MAX_IMAGE_WIDTH: u32 = 1280;
const JPEG_QUALITY: u8 = 80;

/// 用户主动取消分析时的统一错误文案，调用方据此与真实失败区分。
pub const CANCELLED: &str = "分析已取消";

pub fn is_cancelled_error(message: &str) -> bool {
    message == CANCELLED
}

fn emit_progress(rt: &Runtime, step: impl Into<String>, current: usize, total: usize) {
    rt.emit(
        "analysis:status",
        AnalysisProgress {
            step: step.into(),
            current,
            total,
        },
    );
}

/// 数据库时间戳按 UTC 存储（默认值 `strftime('%Y-%m-%dT%H:%M:%f','now')`），
/// 解析后需要换算成本地时间再使用，否则日报里的时间段会比实际早一个时区偏移。
fn parse_db_timestamp(timestamp: &str) -> Option<DateTime<Local>> {
    if let Ok(datetime) = DateTime::parse_from_rfc3339(timestamp) {
        return Some(datetime.with_timezone(&Local));
    }

    const FORMATS: [&str; 4] = [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ];

    FORMATS.iter().find_map(|format| {
        chrono::NaiveDateTime::parse_from_str(timestamp, format)
            .ok()
            .map(|naive| DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc).with_timezone(&Local))
    })
}

fn hhmm(timestamp: &str) -> String {
    parse_db_timestamp(timestamp)
        .map(|datetime| datetime.format("%H:%M").to_string())
        .unwrap_or_else(|| "00:00".to_string())
}

fn parse_work_item(value: &Value) -> WorkItem {
    fn text(value: Option<&Value>, fallback: &str) -> String {
        match value {
            Some(Value::String(text)) => text.clone(),
            Some(Value::Number(number)) => number.to_string(),
            Some(Value::Bool(flag)) => flag.to_string(),
            _ => fallback.to_string(),
        }
    }

    WorkItem {
        time_range: text(value.get("time_range"), ""),
        activity: text(value.get("activity"), ""),
        app: text(value.get("app"), ""),
        category: text(value.get("category"), "其他"),
    }
}

/// 从模型输出中截取第一个 `{` 到最后一个 `}`（对应旧版正则 `/\{[\s\S]*\}/`）
fn extract_object(content: &str) -> Option<&str> {
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    if end > start {
        Some(&content[start..=end])
    } else {
        None
    }
}

fn extract_array(content: &str) -> Option<&str> {
    let start = content.find('[')?;
    let end = content.rfind(']')?;
    if end > start {
        Some(&content[start..=end])
    } else {
        None
    }
}

fn parse_analysis_result(content: &str) -> Option<DailyAnalysisResult> {
    let value: Value = serde_json::from_str(extract_object(content)?).ok()?;
    let items = value.get("work_items")?.as_array()?;

    let summary = match value.get("summary")? {
        Value::Array(list) => list
            .iter()
            .map(|item| match item {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>(),
        Value::String(text) => vec![text.clone()],
        _ => return None,
    };

    Some(DailyAnalysisResult {
        work_items: items.iter().map(parse_work_item).collect(),
        summary,
    })
}

fn create_batches(
    screenshots: &[Screenshot],
    gap_threshold_minutes: i64,
    max_per_batch: usize,
) -> Vec<Vec<Screenshot>> {
    if screenshots.is_empty() {
        return Vec::new();
    }

    let gap_ms = gap_threshold_minutes.max(1) * 60_000;
    let mut raw: Vec<Vec<Screenshot>> = Vec::new();
    let mut current: Vec<Screenshot> = vec![screenshots[0].clone()];

    for window in screenshots.windows(2) {
        let previous = parse_timestamp(&window[0].timestamp);
        let next = parse_timestamp(&window[1].timestamp);
        let gap = next - previous;

        if gap > gap_ms {
            raw.push(current);
            current = vec![window[1].clone()];
        } else {
            current.push(window[1].clone());
        }
    }
    raw.push(current);

    let mut batches = Vec::new();
    for batch in raw {
        batches.extend(split_oversized(batch, max_per_batch.max(1)));
    }
    batches
}

/// 数据库里的时间戳是 `YYYY-MM-DDTHH:MM:SS.SSS`（无时区后缀），
/// 直接用 `parse_from_rfc3339` 会全部解析失败并退化成 0，
/// 导致批次间隔判断失效、整天截图被合并成一批。
fn parse_timestamp(timestamp: &str) -> i64 {
    parse_db_timestamp(timestamp)
        .map(|datetime| datetime.timestamp_millis())
        .unwrap_or(0)
}

fn split_oversized(mut batch: Vec<Screenshot>, max_per_batch: usize) -> Vec<Vec<Screenshot>> {
    if batch.len() <= max_per_batch {
        return vec![batch];
    }

    let mut max_gap = 0;
    let mut split_index: Option<usize> = None;

    for index in 1..batch.len() {
        let gap =
            parse_timestamp(&batch[index].timestamp) - parse_timestamp(&batch[index - 1].timestamp);
        if gap > max_gap {
            max_gap = gap;
            split_index = Some(index);
        }
    }

    let split_index = match split_index {
        Some(index) if max_gap > 0 => index,
        _ => (batch.len() + 1) / 2,
    };

    let right = batch.split_off(split_index);
    let left = batch;

    let mut result = split_oversized(left, max_per_batch);
    result.extend(split_oversized(right, max_per_batch));
    result
}

/// 返回 `(原始下标, base64)`，丢弃编码失败的截图时仍能对上它的时间戳。
fn prepare_images(rt: &Runtime, screenshots: &[Screenshot]) -> Vec<(usize, String)> {
    let dir = rt.screenshots_dir();
    let mut results = Vec::new();

    for (index, shot) in screenshots.iter().enumerate() {
        let path = dir.join(&shot.file_path);
        let image = match image::open(&path) {
            Ok(image) => image,
            Err(err) => {
                logger::warn(format!("跳过无法读取的截图 {}: {err}", path.display()));
                continue;
            }
        };

        let (width, height) = image.dimensions();
        if width == 0 || height == 0 {
            continue;
        }

        let resized = if width > MAX_IMAGE_WIDTH {
            image.resize(
                MAX_IMAGE_WIDTH,
                u32::MAX / 2,
                image::imageops::FilterType::Triangle,
            )
        } else {
            image
        };

        let rgb = resized.to_rgb8();
        let mut buffer = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut buffer, JPEG_QUALITY);
        if encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ExtendedColorType::Rgb8,
            )
            .is_err()
        {
            continue;
        }

        let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer);
        if encoded.len() < 100 {
            continue;
        }

        results.push((index, encoded));
    }

    results
}

async fn analyze_batch(
    rt: &Arc<Runtime>,
    screenshots: &[Screenshot],
    app_usage: &[AppUsage],
    prior_work_items: &[WorkItem],
    window_sequence: &[WindowSwitch],
    task_memories: &[TaskMemory],
) -> Option<DailyAnalysisResult> {
    if screenshots.is_empty() {
        return None;
    }

    let images = prepare_images(rt, screenshots);
    let start = hhmm(&screenshots[0].timestamp);
    let end = hhmm(&screenshots[screenshots.len() - 1].timestamp);
    // 图片顺序与这里的时间点一一对应，模型据此判断每张截图的时刻
    let screenshot_times = images
        .iter()
        .map(|(index, _)| hhmm(&screenshots[*index].timestamp))
        .collect::<Vec<_>>();

    logger::info(format!(
        "[DailyAnalyzer] 调用 AI 分析批次: {} 张截图, {} 张已编码, 时间 {start}-{end}",
        screenshots.len(),
        images.len()
    ));

    let prompt = prompts::build_daily_analysis_prompt(
        app_usage,
        (&start, &end),
        &screenshot_times,
        prior_work_items,
        window_sequence,
        task_memories,
    );

    let mut content = vec![json!({ "type": "text", "text": prompt })];
    for (_, image) in images {
        content.push(json!({
            "type": "image_url",
            "image_url": { "url": format!("data:image/jpeg;base64,{image}"), "detail": "low" }
        }));
    }

    match llm::chat(rt, Value::Array(content), 2000, "analyzeBatch").await {
        Ok(text) => {
            logger::info(format!(
                "[DailyAnalyzer] AI 分析批次完成，响应长度: {} 字符",
                text.chars().count()
            ));
            parse_analysis_result(&text)
        }
        Err(err) if is_cancelled_error(&err) => None,
        Err(err) => {
            logger::error(format!("AI analysis batch error: {err}"));
            None
        }
    }
}

async fn consolidate_work_items(rt: &Arc<Runtime>, items: &[WorkItem]) -> Vec<WorkItem> {
    if items.len() <= 1 {
        return items.to_vec();
    }

    let prompt = prompts::build_consolidation_prompt(items);
    match llm::chat(rt, Value::String(prompt), 2000, "consolidateWorkItems").await {
        Ok(text) => {
            let Some(json) = extract_object(&text) else {
                return items.to_vec();
            };
            let Ok(value) = serde_json::from_str::<Value>(json) else {
                return items.to_vec();
            };
            let Some(list) = value.get("work_items").and_then(|items| items.as_array()) else {
                logger::warn("[DailyAnalyzer] AI 合并结果格式无效");
                return items.to_vec();
            };

            let merged = list.iter().map(parse_work_item).collect::<Vec<_>>();
            logger::info(format!(
                "[DailyAnalyzer] AI 合并完成: {} -> {} 个工作项",
                items.len(),
                merged.len()
            ));
            merged
        }
        Err(err) if is_cancelled_error(&err) => items.to_vec(),
        Err(err) => {
            logger::error(format!("Work items consolidation error: {err}"));
            items.to_vec()
        }
    }
}

async fn update_task_memories(
    rt: &Arc<Runtime>,
    work_items: &[WorkItem],
    memories: &[TaskMemory],
    date: &str,
) {
    if work_items.is_empty() {
        return;
    }

    let prompt = prompts::build_task_memory_update_prompt(work_items, memories);
    let text = match llm::chat(rt, Value::String(prompt), 1500, "updateTaskMemories").await {
        Ok(text) => text,
        Err(err) if is_cancelled_error(&err) => return,
        Err(err) => {
            logger::error(format!("Task memory update error: {err}"));
            return;
        }
    };

    let Some(json) = extract_object(&text) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<Value>(json) else {
        return;
    };
    let Some(updates) = value.get("task_updates").and_then(|items| items.as_array()) else {
        logger::warn("[DailyAnalyzer] 任务记忆更新: AI 返回格式无效");
        return;
    };

    let last_time = work_items
        .last()
        .map(|item| {
            item.time_range
                .split('-')
                .nth(1)
                .unwrap_or("23:59")
                .to_string()
        })
        .unwrap_or_else(|| "23:59".to_string());

    for update in updates {
        let action = update.get("action").and_then(|v| v.as_str()).unwrap_or("");
        let summary = update
            .get("task_summary")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let category = update
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("其他");
        let apps = update
            .get("app_cluster")
            .and_then(|v| v.as_array())
            .map(|list| {
                list.iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let duration = update
            .get("duration_ms")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        match action {
            "continue" => {
                if let Some(id) = update.get("memory_id").and_then(|v| v.as_i64()) {
                    if let Err(err) = rt.db.update_task_memory(id, date, &last_time, duration) {
                        logger::error(format!("更新任务记忆失败：{err}"));
                    } else {
                        logger::info(format!("[DailyAnalyzer] 更新任务记忆 #{id}: {summary}"));
                    }
                }
            }
            "new" => {
                if !summary.is_empty() {
                    if let Err(err) = rt
                        .db
                        .insert_task_memory(summary, category, &apps, date, &last_time, duration)
                    {
                        logger::error(format!("新增任务记忆失败：{err}"));
                    } else {
                        logger::info(format!("[DailyAnalyzer] 新增任务记忆: {summary}"));
                    }
                }
            }
            _ => {}
        }
    }

    let days = rt.config.analysis().task_memory_days;
    let _ = rt.db.expire_stale_task_memories(days);
}

async fn generate_overall_summary(
    rt: &Arc<Runtime>,
    work_items: &[WorkItem],
    app_usage: &[AppUsage],
) -> Vec<String> {
    let prompt = prompts::build_summary_prompt(work_items, app_usage);
    match llm::chat(rt, Value::String(prompt), 500, "generateOverallSummary").await {
        Ok(text) => {
            logger::info(format!(
                "[DailyAnalyzer] AI 工作总结生成完成，响应长度: {} 字符",
                text.chars().count()
            ));
            let Some(json) = extract_array(&text) else {
                return vec!["无法生成工作总结".to_string()];
            };
            match serde_json::from_str::<Value>(json) {
                Ok(Value::Array(list)) => list
                    .iter()
                    .map(|item| match item {
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    })
                    .collect(),
                _ => vec!["无法生成工作总结".to_string()],
            }
        }
        Err(err) if is_cancelled_error(&err) => Vec::new(),
        Err(err) => {
            logger::error(format!("Summary generation error: {err}"));
            vec!["工作总结生成失败".to_string()]
        }
    }
}

/// 取消检查点：分析只在这些位置退出，不会写入半成品日报。
fn ensure_running(rt: &Runtime, label: &str) -> Result<(), String> {
    if rt.is_cancelled() {
        logger::info(format!("[DailyAnalyzer] {label} 已取消，停止后续步骤"));
        return Err(CANCELLED.to_string());
    }
    Ok(())
}

/// 分析指定日期：分批读图 → 合并同类项 → 更新任务记忆 → 生成总结，并写入日报表。
pub async fn analyze_daily(
    rt: &Arc<Runtime>,
    date: &str,
) -> Result<Option<DailyAnalysisResult>, String> {
    ensure_running(rt, date)?;

    let mut screenshots = rt.db.screenshots_by_date(date)?;
    if screenshots.is_empty() {
        logger::info(format!("[DailyAnalyzer] {date} 无截图数据，跳过分析"));
        return Ok(None);
    }

    emit_progress(rt, "获取截图数据", 0, 0);

    screenshots.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    let app_usage = rt.db.app_usage_by_date(date)?;
    let config = rt.config.analysis();

    let batches = create_batches(
        &screenshots,
        config.gap_threshold_minutes,
        config.max_screenshots_per_batch,
    );
    let memories = rt.db.active_task_memories(config.task_memory_days)?;

    logger::info(format!(
        "[DailyAnalyzer] 开始分析 {date}，共 {} 张截图，分为 {} 批，模型: {}，活跃任务记忆: {} 条",
        screenshots.len(),
        batches.len(),
        config.model,
        memories.len()
    ));

    emit_progress(
        rt,
        format!(
            "已准备 {} 张截图，分为 {} 批",
            screenshots.len(),
            batches.len()
        ),
        0,
        0,
    );

    let mut all_items: Vec<WorkItem> = Vec::new();

    for (index, batch) in batches.iter().enumerate() {
        ensure_running(rt, date)?;

        emit_progress(
            rt,
            format!("正在分析第 {}/{} 批...", index + 1, batches.len()),
            index + 1,
            batches.len(),
        );

        let (start, end) = match (batch.first(), batch.last()) {
            (Some(first), Some(last)) => (first.timestamp.clone(), last.timestamp.clone()),
            _ => continue,
        };

        let batch_usage = rt.db.app_usage_by_range(&start, &end)?;
        let batch_windows = rt.db.window_switch_sequence(&start, &end)?;
        let prior = if index > 0 {
            all_items.clone()
        } else {
            Vec::new()
        };

        if let Some(result) =
            analyze_batch(rt, batch, &batch_usage, &prior, &batch_windows, &memories).await
        {
            all_items.extend(result.work_items);
        }
    }

    ensure_running(rt, date)?;

    if all_items.is_empty() {
        logger::warn(format!("[DailyAnalyzer] {date} 未识别出任何工作内容"));
        return Ok(None);
    }

    all_items.sort_by(|a, b| a.time_range.cmp(&b.time_range));

    emit_progress(rt, "正在合并同类工作内容...", 0, 0);
    let consolidated = consolidate_work_items(rt, &all_items).await;
    ensure_running(rt, date)?;

    emit_progress(rt, "正在更新任务记忆...", 0, 0);
    update_task_memories(rt, &consolidated, &memories, date).await;
    ensure_running(rt, date)?;

    emit_progress(rt, "正在生成工作总结...", 0, 0);
    let summary = generate_overall_summary(rt, &consolidated, &app_usage).await;

    // 最后一道检查：取消时不落库，保留该日期原有的日报
    ensure_running(rt, date)?;

    let result = DailyAnalysisResult {
        work_items: consolidated,
        summary,
    };

    let json = serde_json::to_string(&result).map_err(|e| e.to_string())?;
    rt.db.upsert_daily_analysis(date, &json)?;

    logger::info(format!(
        "[DailyAnalyzer] {date} 分析完成: {} 个工作项, {} 条总结",
        result.work_items.len(),
        result.summary.len()
    ));

    Ok(Some(result))
}

fn daily_pairs(
    rt: &Arc<Runtime>,
    start: &str,
    end: &str,
) -> Result<Vec<(String, Vec<String>)>, String> {
    let records = rt.db.daily_analysis_in_range(start, end)?;
    Ok(records
        .into_iter()
        .map(|record| {
            let value: Value = serde_json::from_str(&record.result_json).unwrap_or(Value::Null);
            let summary = match value.get("summary") {
                Some(Value::Array(list)) => list
                    .iter()
                    .map(|item| match item {
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    })
                    .collect::<Vec<_>>(),
                Some(Value::String(text)) => vec![text.clone()],
                _ => Vec::new(),
            };
            (record.date, summary)
        })
        .collect())
}

pub async fn generate_quarterly(
    rt: &Arc<Runtime>,
    year: i32,
    quarter: u32,
) -> Result<bool, String> {
    let start_month = (quarter.saturating_sub(1)) * 3 + 1;
    let start = NaiveDate::from_ymd_opt(year, start_month, 1)
        .ok_or_else(|| "季度起始日期非法".to_string())?;
    let next_quarter_start = if quarter >= 4 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, start_month + 3, 1)
    }
    .ok_or_else(|| "季度结束日期非法".to_string())?;
    let end = next_quarter_start - ChronoDuration::days(1);

    let period_label = format!("{year}-Q{quarter}");
    generate_periodic(rt, "quarter", &period_label, start, end).await
}

pub async fn generate_yearly(rt: &Arc<Runtime>, year: i32) -> Result<bool, String> {
    let start =
        NaiveDate::from_ymd_opt(year, 1, 1).ok_or_else(|| "年度起始日期非法".to_string())?;
    let end =
        NaiveDate::from_ymd_opt(year, 12, 31).ok_or_else(|| "年度结束日期非法".to_string())?;
    let period_label = year.to_string();
    generate_periodic(rt, "year", &period_label, start, end).await
}

async fn generate_periodic(
    rt: &Arc<Runtime>,
    period_type: &str,
    period_label: &str,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<bool, String> {
    let pairs = daily_pairs(rt, &start.to_string(), &end.to_string())?;
    if pairs.is_empty() {
        logger::info(format!(
            "[SummaryGenerator] {period_label} 无日报数据，跳过生成"
        ));
        return Ok(false);
    }

    logger::info(format!(
        "[SummaryGenerator] 开始生成 {period_label} 总结，共 {} 天数据",
        pairs.len()
    ));

    let is_year = period_type == "year";
    let prompt = if is_year {
        prompts::build_yearly_summary_prompt(&pairs, period_label)
    } else {
        prompts::build_periodic_summary_prompt(&pairs, period_type, period_label)
    };

    // 季度汇总包含概述、亮点、分类占比、问题不足与改进计划，输出较长，留足 token
    let max_tokens = if is_year { 4000 } else { 3000 };
    let label = if is_year {
        "generateYearly"
    } else {
        "generateQuarterly"
    };

    let text = llm::chat(rt, Value::String(prompt), max_tokens, label).await?;
    let json = extract_object(&text).ok_or_else(|| "模型未返回 JSON".to_string())?;
    let value: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;

    let normalized = if is_year {
        normalize_yearly(&value).ok_or_else(|| "年度总结结果格式无效".to_string())?
    } else {
        normalize_periodic(&value).ok_or_else(|| "季度总结结果格式无效".to_string())?
    };

    rt.db
        .upsert_periodic_summary(period_type, period_label, &normalized.to_string())?;

    logger::info(format!("[SummaryGenerator] {period_label} 总结生成完成"));
    Ok(true)
}

fn normalize_periodic(value: &Value) -> Option<Value> {
    let highlights = value.get("highlights")?.as_array()?;
    let summary = value.get("summary")?.as_str()?;

    Some(json!({
        "period": value.get("period").and_then(|v| v.as_str()).unwrap_or(""),
        "highlights": highlights.iter().map(|item| match item {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        }).collect::<Vec<_>>(),
        "problems": string_list(value.get("problems")),
        "improvements": string_list(value.get("improvements")),
        "summary": summary,
    }))
}

/// 把模型返回的字符串数组字段归一化为 `Vec<String>`；缺失或类型异常时返回空数组。
fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|list| list.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|item| match item {
                    Value::String(text) => {
                        let trimmed = text.trim();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed.to_string())
                        }
                    }
                    Value::Null => None,
                    other => Some(other.to_string()),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn normalize_yearly(value: &Value) -> Option<Value> {
    let opening = value.get("opening")?.as_str()?;
    let summary = value.get("summary")?.as_str()?;
    let categories = value.get("categories")?.as_array()?;

    let normalized = categories
        .iter()
        .map(|category| {
            let items = category
                .get("items")
                .and_then(|list| list.as_array())
                .map(|list| {
                    list.iter()
                        .map(|item| {
                            json!({
                                "subtitle": item.get("subtitle").and_then(|v| v.as_str()).unwrap_or(""),
                                "description": item.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            json!({
                "title": category.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "items": items,
            })
        })
        .collect::<Vec<_>>();

    Some(json!({
        "period": value.get("period").and_then(|v| v.as_str()).unwrap_or(""),
        "opening": opening,
        "categories": normalized,
        "summary": summary,
    }))
}

fn date_string(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn add_days(date: &str, days: i64) -> String {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|date| date_string(date + ChronoDuration::days(days)))
        .unwrap_or_else(|_| date.to_string())
}

/// 补生成指定区间内「有截图但无日报」的日期。
async fn backfill_range(rt: &Arc<Runtime>, start: &str, end: &str) {
    let with_data: HashSet<String> = match rt.db.dates_with_screenshots_in_range(start, end) {
        Ok(dates) => dates.into_iter().collect(),
        Err(err) => {
            logger::error(format!("查询截图日期失败：{err}"));
            return;
        }
    };

    let existing: HashSet<String> = match rt.db.daily_analysis_in_range(start, end) {
        Ok(records) => records.into_iter().map(|record| record.date).collect(),
        Err(err) => {
            logger::error(format!("查询日报失败：{err}"));
            return;
        }
    };

    let mut missing = with_data
        .difference(&existing)
        .cloned()
        .collect::<Vec<String>>();
    missing.sort();

    if missing.is_empty() {
        logger::info("[AnalysisScheduler] 没有需要补生成的日报");
        return;
    }

    logger::info(format!(
        "[AnalysisScheduler] 检测到 {} 天缺失日报，开始补生成: {}",
        missing.len(),
        missing.join(", ")
    ));

    for (index, date) in missing.iter().enumerate() {
        if rt.is_cancelled() {
            logger::info("[AnalysisScheduler] 补生成已取消");
            return;
        }

        emit_progress(rt, format!("正在补生成 {date}"), index + 1, missing.len());
        match analyze_daily(rt, date).await {
            Ok(Some(_)) => rt.emit("analysis:result", date.clone()),
            Ok(None) => {}
            Err(err) if is_cancelled_error(&err) => return,
            Err(err) => logger::error(format!("补生成 {date} 失败：{err}")),
        }
    }

    emit_progress(rt, "补生成完成", missing.len(), missing.len());
}

/// 批量补算/重算的结果。
pub struct RerunOutcome {
    /// 参与处理的日期数
    pub total: usize,
    /// 成功生成日报的日期数
    pub succeeded: usize,
    /// 其中原本没有日报、本次补上的日期数（其余为覆盖重写）
    pub filled: usize,
    /// 用户中途取消（已完成的日期仍然有效）
    pub cancelled: bool,
}

/// 批量补算/重算日报。
///
/// - `days = Some(n)`：只看今天之前的最近 n 天；`None`：全部有截图的历史日期。
/// - 范围内「有截图」的日期都会被处理：缺失日报的直接补上，已有日报的覆盖重写。
/// - 始终排除今天：当天数据还没结束，提前生成只会留下一条内容残缺的日报。
pub async fn rerun_daily(rt: &Arc<Runtime>, days: Option<i64>) -> RerunOutcome {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let yesterday = add_days(&today, -1);

    let queried = match days {
        Some(days) => {
            let start = add_days(&today, -days.max(1));
            rt.db.dates_with_screenshots_in_range(&start, &yesterday)
        }
        None => rt.db.all_dates_with_screenshots(),
    };

    let mut dates = match queried {
        Ok(dates) => dates,
        Err(err) => {
            logger::error(format!("查询待处理日期失败：{err}"));
            return RerunOutcome {
                total: 0,
                succeeded: 0,
                filled: 0,
                cancelled: false,
            };
        }
    };

    dates.retain(|date| date.as_str() < today.as_str());
    dates.sort();
    dates.dedup();

    if dates.is_empty() {
        emit_progress(rt, "没有需要处理的日期", 0, 0);
        return RerunOutcome {
            total: 0,
            succeeded: 0,
            filled: 0,
            cancelled: false,
        };
    }

    let existing: HashSet<String> = rt
        .db
        .all_daily_analysis()
        .unwrap_or_default()
        .into_iter()
        .map(|record| record.date)
        .collect();

    let total = dates.len();
    let filled = dates
        .iter()
        .filter(|date| !existing.contains(*date))
        .count();

    logger::info(format!(
        "[AnalysisScheduler] 开始处理 {} 天日报（补算 {filled} 天，重写 {} 天）: {}",
        total,
        total - filled,
        dates.join(", ")
    ));

    let mut succeeded = 0;
    let mut cancelled = false;
    for (index, date) in dates.iter().enumerate() {
        if rt.is_cancelled() {
            cancelled = true;
            break;
        }

        let action = if existing.contains(date) { "重算" } else { "补算" };
        emit_progress(rt, format!("正在{action} {date}"), index + 1, total);
        match analyze_daily(rt, date).await {
            Ok(Some(_)) => {
                succeeded += 1;
                rt.emit("analysis:result", date.clone());
            }
            Ok(None) => {}
            Err(err) if is_cancelled_error(&err) => {
                cancelled = true;
                break;
            }
            Err(err) => logger::error(format!("{action} {date} 失败：{err}")),
        }
    }

    if cancelled {
        emit_progress(rt, "已取消，保留已完成的日报", succeeded, total);
        logger::info(format!(
            "[AnalysisScheduler] 补算已取消: 已完成 {succeeded}/{total} 天"
        ));
    } else {
        emit_progress(rt, "补算完成", total, total);
        logger::info(format!(
            "[AnalysisScheduler] 补算完成: {succeeded}/{total} 成功（补算 {filled} 天，重写 {} 天）",
            total - filled
        ));
    }

    RerunOutcome {
        total,
        succeeded,
        filled,
        cancelled,
    }
}

/// 自动模式下，早于这个小时触发的定时任务总结「昨天」。
///
/// 凌晨触发时那一刻今天才刚开始，只有 0 点后的零星截图，直接分析今天会生成一条
/// 从 00:00 起、内容残缺的日报；而且因为日报已存在，第二天的批量补算也只会覆盖它
/// 而不是重头分析，于是每天都留着一条错误的凌晨日报。
const AUTO_PREVIOUS_DAY_HOUR: u32 = 6;

/// 定时任务要总结的日期，由配置的 `scheduleDateMode` 决定：
///
/// - `today`：总是总结当天（适合晚间触发，如 23:00）
/// - `previous`：总是总结前一天（适合凌晨触发，如 01:30）
/// - 其他（`auto` / 非法值）：沿用时间规则，早于 06:00 触发时总结昨天
fn scheduled_target_date(now: DateTime<Local>, mode: &str) -> String {
    let today = now.date_naive();
    let target = match mode {
        "today" => today,
        "previous" => today - ChronoDuration::days(1),
        _ => {
            if now.hour() < AUTO_PREVIOUS_DAY_HOUR {
                today - ChronoDuration::days(1)
            } else {
                today
            }
        }
    };
    date_string(target)
}

/// 把配置里的时间规整成 `HH:MM`。
///
/// 手输的 `9:00`、带空格的 ` 09:00 ` 都等价于 `09:00`，否则字符串比较永远对不上，
/// 定时任务会静默不触发。非法值原样返回，交给调用方按「不匹配」处理。
fn normalize_hhmm(value: &str) -> String {
    let trimmed = value.trim();
    let mut parts = trimmed.split(':');
    let (hour, minute) = match (parts.next(), parts.next()) {
        (Some(hour), Some(minute)) => (hour, minute),
        _ => return trimmed.to_string(),
    };

    match (hour.parse::<u32>(), minute.parse::<u32>()) {
        (Ok(hour), Ok(minute)) if hour < 24 && minute < 60 => format!("{hour:02}:{minute:02}"),
        _ => trimmed.to_string(),
    }
}

/// 最近一个已经结束的季度，返回 `(年, 季度)`。
///
/// 2026-11-02 落在 Q4 里，返回 `(2026, 3)`；2026-01-01 落在 Q1 第一天，
/// 此时刚结束的是上一年的 Q4，返回 `(2025, 4)`。
fn last_finished_quarter(today: NaiveDate) -> (i32, u32) {
    let current_index = today.month0() / 3;
    let prev_index = (current_index + 3) % 4;
    let year = if current_index == 0 {
        today.year() - 1
    } else {
        today.year()
    };
    (year, prev_index + 1)
}

fn has_periodic_summary(rt: &Runtime, period_type: &str, period_label: &str) -> bool {
    matches!(
        rt.db.periodic_summary(period_type, period_label),
        Ok(Some(_))
    )
}

/// 定时任务末尾的周期汇总：日报补齐后，为「最近一个已结束的季度/年度」生成汇总。
///
/// 幂等：已存在汇总、或该周期没有任何日报时直接跳过，所以每天触发一次也不会重复调用模型；
/// 季末/年末那天恰好没开机时，下次定时任务仍会补上，不会永久漏掉。
async fn generate_finished_periods(rt: &Arc<Runtime>) {
    let config = rt.config.analysis();
    let today = Local::now().date_naive();

    if config.auto_quarterly {
        let (year, quarter) = last_finished_quarter(today);
        let label = format!("{year}-Q{quarter}");

        if has_periodic_summary(rt, "quarter", &label) {
            logger::info(format!("[AnalysisScheduler] {label} 季度汇总已存在，跳过"));
        } else {
            emit_progress(rt, format!("正在生成 {label} 季度汇总"), 1, 1);
            match generate_quarterly(rt, year, quarter).await {
                Ok(true) => {
                    logger::info(format!("[AnalysisScheduler] 自动生成 {label} 季度汇总完成"));
                    rt.emit("summary:result", label.clone());
                }
                Ok(false) => logger::info(format!(
                    "[AnalysisScheduler] {label} 没有日报数据，跳过季度自动汇总"
                )),
                Err(err) => logger::error(format!(
                    "[AnalysisScheduler] 自动生成 {label} 季度汇总失败：{err}"
                )),
            }
        }
    }

    if config.auto_yearly {
        let year = today.year() - 1;
        let label = year.to_string();

        if has_periodic_summary(rt, "year", &label) {
            logger::info(format!("[AnalysisScheduler] {label} 年度汇总已存在，跳过"));
        } else {
            emit_progress(rt, format!("正在生成 {label} 年度汇总"), 1, 1);
            match generate_yearly(rt, year).await {
                Ok(true) => {
                    logger::info(format!("[AnalysisScheduler] 自动生成 {label} 年度汇总完成"));
                    rt.emit("summary:result", label.clone());
                }
                Ok(false) => logger::info(format!(
                    "[AnalysisScheduler] {label} 没有日报数据，跳过年度自动汇总"
                )),
                Err(err) => logger::error(format!(
                    "[AnalysisScheduler] 自动生成 {label} 年度汇总失败：{err}"
                )),
            }
        }
    }
}

async fn run_scheduled(rt: Arc<Runtime>) {
    let config = rt.config.analysis();
    let target = scheduled_target_date(Local::now(), &config.schedule_date_mode);

    if !rt.begin_analysis("scheduled", &target) {
        logger::warn("[AnalysisScheduler] 已有分析任务在执行，跳过本次定时分析");
        return;
    }

    logger::info(format!(
        "[AnalysisScheduler] 定时触发分析: {target}（日期模式 {}）",
        config.schedule_date_mode
    ));

    match analyze_daily(&rt, &target).await {
        Ok(Some(_)) => rt.emit("analysis:result", target.clone()),
        Ok(None) => {}
        Err(err) if is_cancelled_error(&err) => {
            logger::info("[AnalysisScheduler] 定时分析已取消，跳过补生成与汇总");
            rt.end_analysis();
            return;
        }
        Err(err) => logger::error(format!("定时分析失败：{err}")),
    }

    if !rt.is_cancelled() {
        let start = add_days(&target, -(BACKFILL_DAYS - 1));
        backfill_range(&rt, &start, &target).await;
    }

    // 日报补齐之后再看季度/年度是否该出汇总，保证汇总读到的日报是完整的
    if !rt.is_cancelled() {
        generate_finished_periods(&rt).await;
    } else {
        logger::info("[AnalysisScheduler] 已取消，跳过自动汇总");
    }

    rt.end_analysis();
}

pub struct Scheduler {
    rt: Arc<Runtime>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl Scheduler {
    pub fn new(rt: Arc<Runtime>) -> Self {
        Self {
            rt,
            handle: Mutex::new(None),
        }
    }

    pub fn start(&self) {
        let rt = self.rt.clone();
        let handle = tauri::async_runtime::spawn(async move {
            let mut last_triggered = String::new();

            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;

                let schedule_time = rt.config.analysis().schedule_time;
                let now = Local::now();
                let now_key = now.format("%Y-%m-%d %H:%M").to_string();

                if now.format("%H:%M").to_string() != normalize_hhmm(&schedule_time) {
                    continue;
                }
                if last_triggered == now_key {
                    continue;
                }
                last_triggered = now_key;

                let task_rt = rt.clone();
                tauri::async_runtime::spawn(async move {
                    run_scheduled(task_rt).await;
                });
            }
        });

        *self.handle.lock().unwrap() = Some(handle);
    }

    pub fn stop(&self) {
        if let Some(handle) = self.handle.lock().unwrap().take() {
            handle.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn local_at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .single()
            .expect("测试时间应当合法且无歧义")
    }

    fn target_of(year: i32, month: u32, day: u32, hour: u32, mode: &str) -> String {
        scheduled_target_date(local_at(year, month, day, hour, 0), mode)
    }

    #[test]
    fn auto_mode_rolls_back_only_before_six() {
        // 06:00 是分界：之前总结昨天，之后总结当天
        assert_eq!(target_of(2026, 11, 3, 5, "auto"), "2026-11-02");
        assert_eq!(target_of(2026, 11, 3, 6, "auto"), "2026-11-03");
        assert_eq!(target_of(2026, 11, 3, 23, "auto"), "2026-11-03");

        // 跨年时回退到上一年最后一天
        assert_eq!(target_of(2026, 1, 1, 0, "auto"), "2025-12-31");

        // 未知/空值退回自动模式，不能因为手改配置就瘫掉
        assert_eq!(target_of(2026, 11, 3, 1, ""), "2026-11-02");
        assert_eq!(target_of(2026, 11, 3, 1, "yesterday"), "2026-11-02");
    }

    #[test]
    fn explicit_modes_ignore_clock() {
        // today：凌晨触发也分析当天
        assert_eq!(target_of(2026, 11, 3, 1, "today"), "2026-11-03");
        assert_eq!(target_of(2026, 11, 3, 23, "today"), "2026-11-03");

        // previous：晚间触发也分析前一天
        assert_eq!(target_of(2026, 11, 3, 23, "previous"), "2026-11-02");
        assert_eq!(target_of(2026, 3, 1, 1, "previous"), "2026-02-28");
    }

    #[test]
    fn hhmm_input_is_normalized_before_comparing() {
        assert_eq!(normalize_hhmm("9:00"), "09:00");
        assert_eq!(normalize_hhmm(" 23:05 "), "23:05");
        assert_eq!(normalize_hhmm("00:00"), "00:00");

        // 非法值原样返回，由调用方判定为不匹配
        assert_eq!(normalize_hhmm("24:00"), "24:00");
        assert_eq!(normalize_hhmm("晚上八点"), "晚上八点");
        assert_eq!(normalize_hhmm(""), "");
    }

    fn finished_quarter_of(year: i32, month: u32, day: u32) -> (i32, u32) {
        last_finished_quarter(NaiveDate::from_ymd_opt(year, month, day).expect("测试日期应当合法"))
    }

    #[test]
    fn last_finished_quarter_skips_current_quarter() {
        // 季度第一天：刚结束的是上一个季度，跨年时归属上一年
        assert_eq!(finished_quarter_of(2026, 1, 1), (2025, 4));
        assert_eq!(finished_quarter_of(2026, 4, 1), (2026, 1));
        assert_eq!(finished_quarter_of(2026, 7, 1), (2026, 2));
        assert_eq!(finished_quarter_of(2026, 10, 1), (2026, 3));

        // 季度中段与最后一天，指向的都是刚结束的那个季度
        assert_eq!(finished_quarter_of(2026, 3, 31), (2025, 4));
        assert_eq!(finished_quarter_of(2026, 11, 2), (2026, 3));
        assert_eq!(finished_quarter_of(2026, 12, 31), (2026, 3));
    }
}
