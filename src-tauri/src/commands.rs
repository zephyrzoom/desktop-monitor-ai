use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::analyzer;
use crate::db::{ActiveWindow, DailyAnalysis, MonitorStatus, PeriodicSummary, Screenshot};
use crate::logger;
use crate::monitors::MonitorManager;
use crate::runtime::Runtime;

fn autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

fn config_with_os_state(app: &AppHandle, runtime: &Runtime) -> Value {
    let mut value = serde_json::to_value(runtime.config.get()).unwrap_or_else(|_| json!({}));
    if let Some(general) = value.get_mut("general").and_then(|v| v.as_object_mut()) {
        general.insert(
            "launchAtStartup".to_string(),
            Value::Bool(autostart_enabled(app)),
        );
    }
    value
}

// ---------------- 监控 ----------------

#[tauri::command]
pub fn monitor_status(manager: State<'_, Arc<MonitorManager>>) -> MonitorStatus {
    manager.get_status()
}

#[tauri::command]
pub fn monitor_start(manager: State<'_, Arc<MonitorManager>>) -> MonitorStatus {
    manager.start_all();
    manager.get_status()
}

#[tauri::command]
pub fn monitor_stop(manager: State<'_, Arc<MonitorManager>>) -> MonitorStatus {
    manager.stop_all();
    manager.get_status()
}

// ---------------- 数据查询 ----------------

#[tauri::command]
pub fn data_screenshots(
    runtime: State<'_, Arc<Runtime>>,
    date: String,
) -> Result<Vec<Screenshot>, String> {
    runtime.db.screenshots_by_date(&date)
}

#[tauri::command]
pub fn data_active_windows(
    runtime: State<'_, Arc<Runtime>>,
    date: String,
) -> Result<Vec<ActiveWindow>, String> {
    runtime.db.active_windows_by_date(&date)
}

#[tauri::command]
pub fn data_daily_analysis(
    runtime: State<'_, Arc<Runtime>>,
    date: String,
) -> Result<Value, String> {
    if date == "all" {
        let rows: Vec<DailyAnalysis> = runtime.db.all_daily_analysis()?;
        return Ok(serde_json::to_value(rows).unwrap_or(Value::Null));
    }

    let row = runtime.db.daily_analysis_by_date(&date)?;
    Ok(serde_json::to_value(row).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn data_periodic_summary(
    runtime: State<'_, Arc<Runtime>>,
    period_type: String,
    period_label: String,
) -> Result<Value, String> {
    if period_label == "all" {
        let rows: Vec<PeriodicSummary> = runtime.db.periodic_summaries_by_type(&period_type)?;
        return Ok(serde_json::to_value(rows).unwrap_or(Value::Null));
    }

    let row = runtime.db.periodic_summary(&period_type, &period_label)?;
    Ok(serde_json::to_value(row).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn data_today_stats(runtime: State<'_, Arc<Runtime>>, date: String) -> Result<Value, String> {
    let screenshots = runtime.db.screenshot_count_by_date(&date)?;
    let active_windows = runtime.db.active_windows_by_date(&date)?;
    let app_usage = runtime.db.app_usage_by_date(&date)?;
    let analysis = runtime.db.daily_analysis_by_date(&date)?;

    Ok(json!({
        "screenshots": screenshots,
        "activeWindows": active_windows.len(),
        "appUsage": app_usage,
        "analysis": analysis,
    }))
}

// ---------------- 分析 ----------------

/// 渲染层启动（或窗口重载）时查询当前分析任务，避免漏掉已经开始的状态。
#[tauri::command]
pub fn analysis_status(runtime: State<'_, Arc<Runtime>>) -> Value {
    match runtime.analysis_status() {
        Some(status) => serde_json::to_value(status).unwrap_or(Value::Null),
        None => Value::Null,
    }
}

/// 取消当前分析任务；没有任务在跑时返回 idle，便于前端忽略重复点击。
#[tauri::command]
pub fn analysis_cancel(runtime: State<'_, Arc<Runtime>>) -> Value {
    match runtime.request_cancel() {
        Some(status) => {
            logger::info(format!(
                "[AnalysisCancel] 已请求取消 {} {}",
                status.kind, status.target
            ));
            json!({ "status": "cancelling" })
        }
        None => json!({ "status": "idle" }),
    }
}

#[tauri::command]
pub async fn analysis_trigger(
    runtime: State<'_, Arc<Runtime>>,
    date: String,
) -> Result<Value, String> {
    let runtime = runtime.inner().clone();

    if !runtime.begin_analysis("daily", &date) {
        logger::warn("已有分析任务在执行，忽略本次触发");
        return Ok(json!({ "status": "busy", "date": date }));
    }

    let result = analyzer::analyze_daily(&runtime, &date).await;
    runtime.end_analysis();

    match result {
        Ok(Some(_)) => Ok(json!({ "status": "completed", "date": date })),
        Ok(None) => Ok(json!({ "status": "failed", "date": date })),
        Err(err) if analyzer::is_cancelled_error(&err) => {
            Ok(json!({ "status": "cancelled", "date": date }))
        }
        Err(err) => {
            logger::error(format!("分析触发失败：{err}"));
            Ok(json!({ "status": "failed", "date": date }))
        }
    }
}

#[tauri::command]
pub async fn analysis_rerun(
    runtime: State<'_, Arc<Runtime>>,
    days: Option<i64>,
) -> Result<Value, String> {
    let runtime = runtime.inner().clone();

    let target = days
        .map(|d| d.to_string())
        .unwrap_or_else(|| "all".to_string());
    if !runtime.begin_analysis("rerun", &target) {
        logger::warn("已有分析任务在执行，忽略本次批量补算");
        return Ok(json!({ "status": "busy", "total": 0, "succeeded": 0, "filled": 0 }));
    }

    let outcome = analyzer::rerun_daily(&runtime, days).await;
    runtime.end_analysis();

    Ok(json!({
        "status": if outcome.cancelled { "cancelled" } else { "completed" },
        "total": outcome.total,
        "succeeded": outcome.succeeded,
        "filled": outcome.filled,
        "cancelled": outcome.cancelled
    }))
}

#[tauri::command]
pub async fn summary_trigger(
    runtime: State<'_, Arc<Runtime>>,
    period_label: String,
) -> Result<Value, String> {
    let runtime = runtime.inner().clone();

    if !runtime.begin_analysis("summary", &period_label) {
        logger::warn("已有分析任务在执行，忽略本次周期汇总");
        return Ok(json!({ "status": "busy", "periodLabel": period_label }));
    }

    let result = if let Some(caps) = parse_quarter(&period_label) {
        analyzer::generate_quarterly(&runtime, caps.0, caps.1).await
    } else {
        match period_label.trim().parse::<i32>() {
            Ok(year) => analyzer::generate_yearly(&runtime, year).await,
            Err(_) => Err(format!("无法解析汇总周期: {period_label}")),
        }
    };

    runtime.end_analysis();

    match result {
        Ok(true) => Ok(json!({ "status": "completed", "periodLabel": period_label })),
        Ok(false) => Ok(json!({ "status": "failed", "periodLabel": period_label })),
        Err(err) if analyzer::is_cancelled_error(&err) => {
            Ok(json!({ "status": "cancelled", "periodLabel": period_label }))
        }
        Err(err) => {
            logger::error(format!("周期汇总失败：{err}"));
            Ok(json!({ "status": "failed", "periodLabel": period_label }))
        }
    }
}

/// 拉取 AI 接口支持的模型列表，供设置页下拉选择。
///
/// 参数缺省时读已保存配置；设置页会传入表单里尚未保存的 API Key / Base URL，
/// 这样用户填完就能直接试，不必先点保存。
#[tauri::command]
pub async fn analysis_list_models(
    runtime: State<'_, Arc<Runtime>>,
    api_key: Option<String>,
    base_url: Option<String>,
    custom_headers: Option<String>,
) -> Result<Vec<String>, String> {
    let saved = runtime.config.analysis();
    let key = api_key.unwrap_or(saved.api_key);
    let base = base_url.unwrap_or(saved.base_url);
    let headers = custom_headers.unwrap_or(saved.custom_headers);
    drop(runtime);

    analyzer::llm::list_models(&key, &base, &headers).await
}

/// 用设置页当前表单参数真实调用一次对话接口，验证所选模型是否可用。
///
/// 验证失败放在 Ok 里（ok=false），不作为调用异常抛出；外层 Result 是
/// Tauri 对含 State 引用的 async 命令的要求。
#[tauri::command]
pub async fn analysis_validate_model(
    runtime: State<'_, Arc<Runtime>>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    custom_headers: Option<String>,
) -> Result<analyzer::llm::ModelValidation, String> {
    let saved = runtime.config.analysis();
    let key = api_key.unwrap_or(saved.api_key);
    let base = base_url.unwrap_or(saved.base_url);
    let selected_model = model.unwrap_or(saved.model);
    let headers = custom_headers.unwrap_or(saved.custom_headers);
    drop(runtime);

    Ok(analyzer::llm::validate_model(&key, &base, &selected_model, &headers).await)
}

fn parse_quarter(label: &str) -> Option<(i32, u32)> {
    let (year, quarter) = label.split_once("-Q")?;
    Some((year.parse().ok()?, quarter.parse().ok()?))
}

// ---------------- 配置 ----------------

#[tauri::command]
pub fn config_get(app: AppHandle, runtime: State<'_, Arc<Runtime>>) -> Value {
    config_with_os_state(&app, &runtime)
}

#[tauri::command]
pub fn config_set(
    app: AppHandle,
    runtime: State<'_, Arc<Runtime>>,
    key: String,
    value: Value,
) -> Result<Value, String> {
    if key == "general" {
        if let Some(launch_at_startup) = value.get("launchAtStartup").and_then(|v| v.as_bool()) {
            let autolaunch = app.autolaunch();
            let result = if launch_at_startup {
                autolaunch.enable()
            } else {
                autolaunch.disable()
            };
            if let Err(err) = result {
                logger::error(format!("设置开机自启动失败：{err}"));
            }
        }
    }

    runtime.config.set_section(&key, value)?;

    Ok(config_with_os_state(&app, &runtime))
}

#[tauri::command]
pub fn storage_active_backend() -> String {
    "rusqlite".to_string()
}

// ---------------- 系统 ----------------

#[tauri::command]
pub fn system_open_path(app: AppHandle, path: String) -> Result<(), String> {
    if path.is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn system_get_screenshots_dir(runtime: State<'_, Arc<Runtime>>) -> String {
    runtime.screenshots_dir().to_string_lossy().to_string()
}

// ---------------- 应用 ----------------

#[tauri::command]
pub fn app_quit(app: AppHandle) {
    logger::info("收到前端退出命令");
    crate::quit(&app);
}
