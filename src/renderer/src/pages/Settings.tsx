import React, { useState, useEffect, useCallback, useRef } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Alert } from '../components/Alert'
import { Icon } from '../components/Icon'
import type { ModelQuery, ModelValidation, ModelValidationQuery } from '../lib/api'
import { APP_VERSION, getBuildTime, getPlatformName } from '../lib/version'

/** 自动模式下「分析前一天」的小时分界，需与 Rust 的 AUTO_PREVIOUS_DAY_HOUR 保持一致 */
const AUTO_PREVIOUS_DAY_HOUR = 6

/** API Key / Base URL 输入后等多久自动拉取模型，避免每敲一个字符都发请求 */
const MODELS_FETCH_DEBOUNCE_MS = 800

function describeError(err: unknown, fallback = '请求失败'): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return fallback
}

/** 定时任务到点后实际分析的日期：auto 时按 06:00 分界推断，其余按配置值 */
function effectiveScheduleMode(mode: string, scheduleTime: string): 'today' | 'previous' {
  if (mode === 'today' || mode === 'previous') return mode
  const hour = Number.parseInt(scheduleTime.split(':')[0] ?? '', 10)
  return Number.isFinite(hour) && hour < AUTO_PREVIOUS_DAY_HOUR ? 'previous' : 'today'
}

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
    monitoringAllDay: boolean
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
    scheduleDateMode: string
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
  // 模型下拉：接口返回的列表、加载态、错误提示，以及手动输入的开关
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [manualModel, setManualModel] = useState(false)
  const modelsRequestId = useRef(0)
  const lastModelQuery = useRef('')
  // 模型验证：结果、进行中状态、防乱序序号
  const [validation, setValidation] = useState<ModelValidation | null>(null)
  const [validating, setValidating] = useState(false)
  /** 发起验证时的参数签名：表单一改，旧结果立即失效，不必额外起 effect 清状态 */
  const [validationKey, setValidationKey] = useState('')
  const validationRequestId = useRef(0)

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const result = await window.api.getConfig()
        setConfig(result as Config)
        const backend = await window.api.getActiveBackend()
        setActiveBackend(backend as string)
      } catch (err) {
        console.error('Failed to load config:', err)
      }
    }
    void load()
  }, [])

  /** 按当前表单参数拉取 /models；同一组参数不重复请求，force 用于手动刷新 */
  const fetchModels = useCallback(async (query: ModelQuery, force = false): Promise<void> => {
    const signature = `${query.baseUrl}\n${query.apiKey}\n${query.customHeaders}`
    if (!force && lastModelQuery.current === signature) return

    if (!query.apiKey.trim() || !query.baseUrl.trim()) {
      lastModelQuery.current = signature
      setModels([])
      setModelsError('请先填写 API Key 和 Base URL')
      return
    }

    lastModelQuery.current = signature
    const requestId = ++modelsRequestId.current
    setModelsLoading(true)
    setModelsError('')
    try {
      const list = await window.api.listModels(query)
      // 慢请求返回时表单可能已改，丢弃过期结果
      if (requestId !== modelsRequestId.current) return
      setModels(list)
      if (list.length === 0) setModelsError('接口未返回可用的模型列表')
    } catch (err) {
      if (requestId !== modelsRequestId.current) return
      setModels([])
      setModelsError(describeError(err, '获取模型列表失败'))
    } finally {
      if (requestId === modelsRequestId.current) setModelsLoading(false)
    }
  }, [])

  const modelQuery: ModelQuery = {
    apiKey: config?.analysis.apiKey ?? '',
    baseUrl: config?.analysis.baseUrl ?? '',
    customHeaders: config?.analysis.customHeaders ?? ''
  }
  const { apiKey, baseUrl, customHeaders } = modelQuery
  const hasConfig = config !== null
  const currentModel = config?.analysis.model ?? ''

  /** 真实调用一次对话接口，验证当前表单所选的模型 */
  const runValidation = useCallback(async (query: ModelValidationQuery): Promise<void> => {
    const key = `${query.baseUrl}\n${query.apiKey}\n${query.customHeaders}\n${query.model}`
    const requestId = ++validationRequestId.current
    setValidationKey(key)
    setValidating(true)
    setValidation(null)
    try {
      const result = await window.api.validateModel(query)
      if (requestId === validationRequestId.current) setValidation(result)
    } catch (err) {
      if (requestId === validationRequestId.current) {
        setValidation({
          ok: false,
          message: describeError(err, '验证模型失败'),
          latencyMs: 0,
          model: null,
          httpStatus: null
        })
      }
    } finally {
      if (requestId === validationRequestId.current) setValidating(false)
    }
  }, [])

  // 填完 API Key / Base URL 后自动拉取一次；输入过程中用防抖收敛请求
  useEffect(() => {
    if (!hasConfig || !apiKey.trim() || !baseUrl.trim()) return
    const timer = window.setTimeout(() => {
      void fetchModels({ apiKey, baseUrl, customHeaders })
    }, MODELS_FETCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [hasConfig, apiKey, baseUrl, customHeaders, fetchModels])

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

  function updateAnalysis(key: keyof Config['analysis'], value: string | number | boolean): void {
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

  const useModelSelect = models.length > 0 && !manualModel
  const canValidate = Boolean(apiKey.trim() && baseUrl.trim() && currentModel.trim())
  const currentValidationKey = `${baseUrl}\n${apiKey}\n${customHeaders}\n${currentModel}`
  const validationIsCurrent = validationKey === currentValidationKey
  const isWaitingValidation = validating && validationIsCurrent
  const showValidation = validation !== null && validationIsCurrent
  const validationMeta: string[] = []
  if (showValidation && validation) {
    if (validation.latencyMs > 0) validationMeta.push(`${validation.latencyMs} ms`)
    if (validation.model) validationMeta.push(`实际模型 ${validation.model}`)
    if (validation.httpStatus != null) validationMeta.push(`HTTP ${validation.httpStatus}`)
  }
  const modelHint = modelsLoading
    ? '正在获取可用模型…'
    : modelsError
      ? `${modelsError}，也可手动填写模型名`
      : models.length > 0
        ? `已获取 ${models.length} 个可用模型`
        : '填写 API Key 与 Base URL 后自动获取可用模型，也可手动填写'

  const scheduleDateMode = config.analysis.scheduleDateMode ?? 'auto'
  const monitoringAllDay = config.monitoring.monitoringAllDay ?? true
  const scheduleTargetsPrevious =
    effectiveScheduleMode(scheduleDateMode, config.analysis.scheduleTime) === 'previous'
  const scheduleDateHint =
    scheduleDateMode === 'auto'
      ? `按时间自动判断，当前每天 ${config.analysis.scheduleTime || '--:--'} 分析${
          scheduleTargetsPrevious ? '前一天' : '当天'
        }的日报`
      : scheduleTargetsPrevious
        ? '到点分析前一天的完整数据，适合凌晨触发，如 01:30'
        : '到点分析当天的数据，适合晚间触发，如 23:00'

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
            <div className="inline-fields">
              {useModelSelect ? (
                <select
                  id="model"
                  className="input"
                  value={currentModel}
                  onChange={(e) => updateAnalysis('model', e.target.value)}
                >
                  {!currentModel && <option value="">请选择模型</option>}
                  {currentModel && !models.includes(currentModel) && (
                    <option value={currentModel}>{currentModel}（当前值，接口未返回）</option>
                  )}
                  {models.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="model"
                  className="input"
                  type="text"
                  placeholder="gpt-4o-mini"
                  value={currentModel}
                  onChange={(e) => updateAnalysis('model', e.target.value)}
                />
              )}
              <button
                type="button"
                className="button button-secondary model-refresh"
                disabled={modelsLoading}
                title="重新获取可用模型"
                onClick={() => void fetchModels(modelQuery, true)}
              >
                {modelsLoading ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
                {models.length > 0 ? '刷新' : '获取模型'}
              </button>
            </div>
            <div className="field-hint-row">
              <span
                className={`field-hint${modelsError && !modelsLoading ? ' field-hint-error' : ''}`}
              >
                {modelHint}
              </span>
              {models.length > 0 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setManualModel(!manualModel)}
                >
                  {manualModel ? '从列表选择' : '手动输入'}
                </button>
              )}
            </div>
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

          <div className="field field-full model-validation">
            <div className="model-validation-head">
              <div className="model-validation-copy">
                <span className="field-label">模型可用性验证</span>
                <span className="field-hint">
                  用当前表单配置向所选模型发一条最小对话请求，确认 API Key、Base URL
                  与模型名都能正常工作；可能产生微量费用，无需先保存
                </span>
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={!canValidate || isWaitingValidation}
                title={
                  canValidate ? '真实调用一次对话接口' : '请先填写 API Key、Base URL 并选择模型'
                }
                onClick={() =>
                  void runValidation({ apiKey, baseUrl, customHeaders, model: currentModel })
                }
              >
                {isWaitingValidation ? (
                  <span className="spinner" />
                ) : (
                  <Icon name="play" size={14} />
                )}
                {isWaitingValidation ? '测试中…' : '测试模型'}
              </button>
            </div>

            {!canValidate && (
              <span className="field-hint">请先填写 API Key、Base URL 并选择模型</span>
            )}

            {showValidation && validation && (
              <div className={`model-validation-result${validation.ok ? ' is-ok' : ' is-failed'}`}>
                <Icon name={validation.ok ? 'check-circle' : 'alert'} size={15} />
                <div className="model-validation-detail">
                  <span className="model-validation-message">
                    {validation.ok ? '验证通过：' : '验证失败：'}
                    {validation.message}
                  </span>
                  {validationMeta.length > 0 && (
                    <span className="model-validation-meta">{validationMeta.join(' · ')}</span>
                  )}
                </div>
              </div>
            )}
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

        <div className="analysis-params">
          <div className="form-grid">
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
              <span className="field-hint">每天到点自动生成日报</span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="scheduleDateMode">
                分析日期
              </label>
              <select
                id="scheduleDateMode"
                className="input"
                value={scheduleDateMode}
                onChange={(e) => updateAnalysis('scheduleDateMode', e.target.value)}
              >
                <option value="auto">自动（06:00 前分析前一天）</option>
                <option value="today">当天</option>
                <option value="previous">前一天</option>
              </select>
              <span className="field-hint">{scheduleDateHint}</span>
            </div>
          </div>

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
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Icon name="window" size={15} />
            监控
          </h3>
        </div>

        <div className="switch-row">
          <div className="field">
            <span className="field-label">全天监控</span>
            <span className="field-hint">
              全天持续记录，仅在空闲超时或手动暂停时停止；关闭后可指定监控时段
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={monitoringAllDay}
              onChange={(e) => updateMonitoring('monitoringAllDay', e.target.checked)}
            />
            <span className="switch-slider" />
          </label>
        </div>

        <div className="form-grid form-grid-after-switch">
          <div className="field">
            <span className="field-label">监控时间段</span>

            {monitoringAllDay ? (
              // 全天时不再渲染时间输入框：WebView 里 time 控件没有清空按钮，
              // 留着灰框会让人以为「填了就只能守着」，没有回到全天的出口。
              <div className="time-window-static">
                <Icon name="clock" size={14} />
                <span>00:00 — 24:00</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => updateMonitoring('monitoringAllDay', false)}
                >
                  自定义时段
                </button>
              </div>
            ) : (
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
            )}

            <div className="field-hint-row">
              <span className="field-hint">
                {monitoringAllDay
                  ? '全天持续监控，不受时间段限制'
                  : '超出该时段自动暂停，跨零点可配 22:00 至 06:00'}
              </span>
              {!monitoringAllDay && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => updateMonitoring('monitoringAllDay', true)}
                >
                  恢复全天
                </button>
              )}
            </div>
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
