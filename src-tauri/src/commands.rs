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

#[tauri::command]
pub async fn analysis_trigger(
    runtime: State<'_, Arc<Runtime>>,
    date: String,
) -> Result<Value, String> {
    let runtime = runtime.inner().clone();

    if !runtime.try_begin_analysis() {
        logger::warn("已有分析任务在执行，忽略本次触发");
        return Ok(json!({ "status": "busy", "date": date }));
    }

    let result = analyzer::analyze_daily(&runtime, &date).await;
    runtime.end_analysis();

    match result {
        Ok(Some(_)) => Ok(json!({ "status": "completed", "date": date })),
        Ok(None) => Ok(json!({ "status": "failed", "date": date })),
        Err(err) => {
            logger::error(format!("分析触发失败：{err}"));
            Ok(json!({ "status": "failed", "date": date }))
        }
    }
}

#[tauri::command]
pub async fn analysis_backfill(runtime: State<'_, Arc<Runtime>>) -> Result<Value, String> {
    let runtime = runtime.inner().clone();

    if !runtime.try_begin_analysis() {
        logger::warn("已有分析任务在执行，忽略本次补偿分析");
        return Ok(json!({ "status": "busy", "total": 0, "succeeded": 0 }));
    }

    let (total, succeeded) = analyzer::backfill_all(&runtime).await;
    runtime.end_analysis();

    Ok(json!({ "status": "completed", "total": total, "succeeded": succeeded }))
}

#[tauri::command]
pub async fn summary_trigger(
    runtime: State<'_, Arc<Runtime>>,
    period_label: String,
) -> Result<Value, String> {
    let runtime = runtime.inner().clone();

    let result = if let Some(caps) = parse_quarter(&period_label) {
        analyzer::generate_quarterly(&runtime, caps.0, caps.1).await
    } else {
        match period_label.trim().parse::<i32>() {
            Ok(year) => analyzer::generate_yearly(&runtime, year).await,
            Err(_) => Err(format!("无法解析汇总周期: {period_label}")),
        }
    };

    match result {
        Ok(true) => Ok(json!({ "status": "completed", "periodLabel": period_label })),
        Ok(false) => Ok(json!({ "status": "failed", "periodLabel": period_label })),
        Err(err) => {
            logger::error(format!("周期汇总失败：{err}"));
            Ok(json!({ "status": "failed", "periodLabel": period_label }))
        }
    }
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
