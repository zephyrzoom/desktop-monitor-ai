/**
 * 以本地时区格式化为 YYYY-MM-DD。
 *
 * 不能用 `toISOString().split('T')[0]`：它先转成 UTC，在东八区每天 00:00-08:00
 * 之间会返回昨天的日期，导致「今日概览」和日报默认日期错一天。
 */
export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 当前季度标签，如 2026-Q4（用于汇总页默认选中） */
export function currentQuarterLabel(): string {
  const now = new Date()
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

/** 当前年份标签，如 2026（用于汇总页默认选中） */
export function currentYearLabel(): string {
  return String(new Date().getFullYear())
}

/**
 * 把 YYYY-MM-DD 格式化成中文可读形式，如「2026年11月2日 星期一」。
 *
 * 用 new Date(y, m-1, d) 构造，避免 `new Date('2026-11-02')` 按 UTC 解析导致星期错位。
 */
export function formatDateLabel(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) return dateStr
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`
}
