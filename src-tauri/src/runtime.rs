use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::ConfigStore;
use crate::db::Database;

/// 主进程运行时共享状态：所有监控任务、命令、托盘都通过它访问配置与数据库。
pub struct Runtime {
    pub app: AppHandle,
    pub data_dir: PathBuf,
    pub config: ConfigStore,
    pub db: Database,
    /// 避免每日分析与补偿分析并发执行的互斥标记
    pub analysis_running: AtomicBool,
}

impl Runtime {
    pub fn new(app: AppHandle, data_dir: PathBuf, config: ConfigStore, db: Database) -> Self {
        Self {
            app,
            data_dir,
            config,
            db,
            analysis_running: AtomicBool::new(false),
        }
    }

    pub fn screenshots_dir(&self) -> PathBuf {
        let configured = self.config.monitoring().screenshots_dir;
        if configured.trim().is_empty() {
            self.data_dir.join("screenshots")
        } else {
            PathBuf::from(configured)
        }
    }

    pub fn emit<T: Serialize + Clone>(&self, event: &str, payload: T) {
        let _ = self.app.emit(event, payload);
    }

    pub fn try_begin_analysis(&self) -> bool {
        !self.analysis_running.swap(true, Ordering::SeqCst)
    }

    pub fn end_analysis(&self) {
        self.analysis_running.store(false, Ordering::SeqCst);
    }
}
