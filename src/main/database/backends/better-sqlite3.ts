import Database from 'better-sqlite3'
import type { IDatabase, IStatement, IRunResult } from '../interfaces'

class BetterSqlite3Statement implements IStatement {
  constructor(private stmt: Database.Statement) {}

  run(...params: unknown[]): IRunResult {
    const result = this.stmt.run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.stmt.get(...params) as Record<string, unknown> | undefined
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.stmt.all(...params) as Record<string, unknown>[]
  }
}

export class BetterSqlite3Database implements IDatabase {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): IStatement {
    return new BetterSqlite3Statement(this.db.prepare(sql))
  }

  close(): void {
    this.db.close()
  }
}
