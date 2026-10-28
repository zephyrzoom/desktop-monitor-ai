use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

use chrono::{Duration, Local};

/// 日志保留天数，与旧版保持一致。
const LOG_RETENTION_DAYS: i64 = 7;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(dir: PathBuf) {
    let _ = fs::create_dir_all(&dir);
    cleanup(&dir);
    let _ = LOG_DIR.set(dir);
}

fn cleanup(dir: &std::path::Path) {
    let cutoff = (Local::now() - Duration::days(LOG_RETENTION_DAYS))
        .format("%Y-%m-%d")
        .to_string();

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".log") {
            continue;
        }
        if name.trim_end_matches(".log") < cutoff.as_str() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn write(level: &str, message: &str) {
    let now = Local::now();
    let line = format!("[{}] [{}] {}\n", now.format("%H:%M:%S%.3f"), level, message);

    if let Some(dir) = LOG_DIR.get() {
        let file = dir.join(format!("{}.log", now.format("%Y-%m-%d")));
        if let Ok(mut handle) = OpenOptions::new().create(true).append(true).open(file) {
            let _ = handle.write_all(line.as_bytes());
        }
    }

    if cfg!(debug_assertions) {
        print!("{line}");
    }
}

pub fn info(message: impl AsRef<str>) {
    write("INFO", message.as_ref());
}

pub fn warn(message: impl AsRef<str>) {
    write("WARN", message.as_ref());
}

pub fn error(message: impl AsRef<str>) {
    write("ERROR", message.as_ref());
}
