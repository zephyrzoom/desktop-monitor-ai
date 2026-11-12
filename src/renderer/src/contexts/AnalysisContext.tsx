import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { AnalysisProgress } from '../../../shared/types/database'
import type { AnalysisStatusPayload } from '../lib/api'
import { formatDateLabel } from '../lib/date'

interface AnalysisContextValue {
  // Daily analysis state
  analyzing: boolean
  analysisProgress: AnalysisProgress | null
  analyzingDate: string | null
  // 批量补算/重算 state
  rerunning: boolean
  // Periodic summary state
  generating: boolean
  generatingLabel: string | null
  /** 后端是否正在执行任意分析任务（含定时分析），用于锁住所有触发入口 */
  busy: boolean
  /** 当前任务的中文描述，用于全局「正在分析」提示 */
  busyLabel: string | null
  // Actions
  triggerAnalysis: (date: string) => Promise<void>
  /** days 为 null 表示全部历史；范围内缺失的补上、已有的覆盖，始终不含今天 */
  triggerRerun: (days: number | null) => Promise<{
    status: string
    total: number
    succeeded: number
    filled: number
  } | null>
  triggerPeriodicSummary: (periodLabel: string) => Promise<void>
  // Completion callback registration
  onAnalysisComplete: (callback: () => void) => () => void
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null)

function describeStatus(status: AnalysisStatusPayload | null): string | null {
  if (!status) return null
  switch (status.kind) {
    case 'daily':
    case 'scheduled':
      return `正在分析 ${formatDateLabel(status.target)}`
    case 'rerun':
      return '正在批量补算日报'
    case 'summary':
      return `正在生成 ${status.target} 汇总`
    default:
      return '正在分析'
  }
}

/**
 * 分析状态以后端为准：begin_analysis / end_analysis 分别发出
 * analysis:started / analysis:finished，前端只做镜像。
 *
 * 早期实现用「谁点按钮、谁 await 结束」维护状态，后端一旦返回 busy
 * （重复点击、定时分析占用、无截图快速结束）就会把共享状态清掉，
 * 于是界面看不到「正在分析」，还能继续点其它日期重复触发。
 */
export function AnalysisProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AnalysisStatusPayload | null>(null)
  // 乐观占位：命令发出到 started 事件到达之间也要立刻有反馈
  const [pending, setPending] = useState<AnalysisStatusPayload | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)

  const busyRef = useRef(false)
  const backendStatusRef = useRef<AnalysisStatusPayload | null>(null)
  const eventVersionRef = useRef(0)
  const completeCallbacks = useRef<Set<() => void>>(new Set())

  const notifyComplete = useCallback(() => {
    completeCallbacks.current.forEach((cb) => cb())
  }, [])

  const onAnalysisComplete = useCallback((callback: () => void) => {
    completeCallbacks.current.add(callback)
    return () => {
      completeCallbacks.current.delete(callback)
    }
  }, [])

  const release = useCallback(() => {
    busyRef.current = false
    backendStatusRef.current = null
    setStatus(null)
    setPending(null)
    setAnalysisProgress(null)
  }, [])

  useEffect(() => {
    const unsubProgress = window.api.onAnalysisProgress((progress) => {
      setAnalysisProgress(progress)
    })

    const unsubStarted = window.api.onAnalysisStarted((started) => {
      eventVersionRef.current += 1
      busyRef.current = true
      backendStatusRef.current = started
      setStatus(started)
      setPending(null)
      setAnalysisProgress(null)
    })

    const unsubFinished = window.api.onAnalysisFinished(() => {
      eventVersionRef.current += 1
      release()
      notifyComplete()
    })

    const unsubResult = window.api.onAnalysisComplete(() => {
      notifyComplete()
    })

    // 定时任务自动生成季度/年度汇总后，让汇总页重新拉取结果
    const unsubSummary = window.api.onSummaryGenerated(() => {
      notifyComplete()
    })

    // 窗口重载时可能已有任务在跑，主动同步一次；期间若收到事件则以事件为准
    let disposed = false
    const version = eventVersionRef.current
    void window.api
      .getAnalysisStatus()
      .then((current) => {
        if (disposed || eventVersionRef.current !== version || !current) return
        busyRef.current = true
        backendStatusRef.current = current
        setStatus(current)
      })
      .catch((err) => console.error('Failed to load analysis status:', err))

    return () => {
      disposed = true
      unsubProgress()
      unsubStarted()
      unsubFinished()
      unsubResult()
      unsubSummary()
    }
  }, [notifyComplete, release])

  /** 占用一次触发机会；后端已有任务（或同一帧内重复点击）时直接拒绝 */
  const claim = useCallback((kind: AnalysisStatusPayload['kind'], target: string): boolean => {
    if (busyRef.current) return false
    busyRef.current = true
    setAnalysisProgress(null)
    setPending({ kind, target })
    return true
  }, [])

  const triggerAnalysis = useCallback(
    async (date: string) => {
      if (!claim('daily', date)) return
      try {
        await window.api.triggerAnalysis(date)
      } catch (err) {
        console.error('Failed to trigger analysis:', err)
        // 命令失败时后端不会发出 started/finished，撤销乐观状态
        if (!backendStatusRef.current) release()
      } finally {
        notifyComplete()
      }
    },
    [claim, notifyComplete, release]
  )

  const triggerRerun = useCallback(
    async (days: number | null) => {
      if (!claim('rerun', days === null ? 'all' : String(days))) return null
      try {
        return await window.api.rerunAnalysis(days)
      } catch (err) {
        console.error('Failed to rerun analysis:', err)
        if (!backendStatusRef.current) release()
        return null
      } finally {
        notifyComplete()
      }
    },
    [claim, notifyComplete, release]
  )

  const triggerPeriodicSummary = useCallback(
    async (periodLabel: string) => {
      if (!claim('summary', periodLabel)) return
      try {
        await window.api.triggerPeriodicSummary(periodLabel)
      } catch (err) {
        console.error('Failed to trigger summary:', err)
        if (!backendStatusRef.current) release()
      } finally {
        notifyComplete()
      }
    },
    [claim, notifyComplete, release]
  )

  const effective = status ?? pending
  const kind = effective?.kind
  const analyzing = kind === 'daily' || kind === 'scheduled'

  return (
    <AnalysisContext.Provider
      value={{
        analyzing,
        analysisProgress,
        analyzingDate: analyzing ? (effective?.target ?? null) : null,
        rerunning: kind === 'rerun',
        generating: kind === 'summary',
        generatingLabel: kind === 'summary' ? (effective?.target ?? null) : null,
        busy: effective !== null,
        busyLabel: describeStatus(effective),
        triggerAnalysis,
        triggerRerun,
        triggerPeriodicSummary,
        onAnalysisComplete
      }}
    >
      {children}
    </AnalysisContext.Provider>
  )
}

export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext)
  if (!ctx) throw new Error('useAnalysis must be used within AnalysisProvider')
  return ctx
}
