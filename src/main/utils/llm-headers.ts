/**
 * 解析用户在设置中填写的自定义请求头文本。
 *
 * 格式：每行一条，"Key: Value"，支持 "Key:Value"（无空格）写法；
 * 以 # 开头的行视为注释跳过；无冒号或 Key 为空的行忽略。
 */
export function parseCustomHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!raw) return headers

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (!key) continue
    headers[key] = value
  }

  return headers
}
