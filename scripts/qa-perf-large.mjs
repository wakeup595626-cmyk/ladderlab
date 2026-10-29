/**
 * 大工程真实浏览器基线：导入一份“贴着上限”的工程，量出渲染、滚动和两条导出链路的时间。
 *
 * 用法：先 npm run build，再 node scripts/qa-perf-large.mjs
 * 输出 JSON，方便把数字贴进发布说明或对比优化前后的差异。
 */
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const PORT = Number(process.env.PERF_PORT ?? 4321)
const APP_URL = `http://127.0.0.1:${PORT}/`
const RUNGS = Number(process.env.PERF_RUNGS ?? 1000)
const CONTACTS = 4
const TAGS = 200

function buildProgram(rungs, contacts, tags) {
  const tagList = Array.from({ length: tags }, (_, index) => ({
    id: `t${index}`,
    name: `M${String(index).padStart(3, '0')}`,
    address: `%M${Math.floor(index / 8)}.${index % 8}`,
    kind: 'BOOL',
    initial: false,
    comment: `第 ${index} 个中间变量`,
  }))
  const rungList = Array.from({ length: rungs }, (_, index) => ({
    id: `r${index}`,
    label: `第 ${index + 1} 段`,
    nodes: Array.from({ length: contacts }, (_, slot) => ({
      type: 'contact',
      id: `c${index}-${slot}`,
      kind: slot % 2 === 0 ? 'NO' : 'NC',
      tag: tagList[(index + slot) % tags].name,
    })),
    output: { id: `o${index}`, kind: 'COIL', tag: tagList[index % tags].name },
  }))
  return { schema: 1, name: '性能基线工程', profile: 'v21', tags: tagList, rungs: rungList }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 预览服务器还没起来，继续等。
    }
    if (Date.now() > deadline) throw new Error(`预览服务器 ${url} 在 ${timeoutMs}ms 内没有就绪`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function main() {
  const program = buildProgram(RUNGS, CONTACTS, TAGS)
  const json = JSON.stringify(program)
  const server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let serverLog = ''
  server.stdout.on('data', (chunk) => { serverLog += chunk })
  server.stderr.on('data', (chunk) => { serverLog += chunk })

  const browser = await chromium.launch()
  const result = { programBytes: Buffer.byteLength(json), rungs: RUNGS, nodes: RUNGS * (CONTACTS + 1) }
  try {
    await waitForServer(APP_URL, 30_000)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
    const page = await context.newPage()
    page.setDefaultTimeout(90_000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.addInitScript(() => {
      window.__longTasks = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration))
      }).observe({ type: 'longtask', buffered: true })
    })

    let started = Date.now()
    await page.goto(APP_URL)
    await page.getByRole('heading', { name: '梯形实验室' }).waitFor()
    result.bootMs = Date.now() - started
    console.log('stage boot', result.bootMs)

    const coach = page.getByRole('button', { name: '关闭快速上手' })
    if (await coach.isVisible().catch(() => false)) await coach.click()

    await page.evaluate(() => { window.__longTasks.length = 0 })
    started = Date.now()
    await page.getByRole('button', { name: '导入工程文件' }).click()
    const dialog = page.getByRole('dialog', { name: '导入工程' })
    await dialog.waitFor()
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'perf.ladderlab.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    })
    const previewStarted = Date.now()
    await dialog.getByRole('button', { name: '导入并打开' }).click()
    await page.waitForFunction(() => document.querySelector('#project-name')?.value === '性能基线工程', null, { timeout: 120_000 })
    await page.waitForTimeout(500)
    result.parsePreviewMs = previewStarted - started
    result.importToRenderedMs = Date.now() - started
    result.importLongestTaskMs = await page.evaluate(() => Math.max(0, ...window.__longTasks))
    result.domNodes = await page.evaluate(() => document.querySelectorAll('*').length)
    result.alerts = await page.locator('[role="alert"], [role="status"]').allInnerTexts().catch(() => [])
    result.heapMB = await page.evaluate(() => {
      const memory = performance.memory
      return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null
    })
    console.log('stage import', result.importToRenderedMs, 'preview', result.parsePreviewMs, 'longestTask', result.importLongestTaskMs, 'dom', result.domNodes)

    // 滚到底再滚回来，看长列表滚动有没有卡顿（每帧间隔取最大值）。
    result.scroll = await page.evaluate(async () => {
      const scroller = [...document.querySelectorAll('*')]
        .filter((element) => element.scrollHeight > element.clientHeight + 400)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
      if (!scroller) return null
      const gaps = []
      let last = performance.now()
      let frames = 0
      const start = performance.now()
      await new Promise((resolve) => {
        const step = () => {
          const now = performance.now()
          gaps.push(now - last)
          last = now
          frames += 1
          scroller.scrollTop += scroller.scrollHeight / 60
          if (now - start < 1000 && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1) {
            requestAnimationFrame(step)
          } else {
            resolve()
          }
        }
        requestAnimationFrame(step)
      })
      gaps.sort((a, b) => a - b)
      return {
        frames,
        scrollHeight: scroller.scrollHeight,
        p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] * 10) / 10,
        maxFrameMs: Math.round(gaps[gaps.length - 1] * 10) / 10,
      }
    })
    console.log('stage scroll', JSON.stringify(result.scroll))

    async function exportOnce(itemName) {
      const menuStart = Date.now()
      if (await page.getByRole('menu', { name: '导出' }).isVisible().catch(() => false)) {
        await page.keyboard.press('Escape')
      }
      await page.getByRole('button', { name: /^导出工程/ }).click()
      const menu = page.getByRole('menu', { name: '导出' })
      await menu.waitFor()
      const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
      await menu.getByRole('menuitem', { name: itemName }).click()
      const download = await downloadPromise
      const path = await download.path()
      const { statSync } = await import('node:fs')
      return { ms: Date.now() - menuStart, bytes: path ? statSync(path).size : 0 }
    }

    await page.evaluate(() => { window.__longTasks.length = 0 })
    try {
      result.sfcSvg = await exportOnce('顺序功能图 SVG')
    } catch (error) {
      result.sfcSvg = { failed: String(error?.message ?? error).split('\n')[0] }
    }
    console.log('stage sfcExport', JSON.stringify(result.sfcSvg))
    result.sfcSvgLongestTaskMs = await page.evaluate(() => Math.max(0, ...window.__longTasks)).catch(() => null)
    await page.evaluate(() => { window.__longTasks.length = 0 })
    try {
      result.ladderSvg = await exportOnce('完整程序 SVG')
    } catch (error) {
      result.ladderSvg = { failed: String(error?.message ?? error).split('\n')[0] }
    }
    console.log('stage ladderExport', JSON.stringify(result.ladderSvg))
    result.ladderSvgLongestTaskMs = await page.evaluate(() => Math.max(0, ...window.__longTasks)).catch(() => null)
    result.errors = errors
  } finally {
    await browser.close()
    server.kill()
  }

  console.log(JSON.stringify(result, null, 2))
  if (serverLog && result.errors?.length) console.error(serverLog.slice(-2000))
}

await main()
