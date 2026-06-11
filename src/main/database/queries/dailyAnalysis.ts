import { getDatabase } from '../connection'
import type { DailyAnalysis } from '../../../shared/types/database'

export function insertOrUpdateDailyAnalysis(date: string, resultJson: string): number {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT OR REPLACE INTO daily_analysis (date, result_json)
       VALUES (?, ?)`
    )
    .run(date, resultJson)
  return Number(result.lastInsertRowid)
}

export function getDailyAnalysisByDate(date: string): DailyAnalysis | null {
  const db = getDatabase()
  const row = db
    .prepare(
      `SELECT * FROM daily_analysis
       WHERE date = ?`
    )
    .get(date) as unknown as DailyAnalysis | undefined
  return row || null
}

export function getDailyAnalysisByDateRange(startDate: string, endDate: string): DailyAnalysis[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT * FROM daily_analysis
       WHERE date >= ? AND date <= ?
       ORDER BY date ASC`
    )
    .all(startDate, endDate) as unknown as DailyAnalysis[]
}

export function getAllDailyAnalysis(): DailyAnalysis[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT * FROM daily_analysis
       ORDER BY date DESC`
    )
    .all() as unknown as DailyAnalysis[]
}
