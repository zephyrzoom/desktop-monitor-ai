use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralConfig {
    pub launch_at_startup: bool,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            launch_at_startup: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MonitoringConfig {
    pub enabled: bool,
    pub screenshot_interval_ms: u64,
    pub window_poll_interval_ms: u64,
    pub window_change_debounce_sec: u64,
    pub screenshots_dir: String,
    /// 全天监控：忽略下方的起止时间，任何时刻都在监控窗口内
    pub monitoring_all_day: bool,
    pub monitoring_start_time: String,
    pub monitoring_end_time: String,
    pub idle_timeout_minutes: u64,
}

impl MonitoringConfig {
    /// 时间段是否等价于「整天」：起止留空，或覆盖 00:00 到 23:59。
    ///
    /// 老版本配置里没有 `monitoringAllDay` 字段，升级时用它推断，
    /// 否则新字段默认 `true` 会把用户自定义的时段（如 09:00-18:00）悄悄改成全天。
    pub fn infer_all_day(&self) -> bool {
        let start = self.monitoring_start_time.trim();
        let end = self.monitoring_end_time.trim();
        (start.is_empty() || start == "00:00") && (end.is_empty() || end == "23:59")
    }
}

impl Default for MonitoringConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            screenshot_interval_ms: 10 * 60 * 1000,
            window_poll_interval_ms: 1000,
            window_change_debounce_sec: 3,
            screenshots_dir: String::new(),
            monitoring_all_day: true,
            monitoring_start_time: "00:00".to_string(),
            monitoring_end_time: "23:59".to_string(),
            idle_timeout_minutes: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AnalysisConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub custom_headers: String,
    pub schedule_time: String,
    /// 定时分析的目标日期：`auto`（06:00 前分析前一天）/ `today`（当天）/ `previous`（前一天）
    pub schedule_date_mode: String,
    /// 季度结束后随每日分析自动生成上一季度汇总
    pub auto_quarterly: bool,
    /// 年度结束后随每日分析自动生成上一年度汇总
    pub auto_yearly: bool,
    pub max_screenshots_per_batch: usize,
    pub gap_threshold_minutes: i64,
    pub task_memory_days: i64,
    pub max_retries: u32,
}

impl Default for AnalysisConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o".to_string(),
            custom_headers: String::new(),
            schedule_time: "23:00".to_string(),
            schedule_date_mode: "auto".to_string(),
            auto_quarterly: true,
            auto_yearly: true,
            max_screenshots_per_batch: 15,
            gap_threshold_minutes: 15,
            task_memory_days: 3,
            max_retries: 3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CleanupConfig {
    pub retention_days: i64,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self { retention_days: 30 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StorageConfig {
    pub backend: String,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            backend: "sqlite".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub general: GeneralConfig,
    pub monitoring: MonitoringConfig,
    pub analysis: AnalysisConfig,
    pub cleanup: CleanupConfig,
    pub storage: StorageConfig,
}

/// 判断原始配置文本里是否存在某个键（用于区分「字段缺失」与「显式设为默认值」）。
fn has_config_key(text: &str, pointer: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .map(|raw| raw.pointer(pointer).is_some())
        .unwrap_or(false)
}

pub struct ConfigStore {
    path: PathBuf,
    cache: Mutex<Config>,
}

impl ConfigStore {
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join("config.json");
        let cache = match fs::read_to_string(&path) {
            Ok(text) => {
                let mut config = serde_json::from_str::<Config>(&text).unwrap_or_default();
                // 老配置没有 monitoringAllDay：按原有起止时间推断是否为全天，
                // 否则新字段默认 true 会把用户自定义的时段（如 09:00-18:00）改成全天。
                if !has_config_key(&text, "/monitoring/monitoringAllDay") {
                    config.monitoring.monitoring_all_day = config.monitoring.infer_all_day();
                }
                config
            }
            Err(_) => {
                let defaults = Config::default();
                let store = Self {
                    path: path.clone(),
                    cache: Mutex::new(defaults.clone()),
                };
                store.save(&defaults);
                return store;
            }
        };

        Self {
            path,
            cache: Mutex::new(cache),
        }
    }

    pub fn get(&self) -> Config {
        self.cache.lock().unwrap().clone()
    }

    pub fn analysis(&self) -> AnalysisConfig {
        self.cache.lock().unwrap().analysis.clone()
    }

    pub fn monitoring(&self) -> MonitoringConfig {
        self.cache.lock().unwrap().monitoring.clone()
    }

    pub fn cleanup(&self) -> CleanupConfig {
        self.cache.lock().unwrap().cleanup.clone()
    }

    /// 按分区整体覆盖配置，语义与旧版 `setConfigValue(key, value)` 一致。
    pub fn set_section(&self, key: &str, value: Value) -> Result<Config, String> {
        let mut guard = self.cache.lock().unwrap();
        let mut next = guard.clone();

        match key {
            "general" => next.general = serde_json::from_value(value).map_err(|e| e.to_string())?,
            "monitoring" => {
                next.monitoring = serde_json::from_value(value).map_err(|e| e.to_string())?
            }
            "analysis" => {
                next.analysis = serde_json::from_value(value).map_err(|e| e.to_string())?
            }
            "cleanup" => next.cleanup = serde_json::from_value(value).map_err(|e| e.to_string())?,
            "storage" => next.storage = serde_json::from_value(value).map_err(|e| e.to_string())?,
            other => return Err(format!("未知配置分区: {other}")),
        }

        *guard = next.clone();
        drop(guard);
        self.save(&next);
        Ok(next)
    }

    fn save(&self, config: &Config) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(config) {
            let _ = fs::write(&self.path, text);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitoring(start: &str, end: &str) -> MonitoringConfig {
        MonitoringConfig {
            monitoring_start_time: start.to_string(),
            monitoring_end_time: end.to_string(),
            ..MonitoringConfig::default()
        }
    }

    #[test]
    fn legacy_window_infers_all_day_only_for_full_day() {
        assert!(monitoring("00:00", "23:59").infer_all_day());
        assert!(monitoring("", "").infer_all_day());
        assert!(monitoring("00:00", "").infer_all_day());

        // 自定义时段不能被判成全天，否则老配置升级后会被静默改成全天监控
        assert!(!monitoring("09:00", "18:00").infer_all_day());
        assert!(!monitoring("00:00", "12:00").infer_all_day());
        assert!(!monitoring("22:00", "06:00").infer_all_day());
    }

    #[test]
    fn config_key_probe_distinguishes_missing_field() {
        let legacy = r#"{"monitoring":{"monitoringStartTime":"09:00"}}"#;
        assert!(!has_config_key(legacy, "/monitoring/monitoringAllDay"));

        // 显式写了 false 或 null 都算「用户设置过」，不再走推断
        assert!(has_config_key(
            r#"{"monitoring":{"monitoringAllDay":false}}"#,
            "/monitoring/monitoringAllDay"
        ));
        assert!(has_config_key(
            r#"{"monitoring":{"monitoringAllDay":null}}"#,
            "/monitoring/monitoringAllDay"
        ));
    }
}
