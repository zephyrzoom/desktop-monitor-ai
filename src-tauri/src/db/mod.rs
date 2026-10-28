pub mod migrations;
pub mod queries;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

pub use types::*;

/// 单连接 SQLite 封装。旧版的 better-sqlite3 / sql.js 双后端已取消，
/// 统一使用捆绑编译的 rusqlite（WAL 模式），行为等价且无需原生模块编译。
pub struct Database {
    conn: Mutex<Connection>,
    #[allow(dead_code)]
    path: PathBuf,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        // journal_mode 会返回查询结果，不能用 pragma_update（会报 ExecuteReturnedResults）
        let _: String = conn
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| e.to_string())?;

        migrations::run(&conn).map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        })
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }
}
