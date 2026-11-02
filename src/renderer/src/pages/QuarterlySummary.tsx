import React, { useState, useEffect } from 'react'
import { PeriodSelector } from '../components/PeriodSelector'
import { CopyButton, CopyIconButton } from '../components/CopyButton'
import { PageHeader } from '../components/PageHeader'
import { ProgressPanel } from '../components/ProgressPanel'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { useAnalysis } from '../contexts/AnalysisContext'
import { currentQuarterLabel } from '../lib/date'
import {
  buildQuarterlyCategoryText,
  buildQuarterlyFullText,
  buildQuarterlyHighlightsText,
  buildQuarterlyImprovementsText,
  buildQuarterlyOverviewText,
  buildQuarterlyProblemsText
} from '../lib/summary-text'
import type { PeriodicSummaryResult, PeriodicSummary } from '../../../shared/types/database'

export function QuarterlySummary(): React.JSX.Element {
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarterLabel)
  const [summary, setSummary] = useState<PeriodicSummary | null>(null)
  const [allSummaries, setAllSummaries] = useState<PeriodicSummary[]>([])
  const [loading, setLoading] = useState(false)
  const { generating, generatingLabel, triggerPeriodicSummary, onAnalysisComplete } = useAnalysis()

  useEffect(() => {
    loadAllSummaries()
  }, [])

  useEffect(() => {
    if (selectedQuarter) {
      loadSummary(selectedQuarter)
    }
  }, [selectedQuarter])

  useEffect(() => {
    return onAnalysisComplete(() => {
      if (selectedQuarter) {
        loadSummary(selectedQuarter)
      }
      loadAllSummaries()
    })
  }, [onAnalysisComplete, selectedQuarter])

  async function loadAllSummaries(): Promise<void> {
    try {
      const result = await window.api.getPeriodicSummary('quarter', 'all')
      setAllSummaries(result as PeriodicSummary[])
    } catch (err) {
      console.error('Failed to load summaries:', err)
    }
  }

  async function loadSummary(periodLabel: string): Promise<void> {
    setLoading(true)
    try {
      const result = await window.api.getPeriodicSummary('quarter', periodLabel)
      setSummary(result as PeriodicSummary | null)
    } catch (err) {
      console.error('Failed to load summary:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleGenerate(): void {
    if (!selectedQuarter) return
    triggerPeriodicSummary(selectedQuarter)
  }

  const summaryResult: PeriodicSummaryResult | null = (() => {
    if (!summary) return null
    try {
      const parsed = JSON.parse(summary.result_json)
      if (parsed && Array.isArray(parsed.highlights) && parsed.summary) {
        // 兼容旧数据：早期生成的汇总没有 problems / improvements 字段
        return {
          ...parsed,
          problems: Array.isArray(parsed.problems) ? parsed.problems : [],
          improvements: Array.isArray(parsed.improvements) ? parsed.improvements : []
        } as PeriodicSummaryResult
      }
    } catch {
      return null
    }
    return null
  })()

  const copyContent = summaryResult
    ? buildQuarterlyFullText(selectedQuarter || summaryResult.period || '', summaryResult)
    : ''

  return (
    <div>
      <PageHeader
        title="季度汇总"
        description="按季度聚合工作内容，生成可复制的汇报素材"
        actions={
          <>
            {summaryResult && <CopyButton text={loading ? '' : copyContent} label="复制全文" />}
            <button
              type="button"
              className="button button-primary"
              onClick={handleGenerate}
              disabled={!selectedQuarter || generating}
            >
              <Icon name="sparkles" size={15} />
              {generating ? '生成中…' : '生成汇总'}
            </button>
          </>
        }
      />

      <section className="card toolbar-card">
        <div className="toolbar">
          <PeriodSelector type="quarter" value={selectedQuarter} onChange={setSelectedQuarter} />
          {allSummaries.length > 0 && (
            <>
              <span className="toolbar-divider" aria-hidden="true" />
              <span className="toolbar-label">已生成</span>
              <div className="pill-group">
                {allSummaries.map((s) => (
                  <button
                    type="button"
                    key={s.period_label}
                    className={`pill${s.period_label === selectedQuarter ? ' active' : ''}`}
                    onClick={() => setSelectedQuarter(s.period_label)}
                  >
                    {s.period_label.replace('-', ' ')}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {generating && generatingLabel === selectedQuarter && (
        <ProgressPanel
          label={`正在生成 ${generatingLabel ?? selectedQuarter} 季度汇总`}
          progress={null}
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
                季度概述
              </h3>
              <CopyIconButton
                text={buildQuarterlyOverviewText(summaryResult)}
                title="复制季度概述"
              />
            </div>
            <p className="summary-text">{summaryResult.summary}</p>
          </section>

          {summaryResult.highlights.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <Icon name="trending-up" size={15} />
                  工作亮点
                </h3>
                <CopyIconButton
                  text={buildQuarterlyHighlightsText(summaryResult)}
                  title="复制工作亮点"
                />
              </div>
              <ul className="bullet-list">
                {summaryResult.highlights.map((highlight, index) => (
                  <li key={index}>{highlight}</li>
                ))}
              </ul>
            </section>
          )}

          {summaryResult.work_categories.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <Icon name="pie" size={15} />
                  工作分类占比
                </h3>
                <CopyIconButton
                  text={buildQuarterlyCategoryText(summaryResult)}
                  title="复制工作分类统计"
                />
              </div>
              <div className="category-list">
                {summaryResult.work_categories.map((cat, index) => (
                  <div className="category-row" key={`${cat.category}-${index}`}>
                    <span className="category-name">{cat.category}</span>
                    <span className="usage-track">
                      <span
                        className="usage-fill"
                        style={{ width: `${Math.min(100, Math.max(2, cat.percentage))}%` }}
                      />
                    </span>
                    <span className="category-value">{cat.percentage}%</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(summaryResult.problems?.length ?? 0) > 0 && (
            <section className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <Icon name="alert" size={15} />
                  工作中存在的主要问题和不足
                </h3>
                <CopyIconButton
                  text={buildQuarterlyProblemsText(summaryResult)}
                  title="复制主要问题和不足"
                />
              </div>
              <ul className="bullet-list">
                {summaryResult.problems?.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            </section>
          )}

          {(summaryResult.improvements?.length ?? 0) > 0 && (
            <section className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <Icon name="target" size={15} />
                  下一步的改进计划
                </h3>
                <CopyIconButton
                  text={buildQuarterlyImprovementsText(summaryResult)}
                  title="复制改进计划"
                />
              </div>
              <ul className="bullet-list">
                {summaryResult.improvements?.map((improvement, index) => (
                  <li key={index}>{improvement}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : selectedQuarter ? (
        <EmptyState
          icon="chart"
          title={`${selectedQuarter.replace('-', ' ')} 还没有汇总`}
          description="生成后会得到季度概述、工作亮点、分类占比、主要问题与改进计划，并可一键复制"
          action={
            <button
              type="button"
              className="button button-primary"
              onClick={handleGenerate}
              disabled={generating}
            >
              <Icon name="sparkles" size={15} />
              {generating ? '生成中…' : '生成季度汇总'}
            </button>
          }
        />
      ) : (
        <EmptyState
          icon="inbox"
          title="请选择一个季度"
          description="选择后即可查看或生成该季度的汇总"
        />
      )}
    </div>
  )
}
