pub mod llm;
pub mod prompts;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveDate, Timelike, Utc};
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
        Err(err) => {
            logger::error(format!("Summary generation error: {err}"));
            vec!["工作总结生成失败".to_string()]
        }
    }
}

/// 分析指定日期：分批读图 → 合并同类项 → 更新任务记忆 → 生成总结，并写入日报表。
pub async fn analyze_daily(
    rt: &Arc<Runtime>,
    date: &str,
) -> Result<Option<DailyAnalysisResult>, String> {
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

    if all_items.is_empty() {
        logger::warn(format!("[DailyAnalyzer] {date} 未识别出任何工作内容"));
        return Ok(None);
    }

    all_items.sort_by(|a, b| a.time_range.cmp(&b.time_range));

    emit_progress(rt, "正在合并同类工作内容...", 0, 0);
    let consolidated = consolidate_work_items(rt, &all_items).await;

    emit_progress(rt, "正在更新任务记忆...", 0, 0);
    update_task_memories(rt, &consolidated, &memories, date).await;

    emit_progress(rt, "正在生成工作总结...", 0, 0);
    let summary = generate_overall_summary(rt, &consolidated, &app_usage).await;

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

    let max_tokens = if is_year { 4000 } else { 2000 };
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

    let categories = value
        .get("work_categories")
        .and_then(|list| list.as_array())
        .map(|list| {
            list.iter()
                .map(|item| {
                    json!({
                        "category": item.get("category").and_then(|v| v.as_str()).unwrap_or(""),
                        "percentage": item.get("percentage").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Some(json!({
        "period": value.get("period").and_then(|v| v.as_str()).unwrap_or(""),
        "highlights": highlights.iter().map(|item| match item {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        }).collect::<Vec<_>>(),
        "work_categories": categories,
        "summary": summary,
    }))
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
        emit_progress(rt, format!("正在补生成 {date}"), index + 1, missing.len());
        match analyze_daily(rt, date).await {
            Ok(Some(_)) => rt.emit("analysis:result", date.clone()),
            Ok(None) => {}
            Err(err) => logger::error(format!("补生成 {date} 失败：{err}")),
        }
    }

    emit_progress(rt, "补生成完成", missing.len(), missing.len());
}

/// 手动补偿分析：补生成所有有截图数据但尚未生成日报的日期。
pub async fn backfill_all(rt: &Arc<Runtime>) -> (usize, usize) {
    let dates = match rt.db.all_dates_with_screenshots() {
        Ok(dates) => dates,
        Err(err) => {
            logger::error(format!("查询截图日期失败：{err}"));
            return (0, 0);
        }
    };

    let existing: HashSet<String> = rt
        .db
        .all_daily_analysis()
        .unwrap_or_default()
        .into_iter()
        .map(|record| record.date)
        .collect();

    let missing = dates
        .into_iter()
        .filter(|date| !existing.contains(date))
        .collect::<Vec<String>>();

    if missing.is_empty() {
        emit_progress(rt, "没有需要补偿分析的日期", 0, 0);
        return (0, 0);
    }

    let total = missing.len();
    let mut succeeded = 0;

    for (index, date) in missing.iter().enumerate() {
        emit_progress(rt, format!("正在补偿分析 {date}"), index + 1, total);
        match analyze_daily(rt, date).await {
            Ok(Some(_)) => {
                succeeded += 1;
                rt.emit("analysis:result", date.clone());
            }
            Ok(None) => {}
            Err(err) => logger::error(format!("补偿分析 {date} 失败：{err}")),
        }
    }

    emit_progress(rt, "补偿分析完成", total, total);
    logger::info(format!(
        "[AnalysisScheduler] 补偿分析完成: {succeeded}/{total} 成功"
    ));

    (total, succeeded)
}

/// 定时任务要总结的日期。
///
/// 凌晨（06:00 前）触发时总结「昨天」：那一刻今天才刚开始，只有 0 点后的零星截图，
/// 直接分析今天会生成一条从 00:00 起、内容残缺的日报，而且因为日报已存在，
/// 第二天也不会被补偿分析重算，于是每天都留着一条错误的凌晨日报。
fn scheduled_target_date(now: DateTime<Local>) -> String {
    if now.hour() < 6 {
        date_string(now.date_naive() - ChronoDuration::days(1))
    } else {
        now.format("%Y-%m-%d").to_string()
    }
}

/// 重算最近 `days` 天内「已有日报」的日期。
///
/// 用于修正历史上按错误时区、或按残缺当日数据生成的日报；今天不重算（数据还没结束）。
pub async fn reanalyze_recent(rt: &Arc<Runtime>, days: i64) -> (usize, usize) {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let start = add_days(&today, -(days.max(1) - 1));

    let mut dates = match rt.db.dates_with_screenshots_in_range(&start, &today) {
        Ok(dates) => dates,
        Err(err) => {
            logger::error(format!("查询待重算日期失败：{err}"));
            return (0, 0);
        }
    };
    dates.retain(|date| date != &today);
    dates.sort();

    let total = dates.len();
    if total == 0 {
        emit_progress(rt, "没有需要重算的日期", 0, 0);
        return (0, 0);
    }

    logger::info(format!(
        "[AnalysisScheduler] 开始重算 {} 天日报: {}",
        total,
        dates.join(", ")
    ));

    let mut succeeded = 0;
    for (index, date) in dates.iter().enumerate() {
        emit_progress(rt, format!("正在重算 {date}"), index + 1, total);
        match analyze_daily(rt, date).await {
            Ok(Some(_)) => {
                succeeded += 1;
                rt.emit("analysis:result", date.clone());
            }
            Ok(None) => {}
            Err(err) => logger::error(format!("重算 {date} 失败：{err}")),
        }
    }

    emit_progress(rt, "重算完成", total, total);
    logger::info(format!(
        "[AnalysisScheduler] 重算完成: {succeeded}/{total} 成功"
    ));

    (total, succeeded)
}

async fn run_scheduled(rt: Arc<Runtime>) {
    if !rt.try_begin_analysis() {
        logger::warn("[AnalysisScheduler] 已有分析任务在执行，跳过本次定时分析");
        return;
    }

    let target = scheduled_target_date(Local::now());
    logger::info(format!("[AnalysisScheduler] 定时触发分析: {target}"));

    match analyze_daily(&rt, &target).await {
        Ok(Some(_)) => rt.emit("analysis:result", target.clone()),
        Ok(None) => {}
        Err(err) => logger::error(format!("定时分析失败：{err}")),
    }

    let start = add_days(&target, -(BACKFILL_DAYS - 1));
    backfill_range(&rt, &start, &target).await;

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

                if now.format("%H:%M").to_string() != schedule_time {
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
