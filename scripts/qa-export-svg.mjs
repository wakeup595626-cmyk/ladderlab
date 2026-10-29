/**
 * 导出验收：在真实浏览器里点一遍导出菜单，把 SVG / PNG 落到磁盘，
 * 再回读文件确认是纯矢量、纯白底、没有内嵌位图。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = Number(process.env.QA_PORT ?? 4183)
const APP = 'http://127.0.0.1:' + PORT + '/'
const configuredOutput = process.env.QA_OUT?.trim()
const OUT = configuredOutput
  ? path.resolve(configuredOutput)
  : await mkdtemp(path.join(os.tmpdir(), 'ladderlab-qa-svg-'))
const relativeOutput = path.relative(ROOT, OUT)
if (!relativeOutput || (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput))) {
  throw new Error('QA_OUT 必须指向仓库外部，避免验收脚本清理工程文件：' + OUT)
}

const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

function startPreview() {
  // 用 node 直接拉起 vite，不再经 cmd/npx 外壳：Windows 上 shell:true 会多一层 cmd.exe，
  // server.kill() 只杀到外壳，真正的 vite 进程继续占着端口和 stdout 管道，脚本干完活却永远不退出。
  const child = spawn(
    process.execPath,
    [VITE_BIN, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout.on('data', () => {})
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  return child
}

async function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 服务还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('预览服务没有在 ' + timeoutMs + 'ms 内就绪：' + url)
}

async function exportItem(page, label, filename) {
  await page.click('.wb-export-trigger')
  await page.waitForSelector('#topbar-export-menu', { state: 'visible' })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('menuitem', { name: label, exact: true }).click(),
  ])
  const target = path.join(OUT, filename)
  await download.saveAs(target)
  return target
}

function inspectSvg(text) {
  const viewBox = /viewBox="([^"]+)"/.exec(text)
  const width = /width="(\d+(?:\.\d+)?)"/.exec(text)
  const roles = [...text.matchAll(/\brole="([^"]+)"/g)].map((match) => match[1])
  const titleNodes = (text.match(/<title\b/g) ?? []).length
  return {
    xmlDeclaration: text.startsWith('<?xml'),
    hasSvg: text.includes('<svg'),
    nestedSvg: (text.match(/<svg/g) ?? []).length,
    textNodes: (text.match(/<text/g) ?? []).length,
    embeddedRaster: text.includes('data:image') || text.includes('<image'),
    whiteBackground: text.includes('fill="#ffffff"'),
    roles,
    titleNodes,
    hasForbiddenDomSemantics: /\s(?:aria-[a-z-]+|data-[a-z0-9-]+|tabindex|class|focusable)=/i.test(text),
    viewBox: viewBox ? viewBox[1] : null,
    width: width ? Number(width[1]) : null,
    bytes: Buffer.byteLength(text, 'utf8'),
  }
}

function assertCleanSvg(item) {
  if (!item.xmlDeclaration || !item.hasSvg || item.nestedSvg !== 1) {
    throw new Error(item.label + ' 不是单根 SVG 文档')
  }
  if (item.embeddedRaster) throw new Error(item.label + ' 含位图或外链图片')
  if (!item.whiteBackground) throw new Error(item.label + ' 没有纯白底色')
  // 三条 SVG 统一契约：根节点不带 role，也不带根级 <title>。
  if (item.roles.length > 0) {
    throw new Error(item.label + ' 残留 role 属性：' + JSON.stringify(item.roles))
  }
  if (item.hasForbiddenDomSemantics) {
    throw new Error(item.label + ' 残留 aria/data/tabindex/class/focusable 属性')
  }
  if (item.titleNodes > 0) {
    throw new Error(item.label + ' 残留 <title>：' + item.titleNodes)
  }
}

async function loadLab(page, label) {
  await page.getByRole('button', { name: '打开项目', exact: true }).click()
  const library = page.locator('.wb-tree-item', { hasText: '实验库' })
  await library.waitFor({ state: 'visible', timeout: 15000 })
  await library.click()
  const dialog = page.locator('.library-dialog')
  await dialog.waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('button', { name: '载入', exact: true }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 15000 })
  await page.waitForTimeout(500)
}

async function screenshotSvg(browser, file, name) {
  const text = await readFile(file, 'utf8')
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.setContent(
    '<!doctype html><html><head><meta charset="utf-8">'
      + '<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>'
      + '</head><body>' + text.replace(/^<\?xml[^>]*\?>/, '') + '</body></html>',
    { waitUntil: 'load' },
  )
  const size = await page.evaluate(() => {
    const svg = document.querySelector('svg')
    if (!svg) return null
    const box = svg.viewBox.baseVal
    const scale = Math.min(1360 / box.width, 1900 / box.height, 1)
    const width = Math.round(box.width * scale)
    const height = Math.round(box.height * scale)
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    return { width, height }
  })
  const target = path.join(OUT, 'view-' + name + '.png')
  await page.setViewportSize({
    width: Math.max(320, Math.min(1440, (size ? size.width : 1200) + 40)),
    height: Math.max(320, Math.min(2000, (size ? size.height : 900) + 40)),
  })
  await page.screenshot({ path: target, fullPage: true, timeout: 60000 })
  await page.close()
  return target
}

async function main() {
  await mkdir(OUT, { recursive: true })

  const server = startPreview()
  const report = { exports: [], screenshots: [] }
  try {
    await waitForServer(APP)
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 960 } })
    await page.goto(APP)
    await page.waitForSelector('.ll-diagram', { timeout: 30000 })
    await loadLab(page, '载入03 十字路口交通灯')

    const jobs = [
      ['完整程序 SVG', 'complete.svg', 'svg'],
      ['纯梯形图 SVG', 'plain.svg', 'svg'],
      ['顺序功能图 SVG', 'sfc.svg', 'svg'],
      ['完整程序 PNG', 'complete.png', 'png'],
      ['纯梯形图 PNG', 'plain.png', 'png'],
      ['顺序功能图 PNG', 'sfc.png', 'png'],
    ]
    for (const [label, filename, kind] of jobs) {
      const file = await exportItem(page, label, filename)
      if (kind === 'svg') {
        const text = await readFile(file, 'utf8')
        const inspected = { label, file, ...inspectSvg(text) }
        assertCleanSvg(inspected)
        report.exports.push(inspected)
        report.screenshots.push(await screenshotSvg(browser, file, filename.replace('.svg', '')))
      } else {
        const bytes = await readFile(file)
        const isPng = bytes.subarray(1, 4).toString() === 'PNG'
        if (!isPng || bytes.length < 2048) throw new Error(label + ' 不是有效 PNG：' + file)
        report.exports.push({ label, file, bytes: bytes.length, png: isPng })
      }
      console.log('✓ ' + label)
    }

    const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
    report.uniquePerLab = {
      lab03: digest(await readFile(path.join(OUT, 'sfc.svg'), 'utf8')),
    }
    const otherLabs = [
      ['载入01 四路抢答器', 'lab01'],
      ['载入02 定时器与计数器', 'lab02'],
      ['载入04 三层电梯', 'lab04'],
      ['载入05 音乐喷泉', 'lab05'],
      ['载入06 装配流水线', 'lab06'],
    ]
    for (const [label, key] of otherLabs) {
      await loadLab(page, label)
      const file = await exportItem(page, '顺序功能图 SVG', 'sfc-' + key + '.svg')
      const text = await readFile(file, 'utf8')
      const inspected = {
        label: '顺序功能图 SVG（' + key + '）',
        file,
        ...inspectSvg(text),
      }
      assertCleanSvg(inspected)
      report.exports.push(inspected)
      report.screenshots.push(await screenshotSvg(browser, file, 'sfc-' + key))
      report.uniquePerLab[key] = digest(text)
    }
    if (new Set(Object.values(report.uniquePerLab)).size !== 6) {
      throw new Error('六个实验导出的顺序功能图不是一一对应：' + JSON.stringify(report.uniquePerLab))
    }

    await browser.close()
  } finally {
    server.kill()
    server.stdout?.destroy()
    server.stderr?.destroy()
  }

  console.log(JSON.stringify({ output: OUT, ...report }, null, 2))
  // 兜底：万一还有句柄没释放，5 秒后强制退出，别让验收脚本永远挂住
  setTimeout(() => process.exit(0), 5000).unref()
}

main().catch((reason) => {
  console.error(reason)
  process.exitCode = 1
})

