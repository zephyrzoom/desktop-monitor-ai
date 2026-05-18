import type { DailyAnalysisResult, WorkItem } from '../../shared/types/database'

export function buildDailyAnalysisPrompt(
  appUsageSummary: { app_name: string; total_duration_ms: number; count: number }[],
  timeRange: { start: string; end: string },
  priorWorkItems?: WorkItem[]
): string {
  const appUsageText = appUsageSummary
    .map((app) => {
      const minutes = Math.round(app.total_duration_ms / 60000)
      return `- ${app.app_name}: ${minutes}分钟 (切换${app.count}次)`
    })
    .join('\n')

  const priorContext =
    priorWorkItems && priorWorkItems.length > 0
      ? `\n之前已识别的工作内容（请避免重复）:\n${priorWorkItems.map((item) => `- ${item.time_range}: ${item.activity} (${item.app})`).join('\n')}\n`
      : ''

  return `你是一个工作内容分析助手。根据以下桌面截图和应用使用记录，分析用户在这段时间内做了什么工作。

时间范围: ${timeRange.start} - ${timeRange.end}

应用使用记录:
${appUsageText || '无应用使用记录'}
${priorContext}
请分析这些截图，识别用户的具体工作内容。返回严格的 JSON 格式，不要包含任何其他文字:

{
  "work_items": [
    {
      "time_range": "14:00-14:30",
      "activity": "编写 Python 数据处理脚本",
      "app": "VS Code",
      "category": "编程开发"
    }
  ],
  "summary": "这段时间主要完成了..."
}

注意:
- work_items 中的 activity 要具体描述用户在做什么，不要泛泛而谈
- category 可以是: 编程开发、文档写作、数据分析、会议沟通、网页浏览、设计工作、学习研究、邮件处理、其他
- 如果截图内容不清晰或无法判断，请基于应用使用记录推测
- 如果这段时间与之前的工作内容相关联，请确保你的分析在时间和活动上与已有内容保持连贯
- summary 用一两句话概括这段时间内的主要工作内容`
}

export function buildPeriodicSummaryPrompt(
  dailyAnalyses: { date: string; summary: string }[],
  periodType: 'quarter' | 'year',
  periodLabel: string
): string {
  const dailyText = dailyAnalyses.map((d) => `${d.date}: ${d.summary}`).join('\n')

  const periodName = periodType === 'quarter' ? '季度' : '年度'

  return `你是一个工作内容汇总助手。根据以下每日工作日报，生成一份${periodName}工作汇总。

${periodName}: ${periodLabel}

每日工作日报:
${dailyText || '无日报数据'}

请生成一份结构化的${periodName}工作汇总。返回严格的 JSON 格式，不要包含任何其他文字:

{
  "period": "${periodLabel}",
  "highlights": [
    "完成了一个重要的数据处理项目",
    "参加了多次技术评审会议"
  ],
  "work_categories": [
    {
      "category": "编程开发",
      "percentage": 45
    },
    {
      "category": "会议沟通",
      "percentage": 20
    }
  ],
  "summary": "本${periodName}主要工作集中在..."
}

注意:
- highlights 列出本${periodName}最重要的 3-5 个工作亮点
- work_categories 统计各类工作的时间占比，总和应为 100
- summary 用 2-3 句话概括本${periodName}的整体工作情况`
}

export function parseAnalysisResult(content: string): DailyAnalysisResult | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const result = JSON.parse(jsonMatch[0])

    if (!result.work_items || !Array.isArray(result.work_items)) return null
    if (!result.summary || typeof result.summary !== 'string') return null

    return {
      work_items: result.work_items.map((item: Record<string, unknown>) => ({
        time_range: String(item.time_range || ''),
        activity: String(item.activity || ''),
        app: String(item.app || ''),
        category: String(item.category || '其他')
      })),
      summary: result.summary
    }
  } catch {
    return null
  }
}

export function buildConsolidationPrompt(workItems: WorkItem[]): string {
  const workItemsText = workItems
    .map((item) => `- ${item.time_range}: ${item.activity} (${item.app}, ${item.category})`)
    .join('\n')

  return `你是一个工作内容分析助手。以下是一天中识别出的工作内容列表，请将相同主题的工作内容合并为一条。

工作内容列表:
${workItemsText}

合并规则:
- 相邻或相近时间段内、同一应用、同一主题的工作内容应合并为一条
- 合并后的 time_range 应覆盖原始各项的完整时间段（如 14:00-14:30 和 14:30-15:00 合并为 14:00-15:00）
- 合并后的 activity 应概括所有原始项的内容，用更精炼的描述
- 不同应用或不同主题的工作内容不要合并
- 如果没有可以合并的项目，原样返回

返回严格的 JSON 格式，不要包含任何其他文字:

{
  "work_items": [
    {
      "time_range": "14:00-15:30",
      "activity": "编写用户登录模块（含验证逻辑和bug修复）",
      "app": "VS Code",
      "category": "编程开发"
    }
  ]
}`
}

export function buildSummaryPrompt(
  workItems: WorkItem[],
  appUsageSummary: { app_name: string; total_duration_ms: number; count: number }[]
): string {
  const workItemsText = workItems
    .map((item) => `- ${item.time_range}: ${item.activity} (${item.app}, ${item.category})`)
    .join('\n')

  const appUsageText = appUsageSummary
    .map((app) => {
      const minutes = Math.round(app.total_duration_ms / 60000)
      return `- ${app.app_name}: ${minutes}分钟`
    })
    .join('\n')

  return `你是一个工作内容分析助手。根据以下今日工作记录和应用使用统计，生成一份简洁的工作总结。

工作记录:
${workItemsText}

应用使用统计:
${appUsageText}

请用 2-3 句话总结今天的主要工作内容和产出。只返回总结文字，不需要 JSON 格式。`
}
