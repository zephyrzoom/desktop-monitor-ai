import React, { useState, useEffect } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Alert } from '../components/Alert'
import { Icon } from '../components/Icon'
import { APP_VERSION, getBuildTime, getPlatformName } from '../lib/version'

interface Config {
  general: {
    launchAtStartup: boolean
  }
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
    customHeaders: string
    scheduleTime: string
    autoQuarterly: boolean
    autoYearly: boolean
    maxScreenshotsPerBatch: number
    gapThresholdMinutes: number
    taskMemoryDays: number
    maxRetries: number
  }
  cleanup: {
    retentionDays: number
  }
  storage: {
    backend: string
  }
}

export function Settings(): React.JSX.Element {
  const [config, setConfig] = useState<Config | null>(null)
  const [activeBackend, setActiveBackend] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig(): Promise<void> {
    try {
      const result = await window.api.getConfig()
      setConfig(result as Config)
      const backend = await window.api.getActiveBackend()
      setActiveBackend(backend as string)
    } catch (err) {
      console.error('Failed to load config:', err)
    }
  }

  async function handleSave(): Promise<void> {
    if (!config) return

    setSaving(true)
    try {
      await window.api.setConfig('general', config.general)
      await window.api.setConfig('analysis', config.analysis)
      await window.api.setConfig('monitoring', config.monitoring)
      await window.api.setConfig('cleanup', config.cleanup)
      await window.api.setConfig('storage', config.storage)
      setMessageType('success')
      setMessage('配置已保存')
      setDirty(false)
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      console.error('Failed to save config:', err)
      setMessageType('error')
      setMessage('保存失败')
    } finally {
      setSaving(false)
    }
  }

  function updateGeneral(key: keyof Config['general'], value: boolean): void {
    if (!config) return
    setConfig({
      ...config,
      general: { ...config.general, [key]: value }
    })
    setDirty(true)
  }

  function updateAnalysis(
    key: keyof Config['analysis'],
    value: string | number | boolean
  ): void {
    if (!config) return
    setConfig({
      ...config,
      analysis: { ...config.analysis, [key]: value }
    })
    setDirty(true)
  }

  function updateMonitoring(
    key: keyof Config['monitoring'],
    value: boolean | number | string
  ): void {
    if (!config) return
    setConfig({
      ...config,
      monitoring: { ...config.monitoring, [key]: value }
    })
    setDirty(true)
  }

  function updateCleanup(key: keyof Config['cleanup'], value: number): void {
    if (!config) return
    setConfig({
      ...config,
      cleanup: { ...config.cleanup, [key]: value }
    })
    setDirty(true)
  }

  if (!config) {
    return (
      <div className="page-loading">
        <span className="spinner" />
        加载中…
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="配置" description="监控频率、AI 接口与数据保留策略，修改后需保存生效" />

      {message && <Alert tone={messageType === 'error' ? 'error' : 'success'}>{message}</Alert>}

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Icon name="monitor" size={15} />
            通用
          </h3>
        </div>
        <div className="switch-row">
          <div className="field">
            <span className="field-label">开机自启动</span>
            <span className="field-hint">登录系统后自动启动应用，仅 Windows / macOS 生效</span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.general?.launchAtStartup ?? false}
              onChange={(e) => updateGeneral('launchAtStartup', e.target.checked)}
            />
            <span className="switch-slider" />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Icon name="sparkles" size={15} />
            AI 分析
          </h3>
        </div>

        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="apiKey">
              API Key
            </label>
            <input
              id="apiKey"
              className="input"
              type="password"
              placeholder="sk-..."
              value={config.analysis.apiKey}
              onChange={(e) => updateAnalysis('apiKey', e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="baseUrl">
              Base URL
            </label>
            <input
              id="baseUrl"
              className="input"
              type="text"
              placeholder="https://api.openai.com/v1"
              value={config.analysis.baseUrl}
              onChange={(e) => updateAnalysis('baseUrl', e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="model">
              模型
            </label>
            <input
              id="model"
              className="input"
              type="text"
              placeholder="gpt-4o-mini"
              value={config.analysis.model}
              onChange={(e) => updateAnalysis('model', e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="scheduleTime">
              每日分析时间
            </label>
            <input
              id="scheduleTime"
              className="input input-time"
              type="time"
              value={config.analysis.scheduleTime}
              onChange={(e) => updateAnalysis('scheduleTime', e.target.value)}
            />
            <span className="field-hint">每天到点自动生成当日日报</span>
          </div>

          <div className="field field-full">
            <label className="field-label" htmlFor="customHeaders">
              自定义请求头
            </label>
            <textarea
              id="customHeaders"
              className="input input-textarea"
              value={config.analysis.customHeaders ?? ''}
              placeholder={'X-Custom-Header: value\nX-Api-Version: 2024-01-01'}
              onChange={(e) => updateAnalysis('customHeaders', e.target.value)}
              rows={3}
            />
            <span className="field-hint">
              部分中转/企业 API 需要额外报文头。每行一条，格式 Key: Value，以 # 开头的行忽略
            </span>
          </div>
        </div>

        <p className="form-divider">自动汇总</p>

        <div className="switch-row">
          <div className="field">
            <span className="field-label">季度汇总</span>
            <span className="field-hint">
              季度结束后，随每日分析自动生成上一季度的汇总；已生成过则跳过
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.analysis.autoQuarterly ?? true}
              onChange={(e) => updateAnalysis('autoQuarterly', e.target.checked)}
            />
            <span className="switch-slider" />
          </label>
        </div>

        <div className="switch-row">
          <div className="field">
            <span className="field-label">年度汇总</span>
            <span className="field-hint">
              每年结束后，随每日分析自动生成上一年度的汇总；已生成过则跳过
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.analysis.autoYearly ?? true}
              onChange={(e) => updateAnalysis('autoYearly', e.target.checked)}
            />
            <span className="switch-slider" />
          </label>
        </div>

        <p className="form-divider">分析参数</p>

        <div className="form-grid form-grid-3">
          <div className="field">
            <label className="field-label" htmlFor="maxScreenshotsPerBatch">
              每批最大截图数
            </label>
            <input
              id="maxScreenshotsPerBatch"
              className="input input-num"
              type="number"
              min={1}
              max={30}
              value={config.analysis.maxScreenshotsPerBatch}
              onChange={(e) => updateAnalysis('maxScreenshotsPerBatch', parseInt(e.target.value))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="gapThresholdMinutes">
              分批间隔（分钟）
            </label>
            <input
              id="gapThresholdMinutes"
              className="input input-num"
              type="number"
              min={5}
              max={60}
              value={config.analysis.gapThresholdMinutes}
              onChange={(e) => updateAnalysis('gapThresholdMinutes', parseInt(e.target.value))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="maxRetries">
              API 重试次数
            </label>
            <input
              id="maxRetries"
              className="input input-num"
              type="number"
              min={0}
              max={10}
              value={config.analysis.maxRetries ?? 3}
              onChange={(e) => updateAnalysis('maxRetries', parseInt(e.target.value))}
            />
            <span className="field-hint">超时或返回为空时的重试次数</span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="taskMemoryDays">
              任务记忆回溯天数
            </label>
            <input
              id="taskMemoryDays"
              className="input input-num"
              type="number"
              min={1}
              max={30}
              value={config.analysis.taskMemoryDays}
              onChange={(e) => updateAnalysis('taskMemoryDays', parseInt(e.target.value))}
            />
            <span className="field-hint">回溯最近 N 天，识别跨天延续的任务</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Icon name="window" size={15} />
            监控
          </h3>
        </div>

        <div className="form-grid">
          <div className="field">
            <span className="field-label">监控时间段</span>
            <div className="inline-fields">
              <input
                className="input input-time"
                type="time"
                aria-label="监控开始时间"
                value={config.monitoring.monitoringStartTime || '00:00'}
                onChange={(e) => updateMonitoring('monitoringStartTime', e.target.value)}
              />
              <span className="inline-sep">至</span>
              <input
                className="input input-time"
                type="time"
                aria-label="监控结束时间"
                value={config.monitoring.monitoringEndTime || '23:59'}
                onChange={(e) => updateMonitoring('monitoringEndTime', e.target.value)}
              />
            </div>
            <span className="field-hint">只在指定时间段内监控，默认全天</span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="idleTimeoutMinutes">
              空闲暂停时间（分钟）
            </label>
            <input
              id="idleTimeoutMinutes"
              className="input input-num"
              type="number"
              min={1}
              step={1}
              value={config.monitoring.idleTimeoutMinutes ?? 5}
              onChange={(e) => updateMonitoring('idleTimeoutMinutes', parseInt(e.target.value))}
            />
            <span className="field-hint">无操作超过此时间自动暂停，有操作后自动恢复</span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="screenshotInterval">
              截图间隔（分钟）
            </label>
            <input
              id="screenshotInterval"
              className="input input-num"
              type="number"
              min={1}
              step={1}
              value={Math.round(config.monitoring.screenshotIntervalMs / 60000)}
              onChange={(e) =>
                updateMonitoring('screenshotIntervalMs', parseInt(e.target.value) * 60000)
              }
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="windowChangeDebounce">
              窗口切换防抖（秒）
            </label>
            <input
              id="windowChangeDebounce"
              className="input input-num"
              type="number"
              min={1}
              step={1}
              value={config.monitoring.windowChangeDebounceSec}
              onChange={(e) =>
                updateMonitoring('windowChangeDebounceSec', parseInt(e.target.value))
              }
            />
            <span className="field-hint">切换窗口后等待多久再记录，避免抖动</span>
          </div>

          <div className="field field-full">
            <label className="field-label" htmlFor="screenshotsDir">
              截图存储路径
            </label>
            <div className="inline-fields">
              <input
                id="screenshotsDir"
                className="input"
                type="text"
                placeholder="默认：应用数据目录/screenshots"
                value={config.monitoring.screenshotsDir}
                onChange={(e) => updateMonitoring('screenshotsDir', e.target.value)}
              />
              <button
                type="button"
                className="button button-secondary"
                onClick={async () => {
                  const dir = await window.api.getScreenshotsDir()
                  window.api.openPath(dir as string)
                }}
              >
                <Icon name="folder" size={14} />
                打开
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Icon name="trash" size={15} />
            数据清理
          </h3>
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="retentionDays">
              数据保留天数
            </label>
            <input
              id="retentionDays"
              className="input input-num"
              type="number"
              min={1}
              value={config.cleanup.retentionDays}
              onChange={(e) => updateCleanup('retentionDays', parseInt(e.target.value))}
            />
            <span className="field-hint">超过天数的截图与记录会被清理</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Icon name="database" size={15} />
            存储
          </h3>
        </div>
        <dl className="info-list">
          <div className="info-row">
            <dt>数据库</dt>
            <dd>SQLite（内置 rusqlite，WAL 模式）</dd>
          </div>
          <div className="info-row">
            <dt>当前驱动</dt>
            <dd className="mono">{activeBackend || 'rusqlite'}</dd>
          </div>
          <div className="info-row">
            <dt>数据文件</dt>
            <dd>应用数据目录 / monitor.db</dd>
          </div>
        </dl>
        <p className="field-hint">Tauri 版本内置 SQLite 驱动，无需再选择其他后端。</p>
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Icon name="info" size={15} />
            关于
          </h3>
        </div>
        <dl className="info-list">
          <div className="info-row">
            <dt>当前版本</dt>
            <dd className="mono">v{APP_VERSION}</dd>
          </div>
          <div className="info-row">
            <dt>构建时间</dt>
            <dd className="mono">{getBuildTime() || '未知'}</dd>
          </div>
          <div className="info-row">
            <dt>运行平台</dt>
            <dd className="mono">{getPlatformName()}</dd>
          </div>
        </dl>
      </section>

      <div className="save-bar">
        <span className={`save-hint${dirty ? ' dirty' : ''}`}>
          {dirty ? '有未保存的修改' : '所有配置已保存'}
        </span>
        <button
          type="button"
          className="button button-primary"
          onClick={handleSave}
          disabled={saving}
        >
          <Icon name="save" size={15} />
          {saving ? '保存中…' : '保存配置'}
        </button>
      </div>
    </div>
  )
}
