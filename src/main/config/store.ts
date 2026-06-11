import { app } from 'electron'
import path from 'path'
import fs from 'fs'

interface Config {
  monitoring: {
    enabled: boolean
    screenshotIntervalMs: number
    windowPollIntervalMs: number
    windowChangeDebounceSec: number
    screenshotsDir: string
    monitoringStartTime: string
    monitoringEndTime: string
    idleTimeoutMinutes: number
  }
  analysis: {
    apiKey: string
    baseUrl: string
    model: string
    scheduleTime: string
    maxScreenshotsPerBatch: number
    gapThresholdMinutes: number
    taskMemoryDays: number
    maxRetries: number
  }
  cleanup: {
    retentionDays: number
  }
  storage: {
    backend: 'better-sqlite3' | 'sql.js'
  }
}

const defaults: Config = {
  monitoring: {
    enabled: true,
    screenshotIntervalMs: 10 * 60 * 1000,
    windowPollIntervalMs: 1000,
    windowChangeDebounceSec: 3,
    screenshotsDir: '',
    monitoringStartTime: '00:00',
    monitoringEndTime: '23:59',
    idleTimeoutMinutes: 5
  },
  analysis: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    scheduleTime: '23:00',
    maxScreenshotsPerBatch: 15,
    gapThresholdMinutes: 15,
    taskMemoryDays: 3,
    maxRetries: 3
  },
  cleanup: {
    retentionDays: 30
  },
  storage: {
    backend: 'better-sqlite3'
  }
}

let configCache: Config | null = null
let configPath: string | null = null

function getConfigPath(): string {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), 'config.json')
  }
  return configPath
}

function loadConfig(): Config {
  if (configCache) return configCache

  const filePath = getConfigPath()
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(data)
      configCache = {
        monitoring: { ...defaults.monitoring, ...parsed.monitoring },
        analysis: { ...defaults.analysis, ...parsed.analysis },
        cleanup: { ...defaults.cleanup, ...parsed.cleanup },
        storage: { ...defaults.storage, ...parsed.storage }
      }
    } else {
      configCache = { ...defaults }
      saveConfig(configCache)
    }
  } catch {
    configCache = { ...defaults }
  }

  return configCache!
}

function saveConfig(config: Config): void {
  const filePath = getConfigPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2))
  configCache = config
}

export function getConfig(): Config {
  return loadConfig()
}

export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  const config = loadConfig()
  return config[key]
}

export function setConfigValue<K extends keyof Config>(key: K, value: Config[K]): void {
  const config = loadConfig()
  config[key] = value
  saveConfig(config)
}

export function getFullConfig(): Config {
  return loadConfig()
}
