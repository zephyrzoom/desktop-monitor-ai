import React, { useState, useEffect } from 'react'

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
  }

  function updateAnalysis(key: keyof Config['analysis'], value: string | number): void {
    if (!config) return
    setConfig({
      ...config,
      analysis: { ...config.analysis, [key]: value }
    })
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
  }

  function updateCleanup(key: keyof Config['cleanup'], value: number): void {
    if (!config) return
    setConfig({
      ...config,
      cleanup: { ...config.cleanup, [key]: value }
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
          {messageType === 'error' ? '❌ ' : '✓ '}
          {message}
        </div>
      )}

      <div className="card">
        <div className="card-title">通用配置</div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px'
          }}
        >
          <div>
            <div>开机自启动</div>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              登录系统后自动启动应用，仅 Windows / macOS 生效
            </span>
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
      </div>

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
            <label style={{ display: 'block', marginBottom: '4px' }}>自定义请求头</label>
            <textarea
              value={config.analysis.customHeaders ?? ''}
              placeholder={'X-Custom-Header: value\nX-Api-Version: 2024-01-01'}
              onChange={(e) => updateAnalysis('customHeaders', e.target.value)}
              rows={3}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                resize: 'vertical'
              }}
            />
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
                display: 'block'
              }}
            >
              部分中转/企业 API 需要额外的报文头。每行一条，格式为 Key: Value，以 # 开头的行忽略
            </span>
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
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
                display: 'block'
              }}
            >
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
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
                display: 'block'
              }}
            >
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
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
                display: 'block'
              }}
            >
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
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
                display: 'block'
              }}
            >
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
              onChange={(e) =>
                updateMonitoring('screenshotIntervalMs', parseInt(e.target.value) * 60000)
              }
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
              onChange={(e) =>
                updateMonitoring('windowChangeDebounceSec', parseInt(e.target.value))
              }
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
                  const dir = await window.api.getScreenshotsDir()
                  window.api.openPath(dir as string)
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
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)'
              }}
            >
              SQLite（内置 rusqlite，WAL 模式）
            </div>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
                display: 'block'
              }}
            >
              当前实际使用: {activeBackend || 'rusqlite'}
            </span>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
                display: 'block'
              }}
            >
              Tauri 版本内置 SQLite 驱动，无需再选择纯 JS 后端；数据文件位于应用数据目录的
              monitor.db
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
