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
