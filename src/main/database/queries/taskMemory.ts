import { getDatabase } from '../connection'
import type { TaskMemory } from '../../../shared/types/database'

export function insertTaskMemory(
  taskSummary: string,
  category: string,
  appCluster: string[],
  lastActiveDate: string,
  lastActiveTime: string,
  cumulativeDurationMs: number
): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT INTO task_memory (task_summary, category, app_cluster, last_active_date, last_active_time, cumulative_duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(taskSummary, category, JSON.stringify(appCluster), lastActiveDate, lastActiveTime, cumulativeDurationMs)
  return Number(result.lastInsertRowid)
}

export function getActiveTaskMemories(days: number): TaskMemory[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT * FROM task_memory
       WHERE status = 'active'
         AND last_active_date >= date('now', '-' || ? || ' days')
       ORDER BY last_active_date DESC, last_active_time DESC`
    )
    .all(days) as unknown as TaskMemory[]
}

export function updateTaskMemory(
  id: number,
  lastActiveDate: string,
  lastActiveTime: string,
  additionalDurationMs: number
): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE task_memory
     SET last_active_date = ?,
         last_active_time = ?,
         cumulative_duration_ms = cumulative_duration_ms + ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
     WHERE id = ?`
  ).run(lastActiveDate, lastActiveTime, additionalDurationMs, id)
}

export function completeTaskMemory(id: number): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE task_memory
     SET status = 'completed',
         updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
     WHERE id = ?`
  ).run(id)
}

export function expireStaleTaskMemories(days: number): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `UPDATE task_memory
       SET status = 'completed',
           updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE status = 'active'
         AND last_active_date < date('now', '-' || ? || ' days')`
    )
    .run(days)
  return result.changes
}

export function deleteTaskMemoriesBeforeDate(date: string): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `DELETE FROM task_memory
       WHERE last_active_date < ?`
    )
    .run(date)
  return result.changes
}
