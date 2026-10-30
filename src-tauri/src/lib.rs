mod analyzer;
mod commands;
mod config;
mod db;
mod logger;
mod monitors;
mod paths;
mod runtime;
mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{Manager, WindowEvent};

/// 是否处于主动退出流程（托盘退出 / 应用退出）。
/// 非退出时关闭窗口只隐藏，保持后台监控继续运行。
static QUITTING: AtomicBool = AtomicBool::new(false);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = paths::resolve_data_dir(&handle);
            std::fs::create_dir_all(&data_dir)?;

            logger::init(data_dir.join("logs"));
            logger::info(format!(
                "应用启动 v{}，数据目录: {}",
                env!("CARGO_PKG_VERSION"),
                data_dir.display()
            ));

            let config = config::ConfigStore::load(&data_dir);
            let db = db::Database::open(&data_dir.join("monitor.db"))
                .map_err(|err| format!("初始化数据库失败: {err}"))?;

            let runtime = Arc::new(runtime::Runtime::new(handle.clone(), data_dir, config, db));
            app.manage(runtime.clone());

            let manager = Arc::new(monitors::MonitorManager::new(runtime.clone()));
            app.manage(manager.clone());

            tray::create(&handle, manager.clone())?;

            let scheduler = analyzer::Scheduler::new(runtime.clone());
            scheduler.start();
            app.manage(scheduler);

            manager.start_all();

            Ok(())
        })
        .on_page_load(|_webview, payload| {
            logger::info(format!(
                "页面加载事件: {:?} {}",
                payload.event(),
                payload.url()
            ));
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::monitor_status,
            commands::monitor_start,
            commands::monitor_stop,
            commands::data_screenshots,
            commands::data_active_windows,
            commands::data_daily_analysis,
            commands::data_periodic_summary,
            commands::data_today_stats,
            commands::analysis_trigger,
            commands::analysis_backfill,
            commands::analysis_reanalyze_recent,
            commands::summary_trigger,
            commands::config_get,
            commands::config_set,
            commands::storage_active_backend,
            commands::system_open_path,
            commands::system_get_screenshots_dir,
            commands::app_quit,
        ])
        .build(tauri::generate_context!())
        .expect("启动 Tauri 应用失败")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => quit(app),
            // macOS 上点击 Dock 图标时恢复窗口（对应旧版的 app.on('activate')）
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        });
}

/// 优雅退出：先停掉监控与调度，再退出进程。
pub fn quit(app: &tauri::AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }

    logger::info("应用退出中...");

    if let Some(manager) = app.try_state::<Arc<monitors::MonitorManager>>() {
        manager.shutdown();
    }
    if let Some(scheduler) = app.try_state::<analyzer::Scheduler>() {
        scheduler.stop();
    }

    app.exit(0);
}
