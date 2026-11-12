use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use crate::config::ConfigStore;
use crate::db::Database;

/// 当前正在执行的分析任务，前后端共享同一份状态。
///
/// kind: daily（单日手动分析）/ rerun（批量补算）/ summary（周期汇总）/
/// scheduled（定时分析，含自动补生成与汇总）；target 为日期或周期标签。
#[derive(Clone, Serialize)]
pub struct AnalysisStatus {
    pub kind: String,
    pub target: String,
    /// 用户已请求取消，任务正在收尾（可能还有一次 HTTP 请求返回）
    pub cancelling: bool,
}

/// 主进程运行时共享状态：所有监控任务、命令、托盘都通过它访问配置与数据库。
pub struct Runtime {
    pub app: AppHandle,
    pub data_dir: PathBuf,
    pub config: ConfigStore,
    pub db: Database,
    /// 同一时刻只允许一个分析任务；Some 表示正在执行。
    /// 状态的读取、占用与释放都在同一把锁内完成，避免 started/finished 事件乱序。
    analysis_status: Mutex<Option<AnalysisStatus>>,
    /// 取消信号。用 watch 而非 AtomicBool：await 中的请求能被立刻唤醒，
    /// 也不会因为「先检查后等待」丢失通知。
    cancel_tx: watch::Sender<bool>,
}

impl Runtime {
    pub fn new(app: AppHandle, data_dir: PathBuf, config: ConfigStore, db: Database) -> Self {
        let (cancel_tx, _) = watch::channel(false);
        Self {
            app,
            data_dir,
            config,
            db,
            analysis_status: Mutex::new(None),
            cancel_tx,
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

    /// 尝试占用分析锁；成功时广播任务开始，失败说明已有任务在运行。
    /// 事件的接收方（渲染层）据此展示「正在分析」并锁住所有触发入口。
    pub fn begin_analysis(&self, kind: &str, target: &str) -> bool {
        let mut current = self.analysis_status.lock().unwrap();
        if current.is_some() {
            return false;
        }

        self.cancel_tx.send_replace(false);

        let status = AnalysisStatus {
            kind: kind.to_string(),
            target: target.to_string(),
            cancelling: false,
        };
        *current = Some(status.clone());
        self.emit("analysis:started", status);
        true
    }

    /// 请求取消当前任务：置位取消信号并通知前端进入「正在取消」。
    /// 返回 None 表示当前没有任务在跑。
    pub fn request_cancel(&self) -> Option<AnalysisStatus> {
        let mut current = self.analysis_status.lock().unwrap();
        let status = current.as_mut()?;
        if status.cancelling {
            return Some(status.clone());
        }

        status.cancelling = true;
        let snapshot = status.clone();
        self.cancel_tx.send_replace(true);
        self.emit("analysis:cancelling", snapshot);
        Some(status.clone())
    }

    /// 是否已请求取消，供分析各步骤之间的快速判断。
    pub fn is_cancelled(&self) -> bool {
        *self.cancel_tx.borrow()
    }

    /// 等待取消信号；任务正常完成后由 end_analysis 复位，不会误触。
    pub async fn wait_cancelled(&self) {
        let mut rx = self.cancel_tx.subscribe();
        if *rx.borrow_and_update() {
            return;
        }
        while rx.changed().await.is_ok() {
            if *rx.borrow_and_update() {
                return;
            }
        }
    }

    /// 释放分析锁并广播结束；无论分析成功、失败、取消还是无数据，都必须调用。
    pub fn end_analysis(&self) {
        let mut current = self.analysis_status.lock().unwrap();
        let status = current.take();
        self.cancel_tx.send_replace(false);
        self.emit("analysis:finished", status);
    }

    pub fn analysis_status(&self) -> Option<AnalysisStatus> {
        self.analysis_status.lock().unwrap().clone()
    }
}
