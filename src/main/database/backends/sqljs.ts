import initSqlJs, { Database as SqlJsRawDatabase } from 'sql.js'
import fs from 'fs'
import type { IDatabase, IStatement, IRunResult } from '../interfaces'

class SqlJsStatement implements IStatement {
  constructor(
    private db: SqlJsRawDatabase,
    private sql: string
  ) {}

  run(...params: unknown[]): IRunResult {
    this.db.run(this.sql, params as any[])
    const changes = this.db.getRowsModified()
    const result = this.db.exec('SELECT last_insert_rowid()')
    const lastInsertRowid = result.length > 0 ? (result[0].values[0][0] as number) : 0
    return { changes, lastInsertRowid }
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(this.sql)
    stmt.bind(params as any[])
    let row: Record<string, unknown> | undefined
    if (stmt.step()) {
      row = stmt.getAsObject() as Record<string, unknown>
    }
    stmt.free()
    return row
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(this.sql)
    stmt.bind(params as any[])
    const rows: Record<string, unknown>[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>)
    }
    stmt.free()
    return rows
  }
}

export class SqlJsDatabase implements IDatabase {
  private db: SqlJsRawDatabase
  private dbPath: string
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private vacuumTimer: ReturnType<typeof setInterval> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(db: SqlJsRawDatabase, dbPath: string) {
    this.db = db
    this.dbPath = dbPath
    this.flushTimer = setInterval(() => this.persist(), 60_000)
    this.vacuumTimer = setInterval(() => {
      this.db.run('VACUUM')
      this.persist()
    }, 30 * 60_000)
  }

  static async create(dbPath: string): Promise<SqlJsDatabase> {
    const SQL = await initSqlJs()
    let dbFile: Buffer | undefined
    if (fs.existsSync(dbPath)) {
      dbFile = fs.readFileSync(dbPath)
    }
    const db = new SQL.Database(dbFile)
    return new SqlJsDatabase(db, dbPath)
  }

  private persist(): void {
    const data = this.db.export()
    if (data.length > 100 * 1024 * 1024) {
      console.warn(
        `[sql.js] 数据库大小 ${(data.length / 1024 / 1024).toFixed(1)}MB，建议缩短数据保留天数`
      )
    }
    fs.writeFileSync(this.dbPath, Buffer.from(data))
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.persist(), 5000)
  }

  exec(sql: string): void {
    this.db.exec(sql)
    this.scheduleFlush()
  }

  prepare(sql: string): IStatement {
    return new SqlJsStatement(this.db, sql)
  }

  flush(): void {
    this.persist()
  }

  close(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.vacuumTimer) clearInterval(this.vacuumTimer)
    this.persist()
    this.db.close()
  }
}
