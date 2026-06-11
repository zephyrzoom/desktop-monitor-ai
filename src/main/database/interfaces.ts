export interface IRunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface IStatement {
  run(...params: unknown[]): IRunResult
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

export interface IDatabase {
  exec(sql: string): void
  prepare(sql: string): IStatement
  close(): void
  flush?(): void
}
