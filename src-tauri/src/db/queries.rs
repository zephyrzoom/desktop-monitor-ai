use rusqlite::{params, Connection, Row};

use super::types::*;
use super::Database;

fn map_screenshot(row: &Row) -> rusqlite::Result<Screenshot> {
    Ok(Screenshot {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        file_path: row.get(2)?,
        file_size: row.get(3)?,
        width: row.get(4)?,
        height: row.get(5)?,
        trigger_type: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn map_active_window(row: &Row) -> rusqlite::Result<ActiveWindow> {
    Ok(ActiveWindow {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        app_name: row.get(2)?,
        window_title: row.get(3)?,
        process_id: row.get(4)?,
        bundle_id: row.get(5)?,
        duration_ms: row.get(6)?,
        screenshot_id: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn map_daily_analysis(row: &Row) -> rusqlite::Result<DailyAnalysis> {
    Ok(DailyAnalysis {
        id: row.get(0)?,
        date: row.get(1)?,
        result_json: row.get(2)?,
        created_at: row.get(3)?,
    })
}

fn map_periodic_summary(row: &Row) -> rusqlite::Result<PeriodicSummary> {
    Ok(PeriodicSummary {
        id: row.get(0)?,
        period_type: row.get(1)?,
        period_label: row.get(2)?,
        result_json: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn map_task_memory(row: &Row) -> rusqlite::Result<TaskMemory> {
    Ok(TaskMemory {
        id: row.get(0)?,
        task_summary: row.get(1)?,
        category: row.get(2)?,
        app_cluster: row.get(3)?,
        last_active_date: row.get(4)?,
        last_active_time: row.get(5)?,
        cumulative_duration_ms: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn collect<T, F>(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
    map: F,
) -> Result<Vec<T>, String>
where
    F: Fn(&Row) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| map(row))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<T>>>()
        .map_err(|e| e.to_string())
}

impl Database {
    // ---------------- screenshots ----------------

    pub fn insert_screenshot(
        &self,
        file_path: &str,
        file_size: i64,
        width: i64,
        height: i64,
        trigger_type: &str,
    ) -> Result<i64, String> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO screenshots (file_path, file_size, width, height, trigger_type)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![file_path, file_size, width, height, trigger_type],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn screenshots_by_date(&self, date: &str) -> Result<Vec<Screenshot>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT * FROM screenshots WHERE date(timestamp) = ?1 ORDER BY timestamp ASC",
            &[&date],
            map_screenshot,
        )
    }

    pub fn screenshot_count_by_date(&self, date: &str) -> Result<i64, String> {
        let conn = self.conn();
        conn.query_row(
            "SELECT COUNT(*) FROM screenshots WHERE date(timestamp) = ?1",
            params![date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
    }

    pub fn screenshots_before_date(&self, date: &str) -> Result<Vec<Screenshot>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT * FROM screenshots WHERE date(timestamp) < ?1 ORDER BY timestamp ASC",
            &[&date],
            map_screenshot,
        )
    }

    pub fn delete_screenshots_before_date(&self, date: &str) -> Result<usize, String> {
        let conn = self.conn();
        // 先解除 active_windows 对即将删除截图的引用，避免外键约束导致删除失败
        conn.execute(
            "UPDATE active_windows SET screenshot_id = NULL
             WHERE screenshot_id IN (SELECT id FROM screenshots WHERE date(timestamp) < ?1)",
            params![date],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "DELETE FROM screenshots WHERE date(timestamp) < ?1",
            params![date],
        )
        .map_err(|e| e.to_string())
    }

    pub fn dates_with_screenshots_in_range(
        &self,
        start: &str,
        end: &str,
    ) -> Result<Vec<String>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT DISTINCT date(timestamp) AS d FROM screenshots
             WHERE date(timestamp) >= ?1 AND date(timestamp) <= ?2",
            &[&start, &end],
            |row| row.get(0),
        )
    }

    pub fn all_dates_with_screenshots(&self) -> Result<Vec<String>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT DISTINCT date(timestamp) AS d FROM screenshots ORDER BY d ASC",
            &[],
            |row| row.get(0),
        )
    }

    // ---------------- active windows ----------------

    pub fn insert_active_window(
        &self,
        app_name: &str,
        window_title: &str,
        process_id: Option<i64>,
        bundle_id: Option<&str>,
        duration_ms: i64,
        screenshot_id: Option<i64>,
    ) -> Result<i64, String> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO active_windows (app_name, window_title, process_id, bundle_id, duration_ms, screenshot_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![app_name, window_title, process_id, bundle_id, duration_ms, screenshot_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn active_windows_by_date(&self, date: &str) -> Result<Vec<ActiveWindow>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT * FROM active_windows WHERE date(timestamp) = ?1 ORDER BY timestamp ASC",
            &[&date],
            map_active_window,
        )
    }

    pub fn app_usage_by_date(&self, date: &str) -> Result<Vec<AppUsage>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT app_name, SUM(duration_ms) AS total_duration_ms, COUNT(*) AS count
             FROM active_windows WHERE date(timestamp) = ?1
             GROUP BY app_name ORDER BY total_duration_ms DESC",
            &[&date],
            |row| {
                Ok(AppUsage {
                    app_name: row.get(0)?,
                    total_duration_ms: row.get(1)?,
                    count: row.get(2)?,
                })
            },
        )
    }

    pub fn app_usage_by_range(&self, start: &str, end: &str) -> Result<Vec<AppUsage>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT app_name, SUM(duration_ms) AS total_duration_ms, COUNT(*) AS count
             FROM active_windows WHERE timestamp >= ?1 AND timestamp <= ?2
             GROUP BY app_name ORDER BY total_duration_ms DESC",
            &[&start, &end],
            |row| {
                Ok(AppUsage {
                    app_name: row.get(0)?,
                    total_duration_ms: row.get(1)?,
                    count: row.get(2)?,
                })
            },
        )
    }

    pub fn window_switch_sequence(
        &self,
        start: &str,
        end: &str,
    ) -> Result<Vec<WindowSwitch>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT substr(timestamp, 12, 5) AS time, app_name, window_title
             FROM active_windows WHERE timestamp >= ?1 AND timestamp <= ?2
             ORDER BY timestamp ASC",
            &[&start, &end],
            |row| {
                Ok(WindowSwitch {
                    time: row.get(0)?,
                    app_name: row.get(1)?,
                    window_title: row.get(2)?,
                })
            },
        )
    }

    pub fn delete_active_windows_before_date(&self, date: &str) -> Result<usize, String> {
        let conn = self.conn();
        conn.execute(
            "DELETE FROM active_windows WHERE date(timestamp) < ?1",
            params![date],
        )
        .map_err(|e| e.to_string())
    }

    // ---------------- daily analysis ----------------

    pub fn upsert_daily_analysis(&self, date: &str, result_json: &str) -> Result<(), String> {
        let conn = self.conn();
        conn.execute(
            "INSERT OR REPLACE INTO daily_analysis (date, result_json) VALUES (?1, ?2)",
            params![date, result_json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn daily_analysis_by_date(&self, date: &str) -> Result<Option<DailyAnalysis>, String> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT * FROM daily_analysis WHERE date = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(params![date], map_daily_analysis)
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(row) => Ok(Some(row.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    pub fn daily_analysis_in_range(
        &self,
        start: &str,
        end: &str,
    ) -> Result<Vec<DailyAnalysis>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT * FROM daily_analysis WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC",
            &[&start, &end],
            map_daily_analysis,
        )
    }

    pub fn all_daily_analysis(&self) -> Result<Vec<DailyAnalysis>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT * FROM daily_analysis ORDER BY date DESC",
            &[],
            map_daily_analysis,
        )
    }

    // ---------------- periodic summary ----------------

    pub fn upsert_periodic_summary(
        &self,
        period_type: &str,
        period_label: &str,
        result_json: &str,
    ) -> Result<(), String> {
        let conn = self.conn();
        conn.execute(
            "INSERT OR REPLACE INTO periodic_summary (period_type, period_label, result_json)
             VALUES (?1, ?2, ?3)",
            params![period_type, period_label, result_json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn periodic_summary(
        &self,
        period_type: &str,
        period_label: &str,
    ) -> Result<Option<PeriodicSummary>, String> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT * FROM periodic_summary WHERE period_type = ?1 AND period_label = ?2")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(params![period_type, period_label], map_periodic_summary)
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(row) => Ok(Some(row.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    pub fn periodic_summaries_by_type(
        &self,
        period_type: &str,
    ) -> Result<Vec<PeriodicSummary>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT * FROM periodic_summary WHERE period_type = ?1 ORDER BY period_label DESC",
            &[&period_type],
            map_periodic_summary,
        )
    }

    // ---------------- task memory ----------------

    pub fn insert_task_memory(
        &self,
        task_summary: &str,
        category: &str,
        app_cluster: &[String],
        last_active_date: &str,
        last_active_time: &str,
        cumulative_duration_ms: i64,
    ) -> Result<i64, String> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO task_memory
                (task_summary, category, app_cluster, last_active_date, last_active_time, cumulative_duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                task_summary,
                category,
                serde_json::to_string(app_cluster).unwrap_or_else(|_| "[]".to_string()),
                last_active_date,
                last_active_time,
                cumulative_duration_ms
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn active_task_memories(&self, days: i64) -> Result<Vec<TaskMemory>, String> {
        let conn = self.conn();
        collect(
            &conn,
            "SELECT * FROM task_memory
             WHERE status = 'active' AND last_active_date >= date('now', '-' || ?1 || ' days')
             ORDER BY last_active_date DESC, last_active_time DESC",
            &[&days],
            map_task_memory,
        )
    }

    pub fn update_task_memory(
        &self,
        id: i64,
        last_active_date: &str,
        last_active_time: &str,
        additional_duration_ms: i64,
    ) -> Result<(), String> {
        let conn = self.conn();
        conn.execute(
            "UPDATE task_memory
             SET last_active_date = ?2,
                 last_active_time = ?3,
                 cumulative_duration_ms = cumulative_duration_ms + ?4,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
             WHERE id = ?1",
            params![
                id,
                last_active_date,
                last_active_time,
                additional_duration_ms
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn expire_stale_task_memories(&self, days: i64) -> Result<usize, String> {
        let conn = self.conn();
        conn.execute(
            "UPDATE task_memory
             SET status = 'completed',
                 updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
             WHERE status = 'active' AND last_active_date < date('now', '-' || ?1 || ' days')",
            params![days],
        )
        .map_err(|e| e.to_string())
    }

    pub fn delete_task_memories_before_date(&self, date: &str) -> Result<usize, String> {
        let conn = self.conn();
        conn.execute(
            "DELETE FROM task_memory WHERE last_active_date < ?1",
            params![date],
        )
        .map_err(|e| e.to_string())
    }
}
