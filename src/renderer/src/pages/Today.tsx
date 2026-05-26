import React, { useState, useEffect } from 'react'
import { MonitorStatus } from '../components/MonitorStatus'
import { WorkItemList } from '../components/WorkItemList'
import type { DailyAnalysisResult, AnalysisProgress } from '../../../shared/types/database'

interface TodayStats {
  screenshots: number
  activeWindows: number
  appUsage: { app_name: string; total_duration_ms: number; count: number }[]
  analysis: { date: string; result_json: string } | null
}

export function Today(): React.JSX.Element {
  const [stats, setStats] = useState<TodayStats | null>(null)
  const [monitorStatus, setMonitorStatus] = useState<{
    monitors: { name: string; status: string }[]
    isPaused: boolean
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAnalysisProgress((progress) => {
      setAnalysisProgress(progress)
    })
    return unsubscribe
  }, [])

  async function loadData(): Promise<void> {
    try {
      const [status, todayStats] = await Promise.all([
        window.electronAPI.getMonitorStatus(),
        window.electronAPI.getTodayStats(today)
      ])
      setMonitorStatus(status as { monitors: { name: string; status: string }[]; isPaused: boolean })
      setStats(todayStats as TodayStats)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleStart(): Promise<void> {
    const status = await window.electronAPI.startMonitor()
    setMonitorStatus(status)
  }

  async function handleStop(): Promise<void> {
    const status = await window.electronAPI.stopMonitor()
    setMonitorStatus(status)
  }

  async function handleAnalyze(): Promise<void> {
    setAnalyzing(true)
    setAnalysisProgress(null)
    try {
      await window.electronAPI.triggerAnalysis(today)
    } finally {
      setAnalyzing(false)
      setAnalysisProgress(null)
      await loadData()
    }
  }

  if (loading) {
    return <div className="loading">加载中...</div>
  }

  const analysisResult: DailyAnalysisResult | null = stats?.analysis
    ? JSON.parse(stats.analysis.result_json)
    : null

  return (
    <div>
      <div className="page-header">
        <h2>今日概览</h2>
      </div>

      <MonitorStatus status={monitorStatus} onStart={handleStart} onStop={handleStop} />

      <div className="stats-grid">
        <div className="card">
          <div className="card-title">截图数量</div>
          <div className="card-value">{stats?.screenshots || 0}</div>
        </div>
        <div className="card">
          <div className="card-title">活动窗口记录</div>
          <div className="card-value">{stats?.activeWindows || 0}</div>
        </div>
        <div className="card">
          <div className="card-title">使用应用数</div>
          <div className="card-value">{stats?.appUsage?.length || 0}</div>
        </div>
      </div>

      {stats?.appUsage && stats.appUsage.length > 0 && (
        <div className="card">
          <div className="card-title">应用使用时长</div>
          {stats.appUsage.slice(0, 5).map((app, index) => (
            <div key={index} style={{ marginBottom: '8px' }}>
              <span>{app.app_name}: </span>
              <span>{Math.round(app.total_duration_ms / 60000)}分钟</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: '24px' }}>
        <button className="button button-primary" onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? '分析中...' : '立即分析今日工作'}
        </button>
      </div>

      {analyzing && (
        <div className="analysis-progress">
          <div className="analysis-progress-header">
            <div className="analysis-spinner"></div>
            <span>正在分析...</span>
          </div>
          {analysisProgress && (
            <div className="analysis-progress-detail">
              <span>{analysisProgress.step}</span>
              {analysisProgress.total > 0 && (
                <div className="analysis-progress-bar-wrapper">
                  <div
                    className="analysis-progress-bar"
                    style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                  />
                </div>
              )}
              {analysisProgress.total > 0 && (
                <span className="analysis-progress-count">
                  {analysisProgress.current} / {analysisProgress.total}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {analysisResult && (
        <>
          <div className="summary-box">
            <ol className="summary-list">
              {analysisResult.summary.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          </div>
          <h3 style={{ marginBottom: '16px' }}>工作内容</h3>
          <WorkItemList workItems={analysisResult.work_items} />
        </>
      )}
    </div>
  )
}
