import React, { useState, useEffect } from 'react'
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

export function DailyReport(): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState(localDateString)
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null)
  const [allAnalyses, setAllAnalyses] = useState<DailyAnalysis[]>([])
  const [loading, setLoading] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    label: string
    total: number
    succeeded: number
  } | null>(null)
  const {
    analyzing,
    analysisProgress,
    backfilling,
    reanalyzing,
    triggerAnalysis,
    triggerBackfillAnalysis,
    triggerReanalyzeRecent,
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
    task: () => Promise<{ total: number; succeeded: number } | null>
  ): Promise<void> {
    setBatchResult(null)
    const result = await task()
    if (result) {
      setBatchResult({ label, total: result.total, succeeded: result.succeeded })
    }
    loadAllAnalyses()
    loadAnalysis(selectedDate)
  }

  function handleBackfill(): void {
    void runBatch('补偿分析', triggerBackfillAnalysis)
  }

  function handleReanalyze(): void {
    void runBatch('重算最近 7 天', () => triggerReanalyzeRecent(7))
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

  const batchBusy = backfilling || reanalyzing

  return (
    <div>
      <PageHeader
        title="日报"
        description="查看任意日期的工作总结，缺失的日期可以补算"
        actions={
          <>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleBackfill}
              disabled={batchBusy || analyzing}
              title="为有记录但没有分析结果的日期补做分析"
            >
              <Icon name="history" size={15} />
              {backfilling ? '补偿中…' : '补偿分析'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleReanalyze}
              disabled={batchBusy || analyzing}
              title="重新分析最近 7 天的数据"
            >
              <Icon name="refresh" size={15} />
              {reanalyzing ? '重算中…' : '重算 7 天'}
            </button>
          </>
        }
      />

      <section className="card toolbar-card">
        <div className="toolbar">
          <DatePicker value={selectedDate} onChange={setSelectedDate} />
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
            ? `${batchResult.label}：没有需要处理的日期`
            : `${batchResult.label}完成：共 ${batchResult.total} 天，成功 ${batchResult.succeeded} 天${
                batchResult.succeeded < batchResult.total
                  ? `，失败 ${batchResult.total - batchResult.succeeded} 天`
                  : ''
              }`}
        </Alert>
      )}

      {batchBusy && (
        <ProgressPanel
          label={reanalyzing ? '正在重算最近 7 天' : '正在补偿分析'}
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
          description="这一天还没有生成日报，可以直接分析现有记录，或用右上角「补偿分析」批量补齐"
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
