use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Screenshot {
    pub id: i64,
    pub timestamp: String,
    pub file_path: String,
    pub file_size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub trigger_type: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveWindow {
    pub id: i64,
    pub timestamp: String,
    pub app_name: String,
    pub window_title: String,
    pub process_id: Option<i64>,
    pub bundle_id: Option<String>,
    pub duration_ms: i64,
    pub screenshot_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyAnalysis {
    pub id: i64,
    pub date: String,
    pub result_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeriodicSummary {
    pub id: i64,
    pub period_type: String,
    pub period_label: String,
    pub result_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMemory {
    pub id: i64,
    pub task_summary: String,
    pub category: String,
    /// JSON 数组字符串，例如 `["VS Code","Terminal"]`
    pub app_cluster: String,
    pub last_active_date: String,
    pub last_active_time: String,
    pub cumulative_duration_ms: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUsage {
    pub app_name: String,
    pub total_duration_ms: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSwitch {
    pub time: String,
    pub app_name: String,
    pub window_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorState {
    pub name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorStatus {
    pub monitors: Vec<MonitorState>,
    #[serde(rename = "isPaused")]
    pub is_paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisProgress {
    pub step: String,
    pub current: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItem {
    pub time_range: String,
    pub activity: String,
    pub app: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyAnalysisResult {
    pub work_items: Vec<WorkItem>,
    pub summary: Vec<String>,
}
