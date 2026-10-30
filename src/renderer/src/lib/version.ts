/**
 * 版本信息。
 *
 * 版本号唯一来源是 package.json，打包前由 `scripts/bump-version.mjs` 递增并同步到
 * tauri.conf.json / Cargo.toml；vite 在构建时把版本号与构建时间注入前端，
 * 因此界面上展示的就是当前安装包的真实版本。
 */

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

const buildTimeIso: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

/** 是否开发模式（vite dev），开发模式下界面会额外标注 */
export const IS_DEV_BUILD: boolean = Boolean(import.meta.env.DEV)

/** 构建时间，格式 2026-10-30 10:15（本地时区）；拿不到时返回空串 */
export function getBuildTime(): string {
  if (!buildTimeIso) return ''
  const d = new Date(buildTimeIso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 展示用版本标签，如 v1.0.3 或 v1.0.3（开发模式） */
export function getVersionLabel(): string {
  return IS_DEV_BUILD ? `v${APP_VERSION} (dev)` : `v${APP_VERSION}`
}

/** 运行平台，如 Windows / macOS / Linux */
export function getPlatformName(): string {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Unknown'
}
