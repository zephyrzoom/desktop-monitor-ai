import { logger } from './logger'

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number
    label: string
    validate?: (result: T) => boolean
  }
): Promise<T> {
  const { maxRetries, label, validate } = options
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn()

      if (validate && !validate(result)) {
        throw new Error(`${label}: 返回结果验证失败`)
      }

      return result
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
        logger.warn(`[Retry] ${label} 第 ${attempt} 次失败，${delay}ms 后重试:`, err)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  logger.error(`[Retry] ${label} 重试 ${maxRetries} 次后仍然失败`)
  throw lastError
}
