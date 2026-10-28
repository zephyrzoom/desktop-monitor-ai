use rusqlite::Connection;

/// 与旧版 Electron 实现完全一致的 schema，保证已有 monitor.db 可直接复用。
const MIGRATIONS: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS screenshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    file_path   TEXT    NOT NULL,
    file_size   INTEGER NOT NULL DEFAULT 0,
    width       INTEGER,
    height      INTEGER,
    trigger_type TEXT   NOT NULL DEFAULT 'timer',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  )"#,
    "CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp ON screenshots(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_screenshots_trigger ON screenshots(trigger_type)",
    r#"CREATE TABLE IF NOT EXISTS active_windows (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    app_name        TEXT    NOT NULL,
    window_title    TEXT    NOT NULL DEFAULT '',
    process_id      INTEGER,
    bundle_id       TEXT,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    screenshot_id   INTEGER,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    FOREIGN KEY (screenshot_id) REFERENCES screenshots(id)
  )"#,
    "CREATE INDEX IF NOT EXISTS idx_active_windows_timestamp ON active_windows(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_active_windows_app ON active_windows(app_name)",
    r#"CREATE TABLE IF NOT EXISTS daily_analysis (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL UNIQUE,
    result_json TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  )"#,
    "CREATE INDEX IF NOT EXISTS idx_daily_analysis_date ON daily_analysis(date)",
    r#"CREATE TABLE IF NOT EXISTS periodic_summary (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    period_type  TEXT    NOT NULL,
    period_label TEXT    NOT NULL,
    result_json  TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    UNIQUE(period_type, period_label)
  )"#,
    "CREATE INDEX IF NOT EXISTS idx_periodic_summary_type ON periodic_summary(period_type)",
    r#"CREATE TABLE IF NOT EXISTS monitor_state (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  )"#,
    r#"CREATE TABLE IF NOT EXISTS task_memory (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    task_summary          TEXT    NOT NULL,
    category              TEXT    NOT NULL DEFAULT '其他',
    app_cluster           TEXT    NOT NULL DEFAULT '[]',
    last_active_date      TEXT    NOT NULL,
    last_active_time      TEXT    NOT NULL,
    cumulative_duration_ms INTEGER NOT NULL DEFAULT 0,
    status                TEXT    NOT NULL DEFAULT 'active',
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  )"#,
    "CREATE INDEX IF NOT EXISTS idx_task_memory_status ON task_memory(status)",
    "CREATE INDEX IF NOT EXISTS idx_task_memory_date ON task_memory(last_active_date)",
];

pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let current = version(conn)?;

    for sql in MIGRATIONS.iter().skip(current) {
        conn.execute_batch(sql)?;
    }

    conn.execute(
        "INSERT OR REPLACE INTO monitor_state (key, value, updated_at)
         VALUES ('schema_version', ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))",
        [MIGRATIONS.len().to_string()],
    )?;

    Ok(())
}

fn version(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS monitor_state (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL,
           updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
         )",
    )?;

    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM monitor_state WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .ok();

    Ok(value.and_then(|v| v.parse::<usize>().ok()).unwrap_or(0))
}
