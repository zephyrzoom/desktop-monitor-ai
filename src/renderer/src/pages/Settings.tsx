import React, { useState, useEffect } from 'react'

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
    backend: string
  }
}

export function Settings(): React.JSX.Element {
  const [config, setConfig] = useState<Config | null>(null)
  const [activeBackend, setActiveBackend] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig(): Promise<void> {
    try {
      const result = await window.electronAPI.getConfig()
      setConfig(result as Config)
      const backend = await window.electronAPI.getActiveBackend()
      setActiveBackend(backend as string)
    } catch (err) {
      console.error('Failed to load config:', err)
    }
  }

  async function handleSave(): Promise<void> {
    if (!config) return

    setSaving(true)
    try {
      await window.electronAPI.setConfig('analysis', config.analysis)
      await window.electronAPI.setConfig('monitoring', config.monitoring)
      await window.electronAPI.setConfig('cleanup', config.cleanup)
      await window.electronAPI.setConfig('storage', config.storage)
      setMessageType('success')
      setMessage('配置已保存')
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      console.error('Failed to save config:', err)
      setMessageType('error')
      setMessage('保存失败')
    } finally {
      setSaving(false)
    }
  }

  function updateAnalysis(key: keyof Config['analysis'], value: string | number): void {
    if (!config) return
    setConfig({
      ...config,
      analysis: { ...config.analysis, [key]: value }
    })
  }

  function updateMonitoring(key: keyof Config['monitoring'], value: boolean | number | string): void {
    if (!config) return
    setConfig({
      ...config,
      monitoring: { ...config.monitoring, [key]: value }
    })
  }

  function updateCleanup(key: keyof Config['cleanup'], value: number): void {
    if (!config) return
    setConfig({
      ...config,
      cleanup: { ...config.cleanup, [key]: value }
    })
  }

  function updateStorage(key: keyof Config['storage'], value: string): void {
    if (!config) return
    setConfig({
      ...config,
      storage: { ...config.storage, [key]: value }
    })
  }

  if (!config) {
    return <div className="loading">加载中...</div>
  }

  return (
    <div>
      <div className="page-header">
        <h2>配置</h2>
      </div>

      {message && (
        <div
          style={{
            padding: '12px 20px',
            backgroundColor: messageType === 'error' ? 'var(--error)' : 'var(--success)',
            borderRadius: '8px',
            marginBottom: '24px',
            animation: 'fadeIn 0.3s ease-in'
          }}
        >
          {messageType === 'error' ? '❌ ' : '✓ '}{message}
        </div>
      )}

      <div className="card">
        <div className="card-title">AI 分析配置</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>API Key</label>
            <input
              type="password"
              value={config.analysis.apiKey}
              onChange={(e) => updateAnalysis('apiKey', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>Base URL</label>
            <input
              type="text"
              value={config.analysis.baseUrl}
              onChange={(e) => updateAnalysis('baseUrl', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>模型</label>
            <input
              type="text"
              value={config.analysis.model}
              onChange={(e) => updateAnalysis('model', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>每日分析时间</label>
            <input
              type="time"
              value={config.analysis.scheduleTime}
              onChange={(e) => updateAnalysis('scheduleTime', e.target.value)}
              style={{
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>每批最大截图数</label>
            <input
              type="number"
              min={1}
              max={30}
              value={config.analysis.maxScreenshotsPerBatch}
              onChange={(e) => updateAnalysis('maxScreenshotsPerBatch', parseInt(e.target.value))}
              style={{
                width: '100px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>分批间隔（分钟）</label>
            <input
              type="number"
              min={5}
              max={60}
              value={config.analysis.gapThresholdMinutes}
              onChange={(e) => updateAnalysis('gapThresholdMinutes', parseInt(e.target.value))}
              style={{
                width: '100px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>任务记忆回溯天数</label>
            <input
              type="number"
              min={1}
              max={30}
              value={config.analysis.taskMemoryDays}
              onChange={(e) => updateAnalysis('taskMemoryDays', parseInt(e.target.value))}
              style={{
                width: '100px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              分析时回溯最近 N 天的任务记忆，用于识别跨天延续的任务
            </span>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>API 重试次数</label>
            <input
              type="number"
              min={0}
              max={10}
              value={config.analysis.maxRetries ?? 3}
              onChange={(e) => updateAnalysis('maxRetries', parseInt(e.target.value))}
              style={{
                width: '100px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              调用大模型失败时的重试次数，适用于超时或返回为空的情况
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">监控配置</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>监控时间段</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="time"
                value={config.monitoring.monitoringStartTime || '00:00'}
                onChange={(e) => updateMonitoring('monitoringStartTime', e.target.value)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)'
                }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>至</span>
              <input
                type="time"
                value={config.monitoring.monitoringEndTime || '23:59'}
                onChange={(e) => updateMonitoring('monitoringEndTime', e.target.value)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              仅在指定时间段内进行监控，默认全天监控
            </span>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>空闲暂停时间 (分钟)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={config.monitoring.idleTimeoutMinutes ?? 5}
              onChange={(e) => updateMonitoring('idleTimeoutMinutes', parseInt(e.target.value))}
              style={{
                width: '200px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              鼠标键盘无操作超过此时间自动暂停监控，有操作后自动恢复
            </span>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>定时截图间隔 (分钟)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={Math.round(config.monitoring.screenshotIntervalMs / 60000)}
              onChange={(e) => updateMonitoring('screenshotIntervalMs', parseInt(e.target.value) * 60000)}
              style={{
                width: '200px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>窗口切换防抖时间（秒）</label>
            <input
              type="number"
              min={1}
              step={1}
              value={config.monitoring.windowChangeDebounceSec}
              onChange={(e) => updateMonitoring('windowChangeDebounceSec', parseInt(e.target.value))}
              style={{
                width: '200px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>截图存储路径</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={config.monitoring.screenshotsDir}
                placeholder="默认: 应用数据目录/screenshots"
                onChange={(e) => updateMonitoring('screenshotsDir', e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)'
                }}
              />
              <button
                className="button button-secondary"
                onClick={async () => {
                  const dir = await window.electronAPI.getScreenshotsDir()
                  window.electronAPI.openPath(dir as string)
                }}
              >
                打开文件夹
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">数据清理</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>数据保留天数</label>
            <input
              type="number"
              min={1}
              value={config.cleanup.retentionDays}
              onChange={(e) => updateCleanup('retentionDays', parseInt(e.target.value))}
              style={{
                width: '100px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">存储配置</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px' }}>数据库类型</label>
            <select
              value={config.storage?.backend || 'better-sqlite3'}
              onChange={(e) => updateStorage('backend', e.target.value)}
              style={{
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            >
              <option value="better-sqlite3">SQLite (better-sqlite3)</option>
              <option value="sql.js">SQLite (sql.js 纯JS版)</option>
            </select>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              当前实际使用: {activeBackend === 'sql.js' ? 'sql.js 纯JS版' : 'better-sqlite3'}
              {config.storage?.backend !== activeBackend && (
                <span style={{ color: 'var(--warning, #f59e0b)', marginLeft: '8px' }}>
                  (better-sqlite3 加载失败，已自动降级)
                </span>
              )}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              切换数据库类型后需要重启应用才能生效
            </span>
          </div>
        </div>
      </div>

      <button className="button button-primary" onClick={handleSave} disabled={saving}>
        {saving ? '保存中...' : '保存配置'}
      </button>
    </div>
  )
}
