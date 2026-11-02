import type { PeriodicSummaryResult, YearlySummaryResult } from '../../../shared/types/database'

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

/** 季度汇总 → 可直接粘贴的纯文本 */
export function buildQuarterlySummaryText(label: string, result: PeriodicSummaryResult): string {
  const blocks: string[] = [`${formatQuarterLabel(label)}工作汇总`, `【概述】\n${result.summary}`]

  if (result.highlights.length > 0) {
    blocks.push(`【工作亮点】\n${numberedList(result.highlights)}`)
  }

  const categories = (result.work_categories || []).filter((cat) => cat && cat.category)
  if (categories.length > 0) {
    const lines = categories.map((cat) => `- ${cat.category}：${cat.percentage}%`)
    blocks.push(`【工作分类统计】\n${lines.join('\n')}`)
  }

  return blocks.join('\n\n')
}

/** 年度汇总 → 可直接粘贴的纯文本 */
export function buildYearlySummaryText(label: string, result: YearlySummaryResult): string {
  const title = `${formatYearLabel(label)}年度工作总结`.replace(/\s+/g, ' ')
  const blocks: string[] = [title]

  if (result.opening) {
    blocks.push(result.opening)
  }

  ;(result.categories || []).forEach((category, catIndex) => {
    const heading = `${CHINESE_NUMBERS[catIndex] || catIndex + 1}、${category.title}`
    const items = (category.items || [])
      .map((item, itemIndex) => `${itemIndex + 1}）${item.subtitle}\n${item.description}`.trim())
      .join('\n\n')
    blocks.push(items ? `${heading}\n\n${items}` : heading)
  })

  if (result.summary) {
    blocks.push(`【总结】\n${result.summary}`)
  }

  return blocks.join('\n\n')
}
