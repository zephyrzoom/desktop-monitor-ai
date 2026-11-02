import type {
  PeriodicSummaryResult,
  YearlyCategory,
  YearlySummaryResult
} from '../../../shared/types/database'

const CHINESE_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/** 2026-Q1 → 2026 年第一季度；无法识别时原样返回 */
export function formatQuarterLabel(label: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(label.trim())
  if (!match) return label
  const quarterNames = ['第一季度', '第二季度', '第三季度', '第四季度']
  return `${match[1]} 年${quarterNames[Number(match[2]) - 1]}`
}

function formatYearLabel(label: string): string {
  const match = /^(\d{4})$/.exec(label.trim())
  return match ? `${match[1]} ` : `${label} `
}

function numberedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

/* ------------------------------- 季度 ------------------------------- */

/** 单节：概述 */
export function buildQuarterlyOverviewText(result: PeriodicSummaryResult): string {
  return result.summary ? `【概述】\n${result.summary}` : ''
}

/** 单节：工作亮点 */
export function buildQuarterlyHighlightsText(result: PeriodicSummaryResult): string {
  const highlights = result.highlights || []
  return highlights.length > 0 ? `【工作亮点】\n${numberedList(highlights)}` : ''
}

/** 单节：工作分类统计 */
export function buildQuarterlyCategoryText(result: PeriodicSummaryResult): string {
  const lines = (result.work_categories || [])
    .filter((cat) => cat && cat.category)
    .map((cat) => `- ${cat.category}：${cat.percentage}%`)
  return lines.length > 0 ? `【工作分类统计】\n${lines.join('\n')}` : ''
}

/** 整篇季度汇总 */
export function buildQuarterlyFullText(label: string, result: PeriodicSummaryResult): string {
  const blocks = [
    `${formatQuarterLabel(label)}工作汇总`,
    buildQuarterlyOverviewText(result),
    buildQuarterlyHighlightsText(result),
    buildQuarterlyCategoryText(result)
  ].filter(Boolean)
  return blocks.join('\n\n')
}

/* ------------------------------- 年度 ------------------------------- */

/** 单节：开头语 */
export function buildYearlyOpeningText(result: YearlySummaryResult): string {
  return result.opening || ''
}

/** 单节：某个分类（含「一、」标题与「1）」条目） */
export function buildYearlyCategoryText(category: YearlyCategory, index: number): string {
  const heading = `${CHINESE_NUMBERS[index] || index + 1}、${category.title}`
  const items = (category.items || [])
    .map((item, itemIndex) => `${itemIndex + 1}）${item.subtitle}\n${item.description}`.trim())
    .join('\n\n')
  return items ? `${heading}\n\n${items}` : heading
}

/** 单节：总结 */
export function buildYearlyConclusionText(result: YearlySummaryResult): string {
  return result.summary ? `【总结】\n${result.summary}` : ''
}

/** 整篇年度汇总 */
export function buildYearlyFullText(label: string, result: YearlySummaryResult): string {
  const categoryBlocks = (result.categories || []).map((category, catIndex) =>
    buildYearlyCategoryText(category, catIndex)
  )

  const blocks = [
    `${formatYearLabel(label)}年度工作总结`.replace(/\s+/g, ' '),
    buildYearlyOpeningText(result),
    ...categoryBlocks,
    buildYearlyConclusionText(result)
  ].filter(Boolean)

  return blocks.join('\n\n')
}
