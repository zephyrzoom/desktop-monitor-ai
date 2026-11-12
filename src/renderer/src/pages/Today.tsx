import React, { useState, useEffect } from 'react'
import { MonitorStatus } from '../components/MonitorStatus'
import { WorkItemList } from '../components/WorkItemList'
import { PageHeader } from '../components/PageHeader'
import { ProgressPanel } from '../components/ProgressPanel'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { useAnalysis } from '../contexts/AnalysisContext'
import { formatDateLabel, localDateString } from '../lib/date'
import type { DailyAnalysisResult } from '../../../shared/types/database'

interface AppUsage {
  app_name: string
  total_duration_ms: number
  count: number
}

interface TodayStats {
  screenshots: number
  activeWindows: number
  appUsage: AppUsage[]
  analysis: { date: string; result_json: string } | null
}

function getTodayStr(): string {
  return localDateString()
}

/** 毫秒转「1 小时 20 分 / 25 分」，便于阅读使用时长 */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
}

export function Today(): React.JSX.Element {
  const [stats, setStats] = useState<TodayStats | null>(null)
  const [monitorStatus, setMonitorStatus] = useState<{
    monitors: { name: string; status: string }[]
    isPaused: boolean
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [appUsageExpanded, setAppUsageExpanded] = useState(false)
  const [today, setToday] = useState(getTodayStr)
  const { analyzing, analyzingDate, analysisProgress, busy, triggerAnalysis, onAnalysisComplete } =
    useAnalysis()

  useEffect(() => {
    loadData(today)
  }, [today])

  useEffect(() => {
    return window.api.onMonitorStatusChanged((status) => {
      setMonitorStatus(status)
    })
  }, [])

  useEffect(() => {
    return onAnalysisComplete(() => {
      loadData(today)
    })
  }, [onAnalysisComplete, today])

  useEffect(() => {
    const interval = setInterval(() => {
      const current = getTodayStr()
      setToday((prev) => (prev !== current ? current : prev))
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  async function loadData(date: string): Promise<void> {
    try {
      const [status, todayStats] = await Promise.all([
        window.api.getMonitorStatus(),
        window.api.getTodayStats(date)
      ])
      setMonitorStatus(
        status as { monitors: { name: string; status: string }[]; isPaused: boolean }
      )
      setStats(todayStats as TodayStats)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleStart(): Promise<void> {
    const status = await window.api.startMonitor()
    setMonitorStatus(status)
  }

  async function handleStop(): Promise<void> {
    const status = await window.api.stopMonitor()
    setMonitorStatus(status)
  }

  function handleAnalyze(): void {
    triggerAnalysis(today)
  }

  if (loading) {
    return (
      <div className="page-loading">
        <span className="spinner" />
        加载中…
      </div>
    )
  }

  let analysisResult: DailyAnalysisResult | null = null
  if (stats?.analysis) {
    try {
      const parsed = JSON.parse(stats.analysis.result_json)
      if (parsed && Array.isArray(parsed.work_items)) {
        analysisResult = parsed as DailyAnalysisResult
      }
    } catch {
      analysisResult = null
    }
  }
  const summaryItems: string[] = Array.isArray(analysisResult?.summary)
    ? analysisResult.summary
    : typeof analysisResult?.summary === 'string'
      ? [analysisResult.summary]
      : []

  const appUsage = stats?.appUsage ?? []
  const maxDuration = appUsage.reduce((max, app) => Math.max(max, app.total_duration_ms), 0)
  const visibleApps = appUsageExpanded ? appUsage : appUsage.slice(0, 5)

  return (
    <div>
      <PageHeader
        title="今日概览"
        description={formatDateLabel(today)}
        actions={
          <button
            type="button"
            className="button button-primary"
            onClick={handleAnalyze}
            disabled={busy}
          >
            <Icon name="sparkles" size={15} />
            {busy ? (analyzing && analyzingDate === today ? '分析中…' : '分析进行中…') : '立即分析'}
          </button>
        }
      />

      <MonitorStatus status={monitorStatus} onStart={handleStart} onStop={handleStop} />

      <div className="stats-grid">
        <article className="stat-card">
          <span className="stat-icon tone-blue">
            <Icon name="image" size={17} />
          </span>
          <div className="stat-body">
            <p className="stat-label">截图数量</p>
            <p className="stat-value">
              {stats?.screenshots || 0}
              <span className="stat-unit">张</span>
            </p>
          </div>
        </article>

        <article className="stat-card">
          <span className="stat-icon tone-violet">
            <Icon name="window" size={17} />
          </span>
          <div className="stat-body">
            <p className="stat-label">窗口记录</p>
            <p className="stat-value">
              {stats?.activeWindows || 0}
              <span className="stat-unit">条</span>
            </p>
          </div>
        </article>

        <article className="stat-card">
          <span className="stat-icon tone-teal">
            <Icon name="monitor" size={17} />
          </span>
          <div className="stat-body">
            <p className="stat-label">使用应用</p>
            <p className="stat-value">
              {appUsage.length}
              <span className="stat-unit">个</span>
            </p>
          </div>
        </article>
      </div>

      {appUsage.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Icon name="monitor" size={15} />
              应用使用时长
            </h3>
            <span className="card-hint">按累计时长排序</span>
          </div>

          <div className="usage-list">
            {visibleApps.map((app) => (
              <div className="usage-row" key={app.app_name}>
                <span className="usage-name" title={app.app_name}>
                  {app.app_name}
                </span>
                <span className="usage-track">
                  <span
                    className="usage-fill"
                    style={{
                      width: `${maxDuration > 0 ? Math.max(3, (app.total_duration_ms / maxDuration) * 100) : 0}%`
                    }}
                  />
                </span>
                <span className="usage-value">{formatDuration(app.total_duration_ms)}</span>
              </div>
            ))}
          </div>

          {appUsage.length > 5 && (
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={() => setAppUsageExpanded(!appUsageExpanded)}
            >
              {appUsageExpanded ? '收起' : `展开其余 ${appUsage.length - 5} 个应用`}
              <Icon
                name="chevron-down"
                size={14}
                className={appUsageExpanded ? 'icon-flip' : undefined}
              />
            </button>
          )}
        </section>
      )}

      {analyzing && analyzingDate === today && (
        <ProgressPanel label="正在分析今日工作" progress={analysisProgress} />
      )}

      {analysisResult ? (
        <>
          <section className="card summary-card">
            <div className="card-header">
              <h3 className="card-title">
                <Icon name="sparkles" size={15} />
                今日总结
              </h3>
            </div>
            <ol className="summary-list">
              {summaryItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          </section>

          <div className="section-header">
            <h3 className="section-title">工作内容</h3>
            <span className="card-hint">共 {analysisResult.work_items.length} 段</span>
          </div>
          <WorkItemList workItems={analysisResult.work_items} />
        </>
      ) : (
        !(analyzing && analyzingDate === today) && (
          <EmptyState
            icon="sparkles"
            title="今天还没有分析结果"
            description="点击右上角「立即分析」，AI 会把今天的截图和窗口记录整理成工作小结"
          />
        )
      )}
    </div>
  )
}
