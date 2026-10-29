import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(repoRoot, 'dist')
const assetsDir = join(distDir, 'assets')
const swPath = join(distDir, 'sw.js')
const manifestPath = join(distDir, 'asset-manifest.json')

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

const files = walkFiles(assetsDir)
  .map((path) => relative(distDir, path).split(sep).join('/'))
  .sort()
writeFileSync(manifestPath, `${JSON.stringify({ format: 1, files }, null, 2)}\n`, 'utf8')

const source = readFileSync(swPath, 'utf8')
const versionPattern = /const CACHE_VERSION = '([^']+)'/
const current = versionPattern.exec(source)?.[1]
if (!current) throw new Error('finalize-build: CACHE_VERSION was not found in dist/sw.js')
const deployId = deploymentId()
const baseVersion = /^v\d+/.exec(current)?.[0] ?? current
// UTC 时间戳放最前，Service Worker 才能按缓存名可靠地找出最新三个版本。
// 即使 finalize 被重复执行，也只替换基础版本，不会把后缀层层追加。
const deployedAt = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
const finalVersion = `${baseVersion}-${deployedAt}-${deployId}`
const versioned = source.replace(versionPattern, `const CACHE_VERSION = '${finalVersion}'`)
writeFileSync(swPath, versioned, 'utf8')

console.log(`finalize-build: ${files.length} assets, service worker ${finalVersion}`)
