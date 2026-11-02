import React, { useState, useEffect, useMemo, useRef } from 'react'
import { DatePicker } from '../components/DatePicker'
import { WorkItemList } from '../components/WorkItemList'
import { PageHeader } from '../components/PageHeader'
import { ProgressPanel } from '../components/ProgressPanel'
import { EmptyState } from '../components/EmptyState'
import { Alert } from '../components/Alert'
import { Icon } from '../components/Icon'
import { useAnalysis } from '../contexts/AnalysisContext'
import { formatDateLabel, localDateString } from '../lib/date'
import type { DailyAnalysisResult, DailyAnalysis } from '../../../shared/types/database'

/** 批量补算的范围选项：days 为 null 表示全部历史 */
const RERUN_RANGES: { label: string; days: number | null; hint: string }[] = [
  { label: '最近 7 天', days: 7, hint: '只处理最近一周' },
  { label: '最近 30 天', days: 30, hint: '只处理最近一个月' },
  { label: '全部历史', days: null, hint: '所有有截图的日期' }
]

export function DailyReport(): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState(localDateString)
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null)
  const [allAnalyses, setAllAnalyses] = useState<DailyAnalysis[]>([])
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [runningRange, setRunningRange] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<{
    label: string
    total: number
    succeeded: number
    filled: number
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const {
    analyzing,
    analysisProgress,
    rerunning,
    triggerAnalysis,
    triggerRerun,
    onAnalysisComplete
  } = useAnalysis()

  useEffect(() => {
    loadAllAnalyses()
  }, [])

  useEffect(() => {
    return onAnalysisComplete(() => {
      loadAllAnalyses()
      loadAnalysis(selectedDate)
    })
  }, [onAnalysisComplete, selectedDate])

  useEffect(() => {
    loadAnalysis(selectedDate)
  }, [selectedDate])

  // 范围菜单：点外面或按 Esc 关闭
  useEffect(() => {
    if (!menuOpen) return

    function handlePointerDown(event: MouseEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  async function loadAllAnalyses(): Promise<void> {
    try {
      const result = await window.api.getDailyAnalysis('all')
      setAllAnalyses(result as DailyAnalysis[])
    } catch (err) {
      console.error('Failed to load analyses:', err)
    }
  }

  async function loadAnalysis(date: string): Promise<void> {
    setLoading(true)
    try {
      const result = await window.api.getDailyAnalysis(date)
      setAnalysis(result as DailyAnalysis | null)
    } catch (err) {
      console.error('Failed to load analysis:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleAnalyze(): void {
    triggerAnalysis(selectedDate)
  }

  async function runBatch(
    label: string,
    task: () => Promise<{ total: number; succeeded: number; filled: number } | null>
  ): Promise<void> {
    setBatchResult(null)
    const result = await task()
    if (result) {
      setBatchResult({
        label,
        total: result.total,
        succeeded: result.succeeded,
        filled: result.filled
      })
    }
    loadAllAnalyses()
    loadAnalysis(selectedDate)
  }

  async function handleRerun(days: number | null, label: string): Promise<void> {
    setMenuOpen(false)
    setRunningRange(label)
    try {
      await runBatch(`批量补算（${label}）`, () => triggerRerun(days))
    } finally {
      setRunningRange(null)
    }
  }

  let analysisResult: DailyAnalysisResult | null = null
  if (analysis) {
    try {
      const parsed = JSON.parse(analysis.result_json)
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

  const batchBusy = rerunning
  const analyzedDates = useMemo(() => new Set(allAnalyses.map((item) => item.date)), [allAnalyses])

  return (
    <div>
      <PageHeader
        title="日报"
        description="查看任意日期的工作总结，缺失的日期可以批量补算"
        actions={
          <div className="menu-anchor" ref={menuRef}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setMenuOpen((open) => !open)}
              disabled={batchBusy || analyzing}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="批量处理历史日报：缺失的补上，已有的覆盖重写（不含今天）"
            >
              <Icon name="history" size={15} />
              {rerunning ? '批量补算中…' : '批量补算'}
              <Icon name="chevron-down" size={14} className={menuOpen ? 'icon-flip' : undefined} />
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <p className="menu-title">处理范围（不含今天）</p>
                {RERUN_RANGES.map((range) => (
                  <button
                    type="button"
                    key={range.label}
                    role="menuitem"
                    className="menu-item"
                    onClick={() => void handleRerun(range.days, range.label)}
                  >
                    <span className="menu-item-label">{range.label}</span>
                    <span className="menu-item-hint">{range.hint}</span>
                  </button>
                ))}
                <p className="menu-note">缺失的补上，已有的覆盖重写</p>
              </div>
            )}
          </div>
        }
      />

      <section className="card toolbar-card">
        <div className="toolbar">
          <DatePicker value={selectedDate} onChange={setSelectedDate} markedDates={analyzedDates} />
          {allAnalyses.length > 0 && (
            <>
              <span className="toolbar-divider" aria-hidden="true" />
              <span className="toolbar-label">已分析</span>
              <div className="pill-group">
                {allAnalyses.slice(0, 8).map((a) => (
                  <button
                    type="button"
                    key={a.date}
                    className={`pill${a.date === selectedDate ? ' active' : ''}`}
                    onClick={() => setSelectedDate(a.date)}
                    title={formatDateLabel(a.date)}
                  >
                    {a.date.slice(5)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {batchResult && !batchBusy && (
        <Alert
          tone={
            batchResult.total === 0
              ? 'info'
              : batchResult.succeeded === batchResult.total
                ? 'success'
                : 'warning'
          }
        >
          {batchResult.total === 0
            ? `${batchResult.label}：今天之前没有需要处理的日期`
            : `${batchResult.label}完成：共 ${batchResult.total} 天（补算 ${batchResult.filled} 天，重写 ${
                batchResult.total - batchResult.filled
              } 天），成功 ${batchResult.succeeded} 天${
                batchResult.succeeded < batchResult.total
                  ? `，失败 ${batchResult.total - batchResult.succeeded} 天`
                  : ''
              }`}
        </Alert>
      )}

      {batchBusy && (
        <ProgressPanel
          label={runningRange ? `正在批量补算（${runningRange}）` : '正在批量补算'}
          progress={analysisProgress}
        />
      )}

      {loading ? (
        <div className="page-loading">
          <span className="spinner" />
          加载中…
        </div>
      ) : analysisResult ? (
        <>
          <section className="card summary-card">
            <div className="card-header">
              <h3 className="card-title">
                <Icon name="file-text" size={15} />
                {formatDateLabel(selectedDate)} 的工作总结
              </h3>
              <button
                type="button"
                className="button button-ghost button-sm"
                onClick={handleAnalyze}
                disabled={analyzing}
                title="用当前数据重新分析这一天"
              >
                <Icon name="refresh" size={14} />
                重新分析
              </button>
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
        <EmptyState
          icon="calendar"
          title={`${formatDateLabel(selectedDate)} 暂无分析`}
          description="这一天还没有生成日报，可以直接分析现有记录，或用右上角「批量补算」补齐"
          action={
            <button
              type="button"
              className="button button-primary"
              onClick={handleAnalyze}
              disabled={analyzing}
            >
              <Icon name="sparkles" size={15} />
              {analyzing ? '分析中…' : '分析这一天'}
            </button>
          }
        />
      )}

      {analyzing && <ProgressPanel label="正在分析该日期" progress={analysisProgress} />}
    </div>
  )
}
