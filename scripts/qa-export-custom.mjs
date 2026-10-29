/**
 * 自定义工程导出验收：从真实 JSON 文件导入状态链和纯组合工程，
 * 在桌面与 375px 触屏上导出顺序功能图，核对图形结构、提示与确定性。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = Number(process.env.QA_PORT ?? 4184)
const APP = 'http://127.0.0.1:' + PORT + '/'
const configuredOutput = process.env.QA_OUT?.trim()
const OUT = configuredOutput
  ? path.resolve(configuredOutput)
  : await mkdtemp(path.join(os.tmpdir(), 'ladderlab-qa-custom-'))
const relativeOutput = path.relative(ROOT, OUT)
if (!relativeOutput || (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput))) {
  throw new Error('QA_OUT 必须指向仓库外部，避免验收脚本清理工程文件：' + OUT)
}

const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const JSON_DIR = await mkdtemp(path.join(os.tmpdir(), 'ladderlab-qa-custom-json-'))

function boolTag(id, name, address, comment = name) {
  return { id, name, address, kind: 'BOOL', initial: false, comment }
}

function contact(id, kind, tag) {
  return { type: 'contact', id, kind, tag }
}

function ladderRung(id, label, nodes, outputKind, outputTag) {
  return {
    id,
    label,
    nodes,
    output: { id: id + '-out', kind: outputKind, tag: outputTag },
  }
}

const STATE_PROGRAM = {
  schema: 1,
  name: 'QA自定义状态工程',
  profile: 'v21',
  tags: [
    boolTag('t-start', 'Start', '%I0.0'),
    boolTag('t-next', 'Next', '%I0.1'),
    boolTag('t-stop', 'Stop', '%I0.2'),
    boolTag('t-state-a', 'StateA', '%M0.0'),
    boolTag('t-state-b', 'StateB', '%M0.1'),
    boolTag('t-lamp-a', 'LampA', '%Q0.0'),
    boolTag('t-lamp-b', 'LampB', '%Q0.1'),
  ],
  rungs: [
    ladderRung(
      'r1',
      '启动进入 A',
      [contact('r1-c1', 'P', 'Start'), contact('r1-c2', 'NC', 'StateB')],
      'SET',
      'StateA',
    ),
    ladderRung(
      'r2',
      'A 移交 B',
      [contact('r2-c1', 'NO', 'StateA'), contact('r2-c2', 'P', 'Next')],
      'SET',
      'StateB',
    ),
    ladderRung(
      'r3',
      'B 结束 A',
      [contact('r3-c1', 'NO', 'StateB')],
      'RESET',
      'StateA',
    ),
    ladderRung(
      'r4',
      '停止 B',
      [contact('r4-c1', 'NO', 'Stop')],
      'RESET',
      'StateB',
    ),
    ladderRung(
      'r5',
      'A 指示灯',
      [contact('r5-c1', 'NO', 'StateA')],
      'COIL',
      'LampA',
    ),
    ladderRung(
      'r6',
      'B 指示灯',
      [contact('r6-c1', 'NO', 'StateB')],
      'COIL',
      'LampB',
    ),
  ],
}

const COMBINED_PROGRAM = {
  schema: 1,
  name: 'QA自定义组合工程',
  profile: 'v21',
  tags: [
    boolTag('t-start', 'Start', '%I0.0'),
    boolTag('t-mode', 'Mode', '%I0.1'),
    boolTag('t-out', 'Out', '%Q0.0'),
  ],
  rungs: [
    ladderRung(
      'r1',
      '启动与模式',
      [contact('r1-c1', 'NO', 'Start'), contact('r1-c2', 'NO', 'Mode')],
      'COIL',
      'Out',
    ),
  ],
}

const BUILT_IN_LEAKS = [
  '四路抢答器',
  '数码管段',
  '工位',
  '上行方向',
  '音乐喷泉',
]

const BUILT_IN_LABS = [
  ['载入01 四路抢答器', 'lab01'],
  ['载入02 定时器与计数器', 'lab02'],
  ['载入03 十字路口交通灯', 'lab03'],
  ['载入04 三层电梯', 'lab04'],
  ['载入05 音乐喷泉', 'lab05'],
  ['载入06 装配流水线', 'lab06'],
]

function startPreview() {
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
      // 预览服务尚未就绪。
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('预览服务没有在 ' + timeoutMs + 'ms 内就绪：' + url)
}

async function openHome(page) {
  await page.goto(APP)
  await page.getByRole('heading', { name: '梯形实验室' }).waitFor({ timeout: 30000 })
  const dismiss = page.getByRole('button', { name: '关闭快速上手' })
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click()
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function visibleText(text) {
  return [...text.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => decodeXmlEntities(match[1].replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean)
    .join('\n')
}

function inspectSvg(text, label, file) {
  const viewBox = /viewBox="([^"]+)"/.exec(text)
  const width = /<svg\b[^>]*\bwidth="(\d+(?:\.\d+)?)"/.exec(text)
  const height = /<svg\b[^>]*\bheight="(\d+(?:\.\d+)?)"/.exec(text)
  const steps = countMatches(text, /<rect\b[^>]*\brx="5"/g)
  const directTransitions = countMatches(text, /<line\b[^>]*\bstroke-width="2\.4"/g)
  const backJumps = countMatches(text, /<path\b[^>]*\bstroke-linejoin="miter"/g)
  const arrows = countMatches(text, /<path\b[^>]*\bfill="#1c4b74"/g)
  return {
    label,
    file,
    xmlDeclaration: text.startsWith('<?xml'),
    namespace: /<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(text),
    nestedSvg: countMatches(text, /<svg\b/g),
    width: width ? Number(width[1]) : null,
    height: height ? Number(height[1]) : null,
    viewBox: viewBox ? viewBox[1] : null,
    textNodes: countMatches(text, /<text\b/g),
    steps,
    directTransitions,
    backJumps,
    arrows,
    edges: directTransitions + arrows,
    whiteBackground: text.includes('fill="#ffffff"'),
    embeddedRaster: text.includes('data:image') || text.includes('<image'),
    foreignObject: text.includes('<foreignObject'),
    titleNodes: countMatches(text, /<title\b/g),
    roles: [...text.matchAll(/\brole="([^"]+)"/g)].map((match) => match[1]),
    forbiddenDomSemantics: /\s(?:aria-[a-z-]+|data-[a-z0-9-]+|tabindex|class|focusable)=/i.test(text),
    bytes: Buffer.byteLength(text, 'utf8'),
    text: visibleText(text),
  }
}

function assertCleanSvg(item) {
  if (!item.xmlDeclaration || !item.namespace || item.nestedSvg !== 1) {
    throw new Error(item.label + ' 不是单根、带命名空间的 SVG 文档')
  }
  if (!item.whiteBackground) throw new Error(item.label + ' 没有纯白底色')
  if (item.embeddedRaster) throw new Error(item.label + ' 含位图或外链图片')
  if (item.foreignObject) throw new Error(item.label + ' 含 foreignObject')
  if (item.roles.length > 0) {
    throw new Error(item.label + ' 残留 role 属性：' + JSON.stringify(item.roles))
  }
  if (item.titleNodes > 0) throw new Error(item.label + ' 残留 <title>')
  if (item.forbiddenDomSemantics) {
    throw new Error(item.label + ' 残留 aria/data/tabindex/class/focusable 属性')
  }
  if (!item.width || !item.height || !item.viewBox) {
    throw new Error(item.label + ' 缺少正数宽高或 viewBox')
  }
  const expectedViewBox = '0 0 ' + Math.ceil(item.width) + ' ' + Math.ceil(item.height)
  if (item.viewBox !== expectedViewBox) {
    throw new Error(item.label + ' 的 viewBox 与宽高不一致：' + item.viewBox + ' != ' + expectedViewBox)
  }
}

async function assertParsedSvg(page, item, text) {
  const parsed = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml')
    const error = document.querySelector('parsererror')?.textContent ?? ''
    return {
      error,
      rootName: document.documentElement.nodeName,
      rootChildren: document.documentElement.childElementCount,
    }
  }, text)
  if (parsed.error) throw new Error(item.label + ' 不是合法 XML：' + parsed.error.slice(0, 240))
  if (parsed.rootName !== 'svg' || parsed.rootChildren === 0) {
    throw new Error(item.label + ' 根节点无效：' + JSON.stringify(parsed))
  }
}

function assertShape(item, expected) {
  const actual = Object.fromEntries(
    Object.keys(expected).map((key) => [key, item[key]]),
  )
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      item.label + ' 图形结构不符：' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected),
    )
  }
}

function assertSvgText(item, expectedTexts) {
  const missing = expectedTexts.filter((text) => !item.text.includes(text))
  if (missing.length > 0) {
    throw new Error(item.label + ' 缺少文字：' + missing.join('、') + '\n实际文字：\n' + item.text)
  }
  const leaks = BUILT_IN_LEAKS.filter((text) => item.text.includes(text))
  if (leaks.length > 0) {
    throw new Error(item.label + ' 出现内置实验文字：' + leaks.join('、'))
  }
}

async function importProgram(page, program, file, mobile = false) {
  if (mobile) {
    const menu = await openCompactFileMenu(page)
    await menu.getByRole('menuitem', { name: '导入工程文件', exact: true }).click()
  } else {
    await page.getByRole('button', { name: '导入工程文件', exact: true }).click()
  }

  const dialog = page.getByRole('dialog', { name: '导入工程' })
  await dialog.waitFor({ state: 'visible', timeout: 15000 })
  await dialog.locator('input[type="file"]').setInputFiles(file)
  await dialog.getByRole('button', { name: '导入并打开', exact: true }).waitFor({ timeout: 15000 })
  await dialog.getByText(program.name, { exact: true }).waitFor({ timeout: 15000 })
  await dialog.getByRole('button', { name: '导入并打开', exact: true }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 15000 })
  await page.locator('#project-name').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForFunction(
    (name) => document.querySelector('#project-name')?.value === name,
    program.name,
    { timeout: 15000 },
  )
  await page.locator('.ll-diagram').first().waitFor({ state: 'visible', timeout: 15000 })
}

async function openCompactFileMenu(page) {
  const menu = page.locator('#topbar-file-menu')
  if (!(await menu.isVisible().catch(() => false))) {
    await page.locator('.wb-file-compact').click()
    await menu.waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(250)
  }
  return menu
}

async function inspectCompactMenu(page, menu) {
  await page.waitForTimeout(250)
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('触屏页面没有视口尺寸')
  const menuBox = await menu.boundingBox()
  if (!menuBox || menuBox.x < -0.5 || menuBox.x + menuBox.width > viewport.width + 0.5) {
    throw new Error('手机文件菜单横向越界：' + JSON.stringify(menuBox))
  }

  const items = menu.getByRole('menuitem')
  const count = await items.count()
  const measured = []
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index)
    await item.scrollIntoViewIfNeeded()
    const box = await item.boundingBox()
    if (!box) throw new Error('手机菜单第 ' + index + ' 项没有布局框')
    if (box.height < 43.5) {
      throw new Error('手机菜单项低于 44px：' + (await item.innerText()) + ' = ' + box.height)
    }
    const probe = await item.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const hit = document.elementFromPoint(x, y)
      return {
        label: (node.textContent ?? '').trim(),
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        height: rect.height,
        hitSelf: node === hit || node.contains(hit),
      }
    })
    if (
      probe.left < -0.5
      || probe.right > viewport.width + 0.5
      || probe.top < -0.5
      || probe.bottom > viewport.height + 0.5
    ) {
      throw new Error('手机菜单项越界：' + JSON.stringify(probe))
    }
    if (!probe.hitSelf) throw new Error('手机菜单项被遮挡：' + probe.label)
    measured.push({ label: probe.label, height: Number(probe.height.toFixed(2)) })
  }
  return measured
}

async function waitForSfcToast(page, steps) {
  const expected = steps === null
    ? null
    : '已导出顺序功能图 SVG（' + steps + ' 步）'
  const handle = await page.waitForFunction(
    (wanted) => {
      const messages = [...document.querySelectorAll('[role="status"] .toast-message')]
        .map((node) => node.textContent?.trim() ?? '')
      if (wanted !== null) return messages.includes(wanted) ? wanted : false
      return messages.find((text) => /^已导出顺序功能图 SVG（\d+ 步）$/.test(text)) ?? false
    },
    expected,
    { timeout: 15000 },
  )
  const message = await handle.jsonValue()
  const toastSteps = Number(/（(\d+) 步）/.exec(message)?.[1])
  if (!Number.isInteger(toastSteps)) throw new Error('导出提示缺少有效步数：' + message)
  if (steps !== null && toastSteps !== steps) {
    throw new Error('导出提示步数不符：' + message + '，期望 ' + steps)
  }
  return { message, steps: toastSteps }
}

async function downloadSfcSvg(page, mobile, filename, steps) {
  let menu
  if (mobile) {
    menu = await openCompactFileMenu(page)
  } else {
    await page.locator('.wb-export-trigger').click()
    menu = page.locator('#topbar-export-menu')
    await menu.waitFor({ state: 'visible', timeout: 10000 })
  }
  const item = menu.getByRole('menuitem', { name: '顺序功能图 SVG', exact: true })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    item.click(),
  ])
  if (await download.failure()) {
    throw new Error('顺序功能图 SVG 下载失败：' + (await download.failure()))
  }
  const file = path.join(OUT, filename)
  await download.saveAs(file)
  const toast = await waitForSfcToast(page, steps)
  const text = await readFile(file, 'utf8')
  const inspected = inspectSvg(text, '顺序功能图 SVG（' + filename + '）', file)
  assertCleanSvg(inspected)
  await assertParsedSvg(page, inspected, text)
  if (toast.steps !== inspected.steps) {
    throw new Error('导出提示步数与 SVG 步骤框不符：' + toast.steps + ' != ' + inspected.steps)
  }
  return {
    ...inspected,
    suggestedFilename: download.suggestedFilename(),
    toast: toast.message,
    toastSteps: toast.steps,
    hash: createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16),
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

async function main() {
  await mkdir(OUT, { recursive: true })
  const stateFile = path.join(JSON_DIR, 'qa-custom-state.json')
  const combinedFile = path.join(JSON_DIR, 'qa-custom-combined.json')
  await writeFile(stateFile, JSON.stringify(STATE_PROGRAM, null, 2), 'utf8')
  await writeFile(combinedFile, JSON.stringify(COMBINED_PROGRAM, null, 2), 'utf8')

  const server = startPreview()
  let browser
  const report = {
    output: OUT,
    exports: [],
    hashes: {},
    mobileMenu: [],
    checks: {},
  }
  try {
    await waitForServer(APP)
    browser = await chromium.launch({ channel: 'msedge', headless: true })

    const desktopPage = await browser.newPage({
      acceptDownloads: true,
      viewport: { width: 1440, height: 960 },
    })
    await openHome(desktopPage)
    await importProgram(desktopPage, STATE_PROGRAM, stateFile)

    const desktopState = await downloadSfcSvg(desktopPage, false, 'custom-state-desktop.svg', 3)
    assertShape(desktopState, {
      steps: 3,
      directTransitions: 2,
      backJumps: 1,
      arrows: 1,
      edges: 3,
    })
    assertSvgText(desktopState, [
      'StateA',
      'StateB',
      'LampA',
      'LampB',
      'Q0.0=1',
      'Q0.1=1',
      'Start↑',
      'Next↑',
      'Stop',
    ])
    report.exports.push(desktopState)
    report.hashes.stateDesktop = desktopState.hash

    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 3,
      hasTouch: true,
      acceptDownloads: true,
    })
    try {
      const mobilePage = await mobileContext.newPage()
      await openHome(mobilePage)
      const compactMenu = await openCompactFileMenu(mobilePage)
      report.mobileMenu = await inspectCompactMenu(mobilePage, compactMenu)
      await importProgram(mobilePage, STATE_PROGRAM, stateFile, true)

      const mobileState = await downloadSfcSvg(mobilePage, true, 'custom-state-mobile.svg', 3)
      assertShape(mobileState, {
        steps: 3,
        directTransitions: 2,
        backJumps: 1,
        arrows: 1,
        edges: 3,
      })
      assertSvgText(mobileState, [
        'StateA',
        'StateB',
        'LampA',
        'LampB',
        'Q0.0=1',
        'Q0.1=1',
        'Start↑',
        'Next↑',
        'Stop',
      ])
      if (mobileState.hash !== desktopState.hash) {
        throw new Error(
          '桌面与手机导出的状态工程 SVG 不一致：'
          + desktopState.hash + ' != ' + mobileState.hash,
        )
      }
      report.exports.push(mobileState)
      report.hashes.stateMobile = mobileState.hash
      report.checks.desktopMobileHashEqual = true
    } finally {
      await mobileContext.close()
    }

    await importProgram(desktopPage, COMBINED_PROGRAM, combinedFile)
    const combined = await downloadSfcSvg(desktopPage, false, 'custom-combined.svg', 1)
    assertShape(combined, {
      steps: 1,
      directTransitions: 0,
      backJumps: 0,
      arrows: 0,
      edges: 0,
    })
    assertSvgText(combined, ['组合逻辑', 'Start', 'Mode', 'Out', 'Q0.0=1'])
    report.exports.push(combined)
    report.hashes.combined = combined.hash

    for (const [label, key] of BUILT_IN_LABS) {
      await loadLab(desktopPage, label)
      const exported = await downloadSfcSvg(desktopPage, false, 'builtin-' + key + '.svg', null)
      if (exported.steps < 1) throw new Error(label + ' 没有导出任何步骤')
      report.exports.push(exported)
      report.hashes[key] = exported.hash
    }

    const hashes = [
      desktopState.hash,
      combined.hash,
      ...BUILT_IN_LABS.map(([, key]) => report.hashes[key]),
    ]
    if (new Set(hashes).size !== hashes.length) {
      throw new Error('自定义工程与内置实验的顺序功能图哈希不是一一对应：' + JSON.stringify(report.hashes))
    }
    report.checks.allHashesUnique = true

    await desktopPage.close()
  } finally {
    await browser?.close()
    server.kill()
    server.stdout?.destroy()
    server.stderr?.destroy()
    await rm(JSON_DIR, { recursive: true, force: true })
  }

  console.log(JSON.stringify(report, null, 2))
  setTimeout(() => process.exit(0), 5000).unref()
}

main().catch((reason) => {
  console.error(reason)
  process.exitCode = 1
})
