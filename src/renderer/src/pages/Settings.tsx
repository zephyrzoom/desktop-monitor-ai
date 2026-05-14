import React, { useState, useEffect } from 'react'

interface Config {
  monitoring: {
    enabled: boolean
    screenshotIntervalMs: number
    windowPollIntervalMs: number
    screenshotsDir: string
  }
  analysis: {
    apiKey: string
    baseUrl: string
    model: string
    scheduleTime: string
    maxScreenshotsPerBatch: number
  }
  cleanup: {
    retentionDays: number
  }
}

export function Settings(): React.JSX.Element {
  const [config, setConfig] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig(): Promise<void> {
    try {
      const result = await window.electronAPI.getConfig()
      setConfig(result as Config)
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
      setMessage('配置已保存')
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      console.error('Failed to save config:', err)
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
            backgroundColor: message.includes('失败') ? 'var(--error)' : 'var(--success)',
            borderRadius: '8px',
            marginBottom: '24px'
          }}
        >
          {message}
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
              max={10}
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
        </div>
      </div>

      <div className="card">
        <div className="card-title">监控配置</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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

      <button className="button button-primary" onClick={handleSave} disabled={saving}>
        {saving ? '保存中...' : '保存配置'}
      </button>
    </div>
  )
}
