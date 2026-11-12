import React, { useState, useEffect } from 'react'
import { PeriodSelector } from '../components/PeriodSelector'
import { PillGroup } from '../components/PillGroup'
import { CopyButton, CopyIconButton } from '../components/CopyButton'
import { PageHeader } from '../components/PageHeader'
import { ProgressPanel } from '../components/ProgressPanel'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { useAnalysis } from '../contexts/AnalysisContext'
import { currentYearLabel } from '../lib/date'
import {
  buildYearlyCategoryText,
  buildYearlyConclusionText,
  buildYearlyFullText,
  buildYearlyOpeningText
} from '../lib/summary-text'
import type { YearlySummaryResult, PeriodicSummary } from '../../../shared/types/database'

const categoryNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function YearlySummary(): React.JSX.Element {
  const [selectedYear, setSelectedYear] = useState(currentYearLabel)
  const [summary, setSummary] = useState<PeriodicSummary | null>(null)
  const [allSummaries, setAllSummaries] = useState<PeriodicSummary[]>([])
  const [loading, setLoading] = useState(false)
  const {
    generating,
    generatingLabel,
    busy,
    cancelling,
    triggerPeriodicSummary,
    cancelAnalysis,
    onAnalysisComplete
  } = useAnalysis()

  useEffect(() => {
    loadAllSummaries()
  }, [])

  useEffect(() => {
    if (selectedYear) {
      loadSummary(selectedYear)
    }
  }, [selectedYear])

  useEffect(() => {
    return onAnalysisComplete(() => {
      if (selectedYear) {
        loadSummary(selectedYear)
      }
      loadAllSummaries()
    })
  }, [onAnalysisComplete, selectedYear])

  async function loadAllSummaries(): Promise<void> {
    try {
      const result = await window.api.getPeriodicSummary('year', 'all')
      setAllSummaries(result as PeriodicSummary[])
    } catch (err) {
      console.error('Failed to load summaries:', err)
    }
  }

  async function loadSummary(periodLabel: string): Promise<void> {
    setLoading(true)
    try {
      const result = await window.api.getPeriodicSummary('year', periodLabel)
      setSummary(result as PeriodicSummary | null)
    } catch (err) {
      console.error('Failed to load summary:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleGenerate(): void {
    if (!selectedYear) return
    triggerPeriodicSummary(selectedYear)
  }

  const summaryResult: YearlySummaryResult | null = (() => {
    if (!summary) return null
    try {
      const parsed = JSON.parse(summary.result_json)
      if (parsed && Array.isArray(parsed.categories) && parsed.opening && parsed.summary) {
        return parsed as YearlySummaryResult
      }
    } catch {
      return null
    }
    return null
  })()

  const copyContent = summaryResult
    ? buildYearlyFullText(selectedYear || summaryResult.period || '', summaryResult)
    : ''

  return (
    <div>
      <PageHeader
        title="年度汇总"
        description="按年度串起全年工作，可直接复制为年终总结初稿"
        actions={
          <>
            {summaryResult && <CopyButton text={loading ? '' : copyContent} label="复制全文" />}
            <button
              type="button"
              className="button button-primary"
              onClick={handleGenerate}
              disabled={!selectedYear || busy}
            >
              <Icon name="sparkles" size={15} />
              {generating ? '生成中…' : busy ? '分析进行中…' : '生成汇总'}
            </button>
          </>
        }
      />

      <section className="card toolbar-card">
        <div className="toolbar">
          <PeriodSelector type="year" value={selectedYear} onChange={setSelectedYear} />
          {allSummaries.length > 0 && (
            <>
              <span className="toolbar-divider" aria-hidden="true" />
              <span className="toolbar-label">已生成</span>
              <PillGroup>
                {allSummaries.map((s) => (
                  <button
                    type="button"
                    key={s.period_label}
                    className={`pill${s.period_label === selectedYear ? ' active' : ''}`}
                    onClick={() => setSelectedYear(s.period_label)}
                  >
                    {s.period_label} 年
                  </button>
                ))}
              </PillGroup>
            </>
          )}
        </div>
      </section>

      {generating && generatingLabel === selectedYear && (
        <ProgressPanel
          label={`正在生成 ${generatingLabel ?? selectedYear} 年度汇总`}
          progress={null}
          cancelling={cancelling}
          onCancel={() => void cancelAnalysis()}
        />
      )}

      {loading ? (
        <div className="page-loading">
          <span className="spinner" />
          加载中…
        </div>
      ) : summaryResult ? (
        <>
          <section className="card summary-card has-copy">
            <div className="card-header">
              <h3 className="card-title">
                <Icon name="file-text" size={15} />
                年度开篇
              </h3>
              <CopyIconButton text={buildYearlyOpeningText(summaryResult)} title="复制开头语" />
            </div>
            <p className="summary-text">{summaryResult.opening}</p>
          </section>

          {summaryResult.categories.length > 0 && (
            <div className="section-header">
              <h3 className="section-title">分板块总结</h3>
              <span className="card-hint">共 {summaryResult.categories.length} 个板块</span>
            </div>
          )}

          {summaryResult.categories.map((category, catIndex) => (
            <section className="card category-card" key={catIndex}>
              <div className="card-header">
                <h3 className="card-title">
                  <span className="index-badge">{categoryNumbers[catIndex] || catIndex + 1}</span>
                  {category.title}
                </h3>
                <CopyIconButton
                  text={buildYearlyCategoryText(category, catIndex)}
                  title={`复制「${category.title || catIndex + 1}」`}
                />
              </div>
              {(category.items || []).map((item, itemIndex) => (
                <div className="category-item" key={itemIndex}>
                  <p className="category-item-title">
                    <span className="category-item-index">{itemIndex + 1}</span>
                    {item.subtitle}
                  </p>
                  <p className="category-item-text">{item.description}</p>
                </div>
              ))}
            </section>
          ))}

          <section className="card summary-card has-copy">
            <div className="card-header">
              <h3 className="card-title">
                <Icon name="sparkles" size={15} />
                年度总结
              </h3>
              <CopyIconButton text={buildYearlyConclusionText(summaryResult)} title="复制总结" />
            </div>
            <p className="summary-text">{summaryResult.summary}</p>
          </section>
        </>
      ) : selectedYear ? (
        <EmptyState
          icon="layers"
          title={`${selectedYear} 年还没有汇总`}
          description="生成后会得到年度开篇、分板块总结和结语，适合直接改写成年终汇报"
          action={
            <button
              type="button"
              className="button button-primary"
              onClick={handleGenerate}
              disabled={busy}
            >
              <Icon name="sparkles" size={15} />
              {generating ? '生成中…' : busy ? '分析进行中…' : '生成年度汇总'}
            </button>
          }
        />
      ) : (
        <EmptyState
          icon="inbox"
          title="请选择一个年份"
          description="选择后即可查看或生成该年度的汇总"
        />
      )}
    </div>
  )
}
