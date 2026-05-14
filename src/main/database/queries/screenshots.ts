import { getDatabase } from '../connection'
import type { Screenshot } from '../../../shared/types/database'

export function insertScreenshot(
  filePath: string,
  fileSize: number,
  width: number | null,
  height: number | null,
  triggerType: 'window_change' | 'timer'
): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT INTO screenshots (file_path, file_size, width, height, trigger_type)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(filePath, fileSize, width, height, triggerType)
  return Number(result.lastInsertRowid)
}

export function getScreenshotsByDate(date: string): Screenshot[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT * FROM screenshots
       WHERE date(timestamp) = ?
       ORDER BY timestamp ASC`
    )
    .all(date) as Screenshot[]
}

export function getScreenshotsByTimeRange(startTime: string, endTime: string): Screenshot[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT * FROM screenshots
       WHERE timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC`
    )
    .all(startTime, endTime) as Screenshot[]
}

export function getScreenshotCountByDate(date: string): number {
  const db = getDatabase()
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM screenshots
       WHERE date(timestamp) = ?`
    )
    .get(date) as { count: number }
  return row.count
}

export function deleteScreenshotsBeforeDate(date: string): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `DELETE FROM screenshots
       WHERE date(timestamp) < ?`
    )
    .run(date)
  return result.changes
}
