import OpenAI from 'openai'
import { nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getScreenshotsByDate } from '../database/queries/screenshots'
import { getAppUsageSummaryByDate, getAppUsageSummaryByTimeRange, getWindowSwitchSequence } from '../database/queries/activeWindows'
import { insertOrUpdateDailyAnalysis } from '../database/queries/dailyAnalysis'
import { getActiveTaskMemories, insertTaskMemory, updateTaskMemory, expireStaleTaskMemories } from '../database/queries/taskMemory'
import { buildDailyAnalysisPrompt, buildConsolidationPrompt, buildSummaryPrompt, buildTaskMemoryUpdatePrompt, parseAnalysisResult } from './PromptBuilder'
import { getConfigValue } from '../config/store'
import { logger } from '../utils/logger'
import { withRetry } from '../utils/retry'
import type { Screenshot, DailyAnalysisResult, AnalysisProgress, WorkItem, TaskMemory } from '../../shared/types/database'

export class DailyAnalyzer {
  private openai: OpenAI
  private model: string
  private maxScreenshotsPerBatch: number
  private gapThresholdMinutes: number
  private taskMemoryDays: number
  private maxRetries: number

  constructor(
    apiKey: string,
    baseUrl: string,
    model: string,
    maxScreenshotsPerBatch = 15,
    gapThresholdMinutes = 15,
    taskMemoryDays = 3,
    maxRetries = 3
  ) {
    this.openai = new OpenAI({ apiKey, baseURL: baseUrl })
    this.model = model || 'gpt-4o'
    this.maxScreenshotsPerBatch = maxScreenshotsPerBatch
    this.gapThresholdMinutes = gapThresholdMinutes
    this.taskMemoryDays = taskMemoryDays
    this.maxRetries = maxRetries
  }

  async analyze(date: string, onProgress?: (progress: AnalysisProgress) => void): Promise<DailyAnalysisResult | null> {
    const screenshots = getScreenshotsByDate(date)
    const appUsage = getAppUsageSummaryByDate(date)

    if (screenshots.length === 0) {
      logger.info(`[DailyAnalyzer] ${date} 无截图数据，跳过分析`)
      return null
    }

    logger.info(`[DailyAnalyzer] 开始分析 ${date}，共 ${screenshots.length} 张截图`)

    onProgress?.({ step: '获取截图数据', current: 0, total: 0 })

    const sortedScreenshots = [...screenshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const batches = this.createBatches(sortedScreenshots)
    const taskMemories = getActiveTaskMemories(this.taskMemoryDays)

    logger.info(`[DailyAnalyzer] 分为 ${batches.length} 批处理，模型: ${this.model}，活跃任务记忆: ${taskMemories.length} 条`)

    onProgress?.({ step: `已准备 ${sortedScreenshots.length} 张截图，分为 ${batches.length} 批`, current: 0, total: 0 })

    const allWorkItems: WorkItem[] = []
    const priorWorkItems: WorkItem[] = []

    for (let i = 0; i < batches.length; i++) {
      onProgress?.({ step: `正在分析第 ${i + 1}/${batches.length} 批...`, current: i + 1, total: batches.length })

      const batchAppUsage = this.getBatchAppUsage(batches[i])
      const batchWindowSequence = this.getBatchWindowSequence(batches[i])
      const priorContext = i > 0 ? [...priorWorkItems] : undefined

      const result = await this.analyzeBatch(batches[i], batchAppUsage, date, priorContext, batchWindowSequence, taskMemories)
      if (result) {
        allWorkItems.push(...result.work_items)
        priorWorkItems.push(...result.work_items)
      }
    }

    if (allWorkItems.length === 0) {
      return null
    }

    onProgress?.({ step: '正在合并同类工作内容...', current: 0, total: 0 })

    logger.info(`[DailyAnalyzer] 批次分析完成，共 ${allWorkItems.length} 个工作项，开始合并`)

    allWorkItems.sort((a, b) => a.time_range.localeCompare(b.time_range))

    const consolidatedItems = await this.consolidateWorkItems(allWorkItems)

    onProgress?.({ step: '正在更新任务记忆...', current: 0, total: 0 })

    await this.updateTaskMemories(consolidatedItems, taskMemories, date)

    onProgress?.({ step: '正在生成工作总结...', current: 0, total: 0 })

    const overallSummary = await this.generateOverallSummary(consolidatedItems, appUsage, date)

    const finalResult: DailyAnalysisResult = {
      work_items: consolidatedItems,
      summary: overallSummary
    }

    logger.info(`[DailyAnalyzer] ${date} 分析完成: ${consolidatedItems.length} 个工作项, ${overallSummary.length} 条总结`)
    insertOrUpdateDailyAnalysis(date, JSON.stringify(finalResult))

    return finalResult
  }

  private createBatches(screenshots: Screenshot[]): Screenshot[][] {
    if (screenshots.length === 0) return []

    const gapMs = this.gapThresholdMinutes * 60 * 1000
    const rawBatches: Screenshot[][] = []
    let currentBatch: Screenshot[] = [screenshots[0]]

    for (let i = 1; i < screenshots.length; i++) {
      const prevTime = new Date(screenshots[i - 1].timestamp).getTime()
      const currTime = new Date(screenshots[i].timestamp).getTime()
      const gap = currTime - prevTime

      if (gap > gapMs) {
        rawBatches.push(currentBatch)
        currentBatch = [screenshots[i]]
      } else {
        currentBatch.push(screenshots[i])
      }
    }
    rawBatches.push(currentBatch)

    const finalBatches: Screenshot[][] = []
    for (const batch of rawBatches) {
      finalBatches.push(...this.splitOversizedBatch(batch))
    }

    return finalBatches
  }

  private splitOversizedBatch(batch: Screenshot[]): Screenshot[][] {
    if (batch.length <= this.maxScreenshotsPerBatch) {
      return [batch]
    }

    let maxGap = 0
    let splitIndex = -1
    for (let i = 1; i < batch.length; i++) {
      const gap =
        new Date(batch[i].timestamp).getTime() - new Date(batch[i - 1].timestamp).getTime()
      if (gap > maxGap) {
        maxGap = gap
        splitIndex = i
      }
    }

    if (splitIndex === -1 || maxGap === 0) {
      splitIndex = Math.ceil(batch.length / 2)
    }

    const left = batch.slice(0, splitIndex)
    const right = batch.slice(splitIndex)

    return [...this.splitOversizedBatch(left), ...this.splitOversizedBatch(right)]
  }

  private getBatchAppUsage(screenshots: Screenshot[]): { app_name: string; total_duration_ms: number; count: number }[] {
    if (screenshots.length === 0) return []
    const startTime = screenshots[0].timestamp
    const endTime = screenshots[screenshots.length - 1].timestamp
    return getAppUsageSummaryByTimeRange(startTime, endTime)
  }

  private getBatchWindowSequence(screenshots: Screenshot[]): { time: string; app_name: string; window_title: string }[] {
    if (screenshots.length === 0) return []
    const startTime = screenshots[0].timestamp
    const endTime = screenshots[screenshots.length - 1].timestamp
    return getWindowSwitchSequence(startTime, endTime)
  }

  private async analyzeBatch(
    screenshots: Screenshot[],
    appUsage: { app_name: string; total_duration_ms: number; count: number }[],
    _date: string,
    priorWorkItems?: WorkItem[],
    windowSequence?: { time: string; app_name: string; window_title: string }[],
    taskMemories?: TaskMemory[]
  ): Promise<DailyAnalysisResult | null> {
    try {
      const base64Images = await this.prepareImages(screenshots)

      logger.info(`[DailyAnalyzer] 调用 AI 分析批次: ${screenshots.length} 张截图, ${base64Images.length} 张已编码, 时间 ${screenshots[0].timestamp.split('T')[1]?.substring(0, 5)}-${screenshots[screenshots.length - 1].timestamp.split('T')[1]?.substring(0, 5)}`)

      const timeRange = {
        start: screenshots[0].timestamp.split('T')[1]?.substring(0, 5) || '00:00',
        end: screenshots[screenshots.length - 1].timestamp.split('T')[1]?.substring(0, 5) || '23:59'
      }

      const prompt = buildDailyAnalysisPrompt(appUsage, timeRange, priorWorkItems, windowSequence, taskMemories)

      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        { type: 'text', text: prompt }
      ]

      for (const base64 of base64Images) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' }
        })
      }

      const response = await withRetry(
        () => this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content }],
          max_tokens: 2000
        }),
        {
          maxRetries: this.maxRetries,
          label: 'analyzeBatch',
          validate: (res) => !!(res.choices?.length && res.choices[0]?.message?.content)
        }
      )

      const responseContent = response.choices[0]?.message?.content
      if (!responseContent) return null

      logger.info(`[DailyAnalyzer] AI 分析批次完成，响应长度: ${responseContent.length} 字符`)
      return parseAnalysisResult(responseContent)
    } catch (err) {
      logger.error('AI analysis batch error:', err)
      return null
    }
  }

  private async generateOverallSummary(
    workItems: WorkItem[],
    fullDayAppUsage: { app_name: string; total_duration_ms: number; count: number }[],
    _date: string
  ): Promise<string[]> {
    try {
      logger.info(`[DailyAnalyzer] 调用 AI 生成工作总结，${workItems.length} 个工作项`)
      const prompt = buildSummaryPrompt(workItems, fullDayAppUsage)
      const response = await withRetry(
        () => this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        }),
        {
          maxRetries: this.maxRetries,
          label: 'generateOverallSummary',
          validate: (res) => !!(res.choices?.length && res.choices[0]?.message?.content)
        }
      )
      const content = response.choices?.[0]?.message?.content || '[]'
      logger.info(`[DailyAnalyzer] AI 工作总结生成完成，响应长度: ${content.length} 字符`)
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.map((s: unknown) => String(s))
        }
      }
      return ['无法生成工作总结']
    } catch (err) {
      logger.error('Summary generation error:', err)
      return ['工作总结生成失败']
    }
  }

  private async consolidateWorkItems(workItems: WorkItem[]): Promise<WorkItem[]> {
    if (workItems.length <= 1) return workItems

    try {
      logger.info(`[DailyAnalyzer] 调用 AI 合并 ${workItems.length} 个工作项`)
      const prompt = buildConsolidationPrompt(workItems)
      const response = await withRetry(
        () => this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2000
        }),
        {
          maxRetries: this.maxRetries,
          label: 'consolidateWorkItems',
          validate: (res) => !!(res.choices?.length && res.choices[0]?.message?.content)
        }
      )

      const responseContent = response.choices?.[0]?.message?.content
      if (!responseContent) return workItems

      const jsonMatch = responseContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return workItems

      const result = JSON.parse(jsonMatch[0])
      if (!result.work_items || !Array.isArray(result.work_items)) {
        logger.warn('[DailyAnalyzer] AI 合并结果格式无效')
        return workItems
      }

      logger.info(`[DailyAnalyzer] AI 合并完成: ${workItems.length} -> ${result.work_items.length} 个工作项`)
      return result.work_items.map((item: Record<string, unknown>) => ({
        time_range: String(item.time_range || ''),
        activity: String(item.activity || ''),
        app: String(item.app || ''),
        category: String(item.category || '其他')
      }))
    } catch (err) {
      logger.error('Work items consolidation error:', err)
      return workItems
    }
  }

  private async updateTaskMemories(
    workItems: WorkItem[],
    existingMemories: TaskMemory[],
    date: string
  ): Promise<void> {
    if (workItems.length === 0) return

    try {
      const prompt = buildTaskMemoryUpdatePrompt(workItems, existingMemories)
      const response = await withRetry(
        () => this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1500
        }),
        {
          maxRetries: this.maxRetries,
          label: 'updateTaskMemories',
          validate: (res) => !!(res.choices?.length && res.choices[0]?.message?.content)
        }
      )

      const responseContent = response.choices?.[0]?.message?.content
      if (!responseContent) return

      const jsonMatch = responseContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return

      const result = JSON.parse(jsonMatch[0])
      if (!result.task_updates || !Array.isArray(result.task_updates)) {
        logger.warn('[DailyAnalyzer] 任务记忆更新: AI 返回格式无效')
        return
      }

      const lastTime = workItems[workItems.length - 1].time_range.split('-')[1] || '23:59'

      for (const update of result.task_updates) {
        const action = String(update.action || '')
        const summary = String(update.task_summary || '')
        const category = String(update.category || '其他')
        const apps = Array.isArray(update.app_cluster) ? update.app_cluster.map(String) : []
        const durationMs = Number(update.duration_ms) || 0
        const memoryId = update.memory_id as number | undefined

        if (action === 'continue' && memoryId) {
          updateTaskMemory(memoryId, date, lastTime, durationMs)
          logger.info(`[DailyAnalyzer] 更新任务记忆 #${memoryId}: ${summary}`)
        } else if (action === 'new' && summary) {
          insertTaskMemory(summary, category, apps, date, lastTime, durationMs)
          logger.info(`[DailyAnalyzer] 新增任务记忆: ${summary}`)
        }
      }

      expireStaleTaskMemories(this.taskMemoryDays)
    } catch (err) {
      logger.error('Task memory update error:', err)
    }
  }

  private async prepareImages(screenshots: Screenshot[]): Promise<string[]> {
    const configDir = getConfigValue('monitoring').screenshotsDir
    const screenshotsDir = configDir || path.join(app.getPath('userData'), 'screenshots')
    const results: string[] = []

    for (const screenshot of screenshots) {
      try {
        const filePath = path.join(screenshotsDir, screenshot.file_path)
        if (!fs.existsSync(filePath)) continue

        const img = nativeImage.createFromPath(filePath)

        // 跳过空图片或无效图片
        if (img.isEmpty()) {
          logger.warn(`Skipping empty image: ${filePath}`)
          continue
        }

        const size = img.getSize()
        if (size.width === 0 || size.height === 0) {
          logger.warn(`Skipping invalid image dimensions: ${filePath}`)
          continue
        }

        const maxW = 1280
        let resized = img
        if (size.width > maxW) {
          resized = img.resize({ width: maxW })
        }
        const buffer = resized.toJPEG(80)

        // 验证 base64 数据有效性
        const base64 = buffer.toString('base64')
        if (!base64 || base64.length < 100) {
          logger.warn(`Skipping invalid image data: ${filePath}`)
          continue
        }

        results.push(base64)
      } catch (err) {
        logger.error('Failed to process screenshot:', err)
      }
    }

    return results
  }
}
