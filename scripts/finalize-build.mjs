import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(repoRoot, 'dist')
const assetsDir = join(distDir, 'assets')
const swPath = join(distDir, 'sw.js')
const manifestPath = join(distDir, 'asset-manifest.json')
const indexHtmlPath = join(distDir, 'index.html')
// 首屏预算按 CI 实际下发的压缩体积计算，防止新依赖和样式悄悄膨胀。
const BUDGETS = {
  initialJsGzip: 250 * 1024,
  initialCssGzip: 45 * 1024,
}

if (!existsSync(assetsDir) || !existsSync(swPath)) {
  throw new Error('finalize-build: dist/assets or dist/sw.js is missing; run vite build first')
}

function walkFiles(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...walkFiles(path))
    else files.push(path)
  }
  return files
}

function deploymentId() {
  const sha = process.env.GITHUB_SHA?.trim()
  if (sha && /^[\da-f]{7,40}$/i.test(sha)) return sha.slice(0, 12)
  try {
    const local = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (local) return local
  } catch {
    // Source archives and constrained build runners may not expose .git.
  }
  return 'local'
}

/** 同一提交必须得到同一版本号；优先使用 CI 提供的可复现时间戳。 */
function commitTimestamp() {
  const explicit = process.env.SOURCE_DATE_EPOCH?.trim()
  if (explicit && /^\d{9,12}$/.test(explicit)) return explicit.padStart(11, '0')
  try {
    const seconds = execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (/^\d{9,12}$/.test(seconds)) return seconds.padStart(11, '0')
  } catch {
    // Source archives and constrained build runners may not expose .git.
  }
  return String(Math.floor(Date.now() / 1000)).padStart(11, '0')
}

const files = walkFiles(assetsDir)
  .map((path) => relative(distDir, path).split(sep).join('/'))
  .sort()
writeFileSync(manifestPath, `${JSON.stringify({ format: 1, files }, null, 2)}\n`, 'utf8')

/** 只统计 index.html 真正预加载的入口 JS/CSS；懒加载块和按需图片不在首屏预算内。 */
function checkInitialAssetBudgets() {
  const html = readFileSync(indexHtmlPath, 'utf8')
  const initial = { js: new Set(), css: new Set() }
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+\.(?:js|css))["']/gi)) {
    const file = match[1]
    if (!file.startsWith('./assets/')) continue
    const kind = file.endsWith('.css') ? 'css' : 'js'
    initial[kind].add(file.slice(2))
  }

  const measure = (kind) => {
    let raw = 0
    let gzip = 0
    for (const relativePath of initial[kind]) {
      const absolutePath = join(distDir, relativePath)
      if (!existsSync(absolutePath)) {
        throw new Error('finalize-build: index.html 引用了不存在的入口资源 ' + relativePath)
      }
      const bytes = readFileSync(absolutePath)
      raw += bytes.byteLength
      gzip += gzipSync(bytes).byteLength
    }
    return { raw, gzip }
  }

  const js = measure('js')
  const css = measure('css')
  if (js.gzip > BUDGETS.initialJsGzip) {
    throw new Error(
      'finalize-build: 首屏 JS gzip ' + (js.gzip / 1024).toFixed(1) +
      ' KB 超过预算 ' + (BUDGETS.initialJsGzip / 1024).toFixed(0) +
      ' KB（原始 ' + (js.raw / 1024).toFixed(1) + ' KB）',
    )
  }
  if (css.gzip > BUDGETS.initialCssGzip) {
    throw new Error(
      'finalize-build: 首屏 CSS gzip ' + (css.gzip / 1024).toFixed(1) +
      ' KB 超过预算 ' + (BUDGETS.initialCssGzip / 1024).toFixed(0) +
      ' KB（原始 ' + (css.raw / 1024).toFixed(1) + ' KB）',
    )
  }
  console.log(
    'finalize-build: 首屏预算 JS ' + (js.gzip / 1024).toFixed(1) +
    '/250 KB，CSS ' + (css.gzip / 1024).toFixed(1) + '/45 KB',
  )
}

checkInitialAssetBudgets()

/**
 * 公开站点里绝不能出现能绕过 RLS 的密钥。
 * 这里直接扫产物，而不是只信 .env：只要 CI secret 填错，构建就失败，
 * 避免把 service_role 权限连同静态 JS 一起发布到 GitHub Pages。
 */
const secretPatterns = [/\bsb_secret_[A-Za-z0-9_-]{8,}/g, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g]
const jwtPayloadPattern = /\beyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\./
const leaked = []
for (const file of walkFiles(distDir)) {
  if (!/\.(?:js|mjs|html|json|css|map)$/i.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const pattern of secretPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[0].startsWith('sb_secret_')) {
        leaked.push({ file: relative(repoRoot, file), kind: 'sb_secret_*' })
        continue
      }
      const payload = jwtPayloadPattern.exec(match[0])?.[1]
      if (!payload) continue
      try {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
        const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
        if (decoded && decoded.role === 'service_role') {
          leaked.push({ file: relative(repoRoot, file), kind: 'service_role JWT' })
        }
      } catch {
        // 不是可解析的 JWT，继续扫描。
      }
    }
  }
}
if (leaked.length > 0) {
  const where = [...new Set(leaked.map((item) => `${item.file} (${item.kind})`))].join(', ')
  throw new Error(
    `finalize-build: 构建产物里发现高权限密钥：${where}。请立刻到 Supabase 轮换该密钥，并把 VITE_SUPABASE_ANON_KEY 改成 publishable / anon public key 后重新构建。`,
  )
}

const source = readFileSync(swPath, 'utf8')
const versionPattern = /const CACHE_VERSION = '([^']+)'/
const current = versionPattern.exec(source)?.[1]
if (!current) throw new Error('finalize-build: CACHE_VERSION was not found in dist/sw.js')
const deployId = deploymentId()
const baseVersion = /^v\d+/.exec(current)?.[0] ?? current
// 内容哈希覆盖 dist 里除 sw.js 外的全部文件：同一份源码重复构建得到同一
// 版本，资源真的变化时才换缓存。提交时间仍放最前，供缓存名排序。
const contentHash = createHash('sha256')
for (const file of walkFiles(distDir).sort()) {
  if (file === swPath) continue
  contentHash.update(relative(distDir, file).split(sep).join('/'))
  contentHash.update('\0')
  contentHash.update(readFileSync(file))
  contentHash.update('\0')
}
const buildHash = contentHash.digest('hex').slice(0, 12)
const committedAt = commitTimestamp()
const finalVersion = `${baseVersion}-${committedAt}-${buildHash}-${deployId}`
const versioned = source.replace(versionPattern, `const CACHE_VERSION = '${finalVersion}'`)
writeFileSync(swPath, versioned, 'utf8')

console.log(`finalize-build: ${files.length} assets, service worker ${finalVersion}`)
