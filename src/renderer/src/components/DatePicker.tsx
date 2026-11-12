import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { localDateString } from '../lib/date'

interface DatePickerProps {
  value: string
  onChange: (date: string) => void
  /** 已有日报的日期（YYYY-MM-DD），会在日历对应日期下方打点 */
  markedDates?: Set<string>
  /** 正在分析的日期，会在日历格子上显示转圈标记 */
  analyzingDate?: string | null
  /** 分析进行中：锁定日期切换，避免误以为可以同时分析多天 */
  disabled?: boolean
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return new Date()
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/**
 * 生成某月的日历格子（周一起始）。
 *
 * 月初之前的空位用 null 占位，保证 1 号落在正确的星期列上；
 * 日期统一走 localDateString 拼装，不受时区影响。
 */
function buildMonthGrid(year: number, month: number): (string | null)[] {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(localDateString(new Date(year, month, day)))
  }
  return cells
}

/** 日期选择器：自定义日历，支持在已有日报的日期上打点标记 */
export function DatePicker({
  value,
  onChange,
  markedDates,
  analyzingDate,
  disabled = false
}: DatePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const date = parseDate(value)
    return { year: date.getFullYear(), month: date.getMonth() }
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const today = localDateString()

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const cells = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month])

  function toggle(): void {
    if (disabled) return
    if (!open) {
      // 每次打开都回到选中日期所在的月份
      const date = parseDate(value)
      setView({ year: date.getFullYear(), month: date.getMonth() })
    }
    setOpen((prev) => !prev)
  }

  function shiftMonth(delta: number): void {
    setView((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  function select(date: string): void {
    onChange(date)
    setOpen(false)
  }

  return (
    <div className="date-picker" ref={rootRef}>
      <button
        type="button"
        className={`date-picker-trigger${open ? ' open' : ''}`}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={disabled ? '分析进行中，完成后才能切换日期' : undefined}
      >
        <Icon name="calendar" size={15} />
        <span className="date-picker-value">{value}</span>
        <Icon name="chevron-down" size={14} className={open ? 'icon-flip' : undefined} />
      </button>

      {open && (
        <div className="calendar" role="dialog" aria-label="选择日期">
          <div className="calendar-head">
            <button
              type="button"
              className="calendar-nav"
              onClick={() => shiftMonth(-1)}
              aria-label="上个月"
            >
              <Icon name="chevron-left" size={16} />
            </button>
            <span className="calendar-month">
              {view.year} 年 {view.month + 1} 月
            </span>
            <button
              type="button"
              className="calendar-nav"
              onClick={() => shiftMonth(1)}
              aria-label="下个月"
            >
              <Icon name="chevron-right" size={16} />
            </button>
          </div>

          <div className="calendar-grid">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="calendar-weekday">
                {label}
              </span>
            ))}
            {cells.map((cell, index) => {
              if (!cell) {
                return <span key={`blank-${index}`} className="calendar-blank" />
              }
              const hasReport = markedDates?.has(cell) ?? false
              const isSelected = cell === value
              const isToday = cell === today
              const isAnalyzing = cell === analyzingDate
              const classes = [
                'calendar-day',
                isSelected ? 'is-selected' : '',
                isToday ? 'is-today' : '',
                hasReport ? 'has-report' : '',
                isAnalyzing ? 'is-analyzing' : ''
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <button
                  type="button"
                  key={cell}
                  className={classes}
                  onClick={() => select(cell)}
                  disabled={disabled}
                  title={
                    isAnalyzing ? `${cell} · 正在分析` : hasReport ? `${cell} · 已有日报` : cell
                  }
                  aria-current={isSelected ? 'date' : undefined}
                >
                  {Number(cell.slice(8))}
                  {hasReport && <span className="calendar-dot" aria-hidden="true" />}
                  {isAnalyzing && <span className="calendar-spinner" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          <div className="calendar-foot">
            <span className="calendar-legend">
              <span className="calendar-dot" aria-hidden="true" />
              已有日报
            </span>
            {analyzingDate && (
              <span className="calendar-legend">
                <span className="calendar-spinner is-inline" aria-hidden="true" />
                分析中
              </span>
            )}
            <button
              type="button"
              className="calendar-today"
              onClick={() => select(today)}
              disabled={disabled}
            >
              回到今天
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
