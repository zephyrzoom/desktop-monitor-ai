import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const LOG_RETENTION_DAYS = 7

let logDir = ''
let currentDate = ''

function getLogDir(): string {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

function getDateStr(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getTimestamp(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `${h}:${min}:${s}.${ms}`
}

function getLogFilePath(): string {
  const dateStr = getDateStr()
  if (dateStr !== currentDate) {
    currentDate = dateStr
    cleanupOldLogs()
  }
  return path.join(getLogDir(), `${dateStr}.log`)
}

function cleanupOldLogs(): void {
  try {
    const dir = getLogDir()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - LOG_RETENTION_DAYS)
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`

    const files = fs.readdirSync(dir)
    for (const file of files) {
      if (!file.endsWith('.log')) continue
      const datePart = file.replace('.log', '')
      if (datePart < cutoffStr) {
        fs.unlinkSync(path.join(dir, file))
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

function write(level: string, ...args: unknown[]): void {
  const timestamp = getTimestamp()
  const msg = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
    .join(' ')
  const line = `[${timestamp}] [${level}] ${msg}\n`

  try {
    fs.appendFileSync(getLogFilePath(), line, 'utf-8')
  } catch {
    // ignore write errors
  }

  // Also output to console in dev
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log
    consoleFn(line.trimEnd())
  }
}

export const logger = {
  info: (...args: unknown[]) => write('INFO', ...args),
  warn: (...args: unknown[]) => write('WARN', ...args),
  error: (...args: unknown[]) => write('ERROR', ...args),
  debug: (...args: unknown[]) => write('DEBUG', ...args)
}
