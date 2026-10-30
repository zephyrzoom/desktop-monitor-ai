#!/usr/bin/env node
/**
 * 版本号递增脚本（打包前自动执行）。
 *
 * 单一事实来源：package.json 的 version。
 * 执行后同步写入以下三个（四个）位置，避免打包产物版本与前端展示不一致：
 *   - package.json
 *   - src-tauri/tauri.conf.json   （Tauri 打包时读这里决定安装包版本）
 *   - src-tauri/Cargo.toml        （[package].version）
 *   - src-tauri/Cargo.lock        （cargo 会自动更新，这里先同步避免脏 diff）
 *
 * 用法：
 *   node scripts/bump-version.mjs            # 默认 patch：1.0.0 -> 1.0.1
 *   node scripts/bump-version.mjs minor      # 1.0.0 -> 1.1.0
 *   node scripts/bump-version.mjs major      # 1.0.0 -> 2.0.0
 *   node scripts/bump-version.mjs 1.4.2      # 直接指定版本
 *   node scripts/bump-version.mjs patch --dry-run
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkgPath = join(root, 'package.json')
const tauriConfPath = join(root, 'src-tauri/tauri.conf.json')
const cargoTomlPath = join(root, 'src-tauri/Cargo.toml')
const cargoLockPath = join(root, 'src-tauri/Cargo.lock')
const crateName = 'desktop-monitor'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => !a.startsWith('-')) ?? 'patch'

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const current = pkg.version
const next = resolveVersion(current, target)

if (next === current) {
  console.log(`[bump] 版本号未变化（${current}），跳过`)
  process.exit(0)
}

if (dryRun) {
  console.log(`[bump] 预演：${current} -> ${next}`)
  process.exit(0)
}

// 1) package.json
replaceJsonVersion(pkgPath, current, next, 'package.json')

// 2) tauri.conf.json
replaceJsonVersion(tauriConfPath, current, next, 'src-tauri/tauri.conf.json')

// 3) Cargo.toml，只改 [package] 段里的 version（不能碰 rust-version / 依赖版本）
const cargoToml = readFileSync(cargoTomlPath, 'utf-8')
const tomlRe = /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m
const tomlNext = cargoToml.replace(tomlRe, `$1${next}$2`)
if (tomlNext === cargoToml) {
  throw new Error('未能在 Cargo.toml 的 [package] 段找到 version 字段')
}
writeFileSync(cargoTomlPath, tomlNext)
console.log(`[bump] src-tauri/Cargo.toml          ${current} -> ${next}`)

// 4) Cargo.lock（存在才处理）
if (existsSync(cargoLockPath)) {
  const lock = readFileSync(cargoLockPath, 'utf-8')
  const lockRe = new RegExp(`(\\[\\[package\\]\\]\\nname = "${crateName}"\\nversion = ")[^"]+(")`)
  if (lockRe.test(lock)) {
    writeFileSync(cargoLockPath, lock.replace(lockRe, `$1${next}$2`))
    console.log(`[bump] src-tauri/Cargo.lock          ${current} -> ${next}`)
  }
}

console.log(`[bump] 完成：v${next}`)

/**
 * 只替换 JSON 顶层的 "version" 字段文本，避免整体重新序列化带来的格式噪音
 * （重新 stringify 会把 `["a", "b"]` 展开成多行，diff 很脏）。
 */
function replaceJsonVersion(filePath, from, to, label) {
  const raw = readFileSync(filePath, 'utf-8')
  const re = /(^ {2}"version"\s*:\s*")[^"]+(")/m
  if (!re.test(raw)) throw new Error(`未能在 ${label} 中找到顶层 version 字段`)
  writeFileSync(filePath, raw.replace(re, `$1${to}$2`))
  console.log(`[bump] ${label.padEnd(28)} ${from} -> ${to}`)
}

function resolveVersion(version, spec) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`package.json 版本号格式不合法：${version}`)

  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec

  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  switch (spec) {
    case 'major':
      major += 1
      minor = 0
      patch = 0
      break
    case 'minor':
      minor += 1
      patch = 0
      break
    case 'patch':
      patch += 1
      break
    default:
      throw new Error(`未知的版本参数：${spec}（可选 patch / minor / major / x.y.z）`)
  }
  return `${major}.${minor}.${patch}`
}
