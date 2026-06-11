import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { runMigrations } from './migrations'
import { BetterSqlite3Database } from './backends/better-sqlite3'
import { SqlJsDatabase } from './backends/sqljs'
import { getConfig } from '../config/store'
import type { IDatabase } from './interfaces'

let db: IDatabase | null = null

export async function initializeDatabase(): Promise<void> {
  const config = getConfig()
  const backend = config.storage?.backend || 'better-sqlite3'
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'monitor.db')

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  if (backend === 'sql.js') {
    db = await SqlJsDatabase.create(dbPath)
  } else {
    db = new BetterSqlite3Database(dbPath)
  }

  runMigrations(db!)
}

export function getDatabase(): IDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.')
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
