use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// 解析应用数据目录。
///
/// Tauri 默认使用 identifier 推导目录（如 `com.desktop-monitor.app`），
/// 而历史 Electron 版本使用的是 productName / package name 目录。
/// 这里优先复用已存在历史数据的目录，保证从 Electron 版本升级时
/// 配置、数据库、截图目录可以无缝沿用，无需迁移拷贝。
pub fn resolve_data_dir(app: &AppHandle) -> PathBuf {
    let fallback = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("desktop-monitor");

    let target = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| fallback.clone());

    if has_state(&target) {
        return target;
    }

    for legacy in ["Desktop Monitor", "desktop-monitor"] {
        if let Some(base) = dirs::data_dir() {
            let candidate = base.join(legacy);
            if candidate != target && has_state(&candidate) {
                return candidate;
            }
        }
    }

    target
}

fn has_state(dir: &Path) -> bool {
    dir.join("config.json").exists() || dir.join("monitor.db").exists()
}
