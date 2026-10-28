pub mod screenshot;

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{Local, Utc};
use tauri::async_runtime::JoinHandle;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use crate::db::{MonitorState, MonitorStatus};
use crate::logger;
use crate::runtime::Runtime;

const STATUS_STOPPED: u8 = 0;
const STATUS_RUNNING: u8 = 1;
const STATUS_ERROR: u8 = 2;

const IDLE_POLL_SECS: u64 = 10;
const SCHEDULE_POLL_SECS: u64 = 60;
/// 两次空闲轮询间隔明显超出预期，视为系统休眠/挂起后恢复
const SUSPEND_GAP_SECS: u64 = 30;

#[derive(Default, Clone)]
struct Segment {
    app_name: Option<String>,
    window_title: String,
    process_id: Option<i64>,
    started_at: Option<chrono::DateTime<Utc>>,
}

type StatusListener = Arc<dyn Fn(MonitorStatus) + Send + Sync>;

pub struct Shared {
    running: AtomicBool,
    manual_paused: AtomicBool,
    time_paused: AtomicBool,
    idle_paused: AtomicBool,
    active_state: AtomicU8,
    shot_state: AtomicU8,
    current_screenshot_id: AtomicI64,
    segment: Mutex<Segment>,
    change_tx: Mutex<Option<UnboundedSender<()>>>,
    listener: Mutex<Option<StatusListener>>,
}

impl Shared {
    fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            manual_paused: AtomicBool::new(false),
            time_paused: AtomicBool::new(false),
            idle_paused: AtomicBool::new(false),
            active_state: AtomicU8::new(STATUS_STOPPED),
            shot_state: AtomicU8::new(STATUS_STOPPED),
            current_screenshot_id: AtomicI64::new(0),
            segment: Mutex::new(Segment::default()),
            change_tx: Mutex::new(None),
            listener: Mutex::new(None),
        }
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn effective_paused(&self) -> bool {
        self.manual_paused.load(Ordering::SeqCst)
            || self.time_paused.load(Ordering::SeqCst)
            || self.idle_paused.load(Ordering::SeqCst)
    }

    fn status(&self) -> MonitorStatus {
        fn label(state: u8) -> &'static str {
            match state {
                STATUS_RUNNING => "running",
                STATUS_ERROR => "error",
                _ => "stopped",
            }
        }

        MonitorStatus {
            monitors: vec![
                MonitorState {
                    name: "active-window".to_string(),
                    status: label(self.active_state.load(Ordering::SeqCst)).to_string(),
                    error: None,
                },
                MonitorState {
                    name: "screenshot".to_string(),
                    status: label(self.shot_state.load(Ordering::SeqCst)).to_string(),
                    error: None,
                },
            ],
            is_paused: self.effective_paused(),
        }
    }

    fn notify(&self, rt: &Runtime) {
        let status = self.status();
        rt.emit("monitor:statusChanged", status.clone());
        if let Some(listener) = self.listener.lock().unwrap().as_ref() {
            listener(status);
        }
    }
}

/// 结束当前活动窗口片段并落库。
fn flush_segment(rt: &Runtime, shared: &Shared) {
    let mut segment = shared.segment.lock().unwrap();
    let app = segment.app_name.take();
    let started_at = segment.started_at.take();

    if let (Some(app_name), Some(started_at)) = (app, started_at) {
        let duration = (Utc::now() - started_at).num_milliseconds();
        if duration > 0 {
            let raw_id = shared.current_screenshot_id.load(Ordering::SeqCst);
            let screenshot_id = if raw_id > 0 { Some(raw_id) } else { None };
            if let Err(err) = rt.db.insert_active_window(
                &app_name,
                &segment.window_title,
                segment.process_id,
                None,
                duration,
                screenshot_id,
            ) {
                logger::error(format!("写入窗口记录失败：{err}"));
            }
        }
    }

    *segment = Segment::default();
}

fn current_hhmm() -> String {
    Local::now().format("%H:%M").to_string()
}

fn within_monitoring_window(start: &str, end: &str, now: &str) -> bool {
    if start <= end {
        now >= start && now < end
    } else {
        // 跨零点区间，例如 22:00 - 06:00
        now >= start || now < end
    }
}

async fn poll_active_window(rt: Arc<Runtime>, shared: Arc<Shared>, poll_ms: u64) {
    loop {
        tokio::time::sleep(Duration::from_millis(poll_ms.max(200))).await;
        if !shared.is_running() {
            break;
        }

        if shared.effective_paused() {
            let has_segment = shared.segment.lock().unwrap().app_name.is_some();
            if has_segment {
                flush_segment(&rt, &shared);
            }
            continue;
        }

        let window = match active_win_pos_rs::get_active_window() {
            Ok(window) => window,
            Err(_) => continue,
        };

        // 跳过应用自身，不记录自身使用时长
        if window.process_id == std::process::id() as u64 {
            let has_segment = shared.segment.lock().unwrap().app_name.is_some();
            if has_segment {
                flush_segment(&rt, &shared);
            }
            shared.current_screenshot_id.store(0, Ordering::SeqCst);
            continue;
        }

        let app_name = if window.app_name.trim().is_empty() {
            "Unknown".to_string()
        } else {
            window.app_name
        };
        let window_title = window.title;

        let unchanged = {
            let segment = shared.segment.lock().unwrap();
            segment.app_name.as_deref() == Some(app_name.as_str())
                && segment.window_title == window_title
        };

        if unchanged {
            continue;
        }

        flush_segment(&rt, &shared);
        shared.current_screenshot_id.store(0, Ordering::SeqCst);

        {
            let mut segment = shared.segment.lock().unwrap();
            *segment = Segment {
                app_name: Some(app_name),
                window_title,
                process_id: Some(window.process_id as i64),
                started_at: Some(Utc::now()),
            };
        }

        if let Some(tx) = shared.change_tx.lock().unwrap().as_ref() {
            let _ = tx.send(());
        }
    }
}

async fn watch_window_changes(
    rt: Arc<Runtime>,
    shared: Arc<Shared>,
    mut rx: UnboundedReceiver<()>,
    debounce: Duration,
) {
    'outer: while shared.is_running() {
        if rx.recv().await.is_none() {
            break;
        }

        // 窗口持续切换时不断顺延，直到安静 debounce 时长
        loop {
            tokio::select! {
                _ = tokio::time::sleep(debounce) => break,
                message = rx.recv() => {
                    if message.is_none() {
                        break 'outer;
                    }
                }
            }
        }

        if !shared.is_running() {
            break;
        }
        if shared.effective_paused() {
            continue;
        }

        if let Some(id) = screenshot::capture(&rt, "window_change") {
            shared.current_screenshot_id.store(id, Ordering::SeqCst);
        }
    }
}

async fn watch_timer(rt: Arc<Runtime>, shared: Arc<Shared>, interval_ms: u64) {
    loop {
        tokio::time::sleep(Duration::from_millis(interval_ms.max(60_000))).await;
        if !shared.is_running() {
            break;
        }
        if shared.effective_paused() {
            continue;
        }
        if let Some(id) = screenshot::capture(&rt, "timer") {
            shared.current_screenshot_id.store(id, Ordering::SeqCst);
        }
    }
}

async fn watch_idle(rt: Arc<Runtime>, shared: Arc<Shared>) {
    let mut last_tick = Instant::now();

    loop {
        tokio::time::sleep(Duration::from_secs(IDLE_POLL_SECS)).await;
        if !shared.is_running() {
            break;
        }

        let gap = last_tick.elapsed();
        last_tick = Instant::now();

        // 系统休眠/挂起：结束当前片段，恢复后重新计时
        if gap.as_secs() > SUSPEND_GAP_SECS {
            flush_segment(&rt, &shared);
            shared.idle_paused.store(true, Ordering::SeqCst);
            shared.notify(&rt);
            logger::info("检测到系统休眠/唤醒，已结束当前监控片段");
            continue;
        }

        let timeout_minutes = rt.config.monitoring().idle_timeout_minutes.max(1);
        let idle_seconds = user_idle::UserIdle::get_time()
            .map(|idle| idle.duration().as_secs())
            .unwrap_or(0);

        let idle_now = idle_seconds >= timeout_minutes * 60;
        let idle_before = shared.idle_paused.load(Ordering::SeqCst);

        if idle_now != idle_before {
            if idle_now {
                flush_segment(&rt, &shared);
                logger::info(format!("检测到空闲 {idle_seconds}s，暂停监控"));
            } else {
                logger::info("检测到用户操作，恢复监控");
            }
            shared.idle_paused.store(idle_now, Ordering::SeqCst);
            shared.notify(&rt);
        }
    }
}

async fn watch_schedule(rt: Arc<Runtime>, shared: Arc<Shared>) {
    loop {
        tokio::time::sleep(Duration::from_secs(SCHEDULE_POLL_SECS)).await;
        if !shared.is_running() {
            break;
        }
        apply_schedule(&rt, &shared);
    }
}

fn apply_schedule(rt: &Runtime, shared: &Shared) {
    let config = rt.config.monitoring();
    let start = if config.monitoring_start_time.is_empty() {
        "00:00".to_string()
    } else {
        config.monitoring_start_time
    };
    let end = if config.monitoring_end_time.is_empty() {
        "23:59".to_string()
    } else {
        config.monitoring_end_time
    };

    let in_range = within_monitoring_window(&start, &end, &current_hhmm());
    let should_pause = !in_range;
    let paused = shared.time_paused.load(Ordering::SeqCst);

    if should_pause == paused {
        return;
    }

    if should_pause {
        flush_segment(rt, shared);
        logger::info(format!("超出监控时段 {start}-{end}，暂停监控"));
    } else {
        logger::info(format!("进入监控时段 {start}-{end}，恢复监控"));
    }

    shared.time_paused.store(should_pause, Ordering::SeqCst);
    shared.notify(rt);
}

pub struct MonitorManager {
    rt: Arc<Runtime>,
    shared: Arc<Shared>,
    handles: Mutex<Vec<JoinHandle<()>>>,
}

impl MonitorManager {
    pub fn new(rt: Arc<Runtime>) -> Self {
        Self {
            rt,
            shared: Arc::new(Shared::new()),
            handles: Mutex::new(Vec::new()),
        }
    }

    pub fn set_status_listener(&self, listener: StatusListener) {
        *self.shared.listener.lock().unwrap() = Some(listener);
    }

    pub fn get_status(&self) -> MonitorStatus {
        self.shared.status()
    }

    pub fn start_all(&self) {
        if self.shared.running.swap(true, Ordering::SeqCst) {
            return;
        }

        let config = self.rt.config.monitoring();
        self.shared
            .active_state
            .store(STATUS_RUNNING, Ordering::SeqCst);
        self.shared
            .shot_state
            .store(STATUS_RUNNING, Ordering::SeqCst);

        let (tx, rx) = unbounded_channel();
        *self.shared.change_tx.lock().unwrap() = Some(tx);

        screenshot::cleanup(&self.rt);

        let mut handles = self.handles.lock().unwrap();
        handles.push(tauri::async_runtime::spawn(poll_active_window(
            self.rt.clone(),
            self.shared.clone(),
            config.window_poll_interval_ms,
        )));
        handles.push(tauri::async_runtime::spawn(watch_window_changes(
            self.rt.clone(),
            self.shared.clone(),
            rx,
            Duration::from_secs(config.window_change_debounce_sec.max(1)),
        )));
        handles.push(tauri::async_runtime::spawn(watch_timer(
            self.rt.clone(),
            self.shared.clone(),
            config.screenshot_interval_ms,
        )));
        handles.push(tauri::async_runtime::spawn(watch_idle(
            self.rt.clone(),
            self.shared.clone(),
        )));
        handles.push(tauri::async_runtime::spawn(watch_schedule(
            self.rt.clone(),
            self.shared.clone(),
        )));
        drop(handles);

        apply_schedule(&self.rt, &self.shared);
        self.shared.notify(&self.rt);
        logger::info("监控已启动");
    }

    pub fn stop_all(&self) {
        if !self.shared.running.swap(false, Ordering::SeqCst) {
            return;
        }

        {
            let mut handles = self.handles.lock().unwrap();
            for handle in handles.drain(..) {
                handle.abort();
            }
        }

        *self.shared.change_tx.lock().unwrap() = None;
        flush_segment(&self.rt, &self.shared);
        self.shared
            .active_state
            .store(STATUS_STOPPED, Ordering::SeqCst);
        self.shared
            .shot_state
            .store(STATUS_STOPPED, Ordering::SeqCst);
        self.shared.notify(&self.rt);
        logger::info("监控已停止");
    }

    pub fn pause(&self) {
        if self.shared.manual_paused.swap(true, Ordering::SeqCst) {
            return;
        }
        flush_segment(&self.rt, &self.shared);
        self.shared.notify(&self.rt);
        logger::info("监控已手动暂停");
    }

    pub fn resume(&self) {
        if !self.shared.manual_paused.swap(false, Ordering::SeqCst) {
            return;
        }
        self.shared.notify(&self.rt);
        logger::info("监控已恢复");
    }

    pub fn shutdown(&self) {
        self.stop_all();
    }
}
