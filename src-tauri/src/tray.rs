use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::db::MonitorStatus;
use crate::monitors::MonitorManager;

const TRAY_ID: &str = "main-tray";

pub fn create(app: &AppHandle, manager: Arc<MonitorManager>) -> tauri::Result<()> {
    let menu = build_menu(app, manager.get_status().is_paused)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray.png"
        ))?)
        .icon_as_template(true)
        .tooltip("Desktop Monitor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "toggle" => {
                if let Some(manager) = app.try_state::<Arc<MonitorManager>>() {
                    if manager.get_status().is_paused {
                        manager.resume();
                    } else {
                        manager.pause();
                    }
                }
            }
            "quit" => crate::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    // 监控状态变化时同步刷新托盘菜单文案
    let handle = app.clone();
    manager.set_status_listener(Arc::new(move |status: MonitorStatus| {
        if let (Some(tray), Ok(menu)) = (
            handle.tray_by_id(TRAY_ID),
            build_menu(&handle, status.is_paused),
        ) {
            let _ = tray.set_menu(Some(menu));
        }
    }));

    Ok(())
}

fn build_menu(app: &AppHandle, paused: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let toggle = MenuItem::with_id(
        app,
        "toggle",
        if paused {
            "恢复监控"
        } else {
            "暂停监控"
        },
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[&show, &separator_one, &toggle, &separator_two, &quit],
    )
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
