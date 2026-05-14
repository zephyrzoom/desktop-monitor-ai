import { getDatabase } from '../connection'
import type { PeriodicSummary } from '../../../shared/types/database'

export function insertOrUpdatePeriodicSummary(
  periodType: 'quarter' | 'year',
  periodLabel: string,
  resultJson: string
): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT OR REPLACE INTO periodic_summary (period_type, period_label, result_json)
       VALUES (?, ?, ?)`
    )
    .run(periodType, periodLabel, resultJson)
  return Number(result.lastInsertRowid)
}

export function getPeriodicSummary(
  periodType: 'quarter' | 'year',
  periodLabel: string
): PeriodicSummary | null {
  const db = getDatabase()
  const row = db
    .prepare(
      `SELECT * FROM periodic_summary
       WHERE period_type = ? AND period_label = ?`
    )
    .get(periodType, periodLabel) as PeriodicSummary | undefined
  return row || null
}

export function getPeriodicSummariesByType(periodType: 'quarter' | 'year'): PeriodicSummary[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT * FROM periodic_summary
       WHERE period_type = ?
       ORDER BY period_label DESC`
    )
    .all(periodType) as PeriodicSummary[]
}
