import { getDatabase } from '../connection'
import type { ActiveWindow } from '../../../shared/types/database'

export function insertActiveWindow(
  appName: string,
  windowTitle: string,
  processId: number | null,
  bundleId: string | null,
  durationMs: number,
  screenshotId: number | null
): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT INTO active_windows (app_name, window_title, process_id, bundle_id, duration_ms, screenshot_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(appName, windowTitle, processId, bundleId, durationMs, screenshotId)
  return Number(result.lastInsertRowid)
}

export function getActiveWindowsByDate(date: string): ActiveWindow[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT * FROM active_windows
       WHERE date(timestamp) = ?
       ORDER BY timestamp ASC`
    )
    .all(date) as ActiveWindow[]
}

export function getActiveWindowsByTimeRange(startTime: string, endTime: string): ActiveWindow[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT * FROM active_windows
       WHERE timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC`
    )
    .all(startTime, endTime) as ActiveWindow[]
}

export function getAppUsageSummaryByDate(
  date: string
): { app_name: string; total_duration_ms: number; count: number }[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT app_name,
              SUM(duration_ms) as total_duration_ms,
              COUNT(*) as count
       FROM active_windows
       WHERE date(timestamp) = ?
       GROUP BY app_name
       ORDER BY total_duration_ms DESC`
    )
    .all(date) as { app_name: string; total_duration_ms: number; count: number }[]
}

export function deleteActiveWindowsBeforeDate(date: string): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `DELETE FROM active_windows
       WHERE date(timestamp) < ?`
    )
    .run(date)
  return result.changes
}
