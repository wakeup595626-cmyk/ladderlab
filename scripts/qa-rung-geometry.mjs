#!/usr/bin/env node
/**
 * 程序段几何验收：元件纵向基准、串联 / 并联节距、混排宽度。
 *
 * 用法：先起开发或预览服务，再跑脚本。
 *   LADDERLAB_URL=http://127.0.0.1:5199/ node scripts/qa-rung-geometry.mjs
 * stdout 只输出一个 JSON 对象；人读摘要走 stderr。任一几何断言失败时退出码为 1。
 */
import { chromium } from '@playwright/test'

const APP_URL = process.env.LADDERLAB_URL ?? 'http://127.0.0.1:5199/'
const PITCH_TOLERANCE = 1
const SHOT_DIR = process.env.LADDERLAB_SHOT_DIR ?? ''

const tag = (name, address, comment) => ({ id: name + '-tag', name, address, kind: 'BOOL', initial: false, comment })
// 整个工程要求元件 ID 全局唯一：同一变量会在多个程序段里复用，ID 必须带序号。
let partId = 0
const nextPartId = (prefix, name) => `${prefix}-${name}-${++partId}`
const no = (name) => ({ type: 'contact', id: nextPartId('c', name), kind: 'NO', tag: name })
const nc = (name) => ({ type: 'contact', id: nextPartId('n', name), kind: 'NC', tag: name })
const cmp = (name) => ({
  type: 'contact',
  id: nextPartId('m', name),
  kind: 'CMP',
  tag: name,
  compare: { op: '>', value: 3 },
})
const coil = (name, kind = 'COIL') => ({ id: nextPartId('o', name), kind, tag: name })
const rung = (id, nodes, output) => ({ id, label: id, nodes, output })

const PROGRAM = {
  schema: 1,
  name: '几何验收',
  profile: 'v14',
  tags: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'T1', 'T2', 'T3', 'N1', 'N2', 'N3', 'N4', 'N5', 'Start', 'Lane1', 'Lane2', 'Lane3', 'Lane4', 'Lane5', 'Lane6', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7']
    .map((name, index) => tag(name, `%M${index}.0`, name)),
  rungs: [
    rung('r1', [no('A'), no('B')], coil('Q1')),
    rung('r2', [no('C')], coil('Q4', 'TON')),
    rung('r3', [no('D'), no('E')], coil('Q2')),
    rung('r4', [no('F'), { type: 'parallel', id: 'p1', branches: [[no('G')], [nc('H')]] }], coil('Q3')),
    rung('r5', [{
      type: 'parallel',
      id: 'p-wide',
      branches: [
        [no('Start'), no('Lane5')],
        [no('Lane1'), no('Lane4'), no('Lane6')],
        [no('Lane2')],
        [no('Lane3')],
      ],
    }], coil('Q5')),
    rung('r6', [no('T1'), cmp('T2'), nc('T3')], coil('Q6')),
    rung('r7', [{
      type: 'parallel',
      id: 'p-nested',
      branches: [
        [no('N1'), no('N2')],
        [{ type: 'parallel', id: 'p-inner', branches: [[no('N3')], [nc('N4')]] }],
        [no('N5')],
      ],
    }], coil('Q7')),
    rung('r8', [{
      type: 'parallel',
      id: 'p-six',
      branches: [
        [no('Lane1')],
        [no('Lane2')],
        [no('Lane3')],
        [no('Lane4')],
        [no('Lane5')],
        [no('Lane6')],
      ],
    }], coil('Q1')),
    rung('r9', [no('A'), no('B')], coil('Q2')),
  ],
}

function record(program) {
  const savedAt = Date.now()
  return {
    schema: 2,
    id: 'geometry-project',
    createdAt: savedAt,
    savedAt,
    revision: String(savedAt),
    program,
  }
}

function stats(values) {
  const gaps = values.slice(1).map((value, index) => value - values[index])
  return {
    values: values.map((value) => Math.round(value * 10) / 10),
    gaps: gaps.map((gap) => Math.round(gap * 10) / 10),
    spread: gaps.length ? Math.round(Math.max(...gaps) - Math.min(...gaps)) : 0,
  }
}

const MEASURE = String.raw`(() => {
  const round = (value) => Math.round(value * 10) / 10
  return Array.from(document.querySelectorAll('.ll-rung[data-rung-id]')).map((article) => {
    const rungId = article.dataset.rungId
    const rect = article.getBoundingClientRect()
    const svg = article.querySelector('svg.ll-diagram')
    const svgTop = svg ? svg.getBoundingClientRect().top : rect.top
    const lineOf = (element) => {
      const wire = element && element.querySelector('.ll-wire-in, .ll-wire')
      if (!wire) return null
      const box = wire.getBoundingClientRect()
      return round(box.top + box.height / 2 - svgTop)
    }
    const contacts = Array.from(article.querySelectorAll('.ll-contact')).map((node) => {
      const box = node.getBoundingClientRect()
      const hit = node.querySelector('.ll-node-hit')
      const bar = node.querySelector('.ll-contact-bar')
      const selection = node.querySelector('.ll-selection-box')
      return {
        id: node.dataset.nodeId,
        path: node.dataset.nodePath,
        left: round(box.left),
        right: round(box.right),
        centerX: round(box.left + box.width / 2),
        centerY: round(box.top + box.height / 2 - svgTop),
        lineY: lineOf(node),
        width: round(box.width),
        height: round(box.height),
        hitHeight: hit ? round(hit.getBoundingClientRect().height) : null,
        selectionHeight: selection ? round(selection.getBoundingClientRect().height) : null,
        barHeight: bar ? round(bar.getBoundingClientRect().height) : null,
      }
    })
    const output = article.querySelector('[data-output-id]')
    const outputBox = output ? output.getBoundingClientRect() : null
    const viewBox = svg ? svg.viewBox.baseVal : null
    return {
      rungId,
      articleTop: round(rect.top),
      svgTop: round(svgTop),
      svgHeight: svg ? round(svg.getBoundingClientRect().height) : null,
      svgWidth: svg ? round(svg.getBoundingClientRect().width) : null,
      viewBoxWidth: viewBox ? round(viewBox.width) : null,
      viewBoxHeight: viewBox ? round(viewBox.height) : null,
      wirePageY: (() => {
        const wire = (article.querySelector('.ll-contact') ?? output)?.querySelector('.ll-wire-in, .ll-wire')
        if (!wire) return null
        const box = wire.getBoundingClientRect()
        return round(box.top + box.height / 2)
      })(),
      contacts,
      outputCenterY: outputBox ? round(outputBox.top + outputBox.height / 2 - svgTop) : null,
      outputLineY: lineOf(output),
    }
  })
})()`

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
await context.addInitScript((payload) => {
  window.localStorage.setItem('ladderlab.library.v2.ready', JSON.stringify({ schema: 2 }))
  window.localStorage.setItem('ladderlab.library.v2.project.geometry-project', JSON.stringify(payload))
  window.sessionStorage.setItem('ladderlab.library.v1.active', 'geometry-project')
}, record(PROGRAM))
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error?.message ?? error)))
await page.goto(APP_URL, { waitUntil: 'load' })
await page.waitForSelector('.ll-rung[data-rung-id="r1"] .ll-contact')
await page.waitForTimeout(600)

const rungs = await page.evaluate(MEASURE)
if (SHOT_DIR) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(SHOT_DIR, { recursive: true })
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r8', 'r9']) {
    await page.locator(`.ll-rung[data-rung-id="${id}"]`).screenshot({ path: `${SHOT_DIR}/${id}.png` })
  }
}
await browser.close()

const byId = Object.fromEntries(rungs.map((item) => [item.rungId, item]))
const checks = []
const check = (id, ok, detail, data) => checks.push({ id, ok, detail, ...(data === undefined ? {} : { data }) })

const mainLineYs = rungs
  .map((item) => item.contacts[0]?.lineY ?? item.outputLineY)
  .filter(Number.isFinite)
check(
  'aligned-line',
  Math.max(...mainLineYs) - Math.min(...mainLineYs) <= PITCH_TOLERANCE,
  '各程序段主线路元件的纵向中心应在同一高度',
  { mainLineYs },
)

const scales = rungs
  .filter((item) => item.svgWidth !== null && item.viewBoxWidth)
  .map((item) => item.svgWidth / item.viewBoxWidth)
check(
  'canvas-scale-one',
  scales.length === rungs.length && scales.every((scale) => Math.abs(scale - 1) <= 0.01),
  'SVG 必须 1:1 绘制，不允许任何整体缩放',
  { scales: scales.map((scale) => Math.round(scale * 1000) / 1000) },
)

const allContacts = rungs.flatMap((item) => item.contacts)
const uniqueSizes = (values) => [...new Set(values.map((value) => Math.round(value * 10) / 10))]
const barHeights = uniqueSizes(allContacts.map((item) => item.barHeight).filter(Number.isFinite))
const hitHeights = uniqueSizes(allContacts.map((item) => item.hitHeight).filter(Number.isFinite))
check(
  'contact-art-uniform',
  barHeights.length === 1,
  '所有程序段的触点图形高度必须完全一致，支路再多也不能缩小',
  { barHeights },
)
check(
  'contact-hit-uniform',
  hitHeights.length === 1,
  '所有程序段的触点命中框 / 选中框高度必须完全一致',
  { hitHeights },
)

const seriesGaps = byId.r6.contacts
  .map((item, index, list) => (index ? item.centerX - list[index - 1].centerX : null))
  .filter((value) => value !== null)
check(
  'series-pitch',
  seriesGaps.every((gap) => Math.abs(gap - seriesGaps[0]) <= PITCH_TOLERANCE),
  '常开、比较、常闭混排时仍应使用同一串联节距',
  { seriesGaps },
)

const parallel = byId.r4.contacts
const parallelBranchYs = [parallel[1]?.centerY, parallel[2]?.centerY]
const parallelPitch = Math.abs(parallelBranchYs[0] - parallelBranchYs[1])
check('parallel-row', parallelBranchYs.every(Number.isFinite), '并联支路应各自成行且共用同一 X 起点', {
  parallelBranchYs,
  parallelPitch,
  parallelLefts: [parallel[1]?.left, parallel[2]?.left],
})

const parallelBranches = new Map()
for (const contact of byId.r5.contacts) {
  const parts = contact.path.split('.').map(Number)
  const key = parts.slice(0, 2).join('.')
  if (!parallelBranches.has(key)) parallelBranches.set(key, [])
  parallelBranches.get(key).push(contact)
}
const branchLists = [...parallelBranches.values()].map((list) => list.sort((a, b) => {
  const left = Number(a.path.split('.').at(-1))
  const right = Number(b.path.split('.').at(-1))
  return left - right
}))
const parallelGaps = branchLists.flatMap((list) => list
  .slice(1)
  .map((contact, index) => contact.centerX - list[index].centerX))
check(
  'parallel-pitch',
  parallelGaps.length > 0 && parallelGaps.every((gap) => Math.abs(gap - parallelGaps[0]) <= PITCH_TOLERANCE),
  '不同并联支路内的相邻元件应使用同一节距',
  { parallelGaps },
)

const maxParallelColumns = Math.max(...branchLists.map((list) => list.length))
const parallelColumns = Array.from({ length: maxParallelColumns }, (_, column) => (
  branchLists.map((list) => list[column]?.centerX).filter(Number.isFinite)
))
check(
  'parallel-columns',
  parallelColumns.every((centers) => Math.max(...centers) - Math.min(...centers) <= PITCH_TOLERANCE),
  '并联各支路同序号元件应落在同一列',
  { parallelColumns },
)

const sixRowYs = byId.r8.contacts
  .map((contact) => contact.centerY)
  .filter(Number.isFinite)
const sixRowPitch = stats(sixRowYs)
check(
  'six-branch-pitch',
  sixRowYs.length === 6
    && sixRowPitch.gaps.every((gap) => Math.abs(gap - sixRowPitch.gaps[0]) <= PITCH_TOLERANCE)
    && Math.abs(sixRowPitch.gaps[0] - parallelPitch) <= PITCH_TOLERANCE,
  '六条并联支路必须与两条支路使用同一纵向节距，不能因支路多而压缩',
  { sixRowYs, sixGaps: sixRowPitch.gaps, twoBranchPitch: parallelPitch },
)

const nested = byId.r7.contacts
const nestedFirstColumn = [nested[0], nested[2], nested[3], nested[4]]
const nestedFirstColumnLefts = nestedFirstColumn
  .map((contact) => contact?.left)
  .filter(Number.isFinite)
const nestedRowYs = nestedFirstColumn
  .map((contact) => contact?.centerY)
  .filter(Number.isFinite)
check(
  'nested-columns',
  nestedFirstColumnLefts.length === 4
    && Math.max(...nestedFirstColumnLefts) - Math.min(...nestedFirstColumnLefts) <= PITCH_TOLERANCE,
  '只包着一层并联的冗余嵌套应摊平到同一级，首列不能左右缩进',
  { nestedFirstColumnLefts },
)
const nestedSpacing = stats(nestedRowYs)
check(
  'nested-row-pitch',
  nestedRowYs.length === 4
    && nestedSpacing.gaps.length >= 2
    && nestedSpacing.spread <= PITCH_TOLERANCE,
  '嵌套摊平后的所有支路应使用同一纵向节距',
  { nestedRowYs, gaps: nestedSpacing.gaps },
)

const report = {
  url: APP_URL,
  viewport: '1440x900',
  errors,
  checks,
  rungs,
  stats: Object.fromEntries(Object.entries(byId).map(([key, value]) => [key, stats(value.contacts.map((item) => item.centerX))])),
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
for (const item of checks) {
  process.stderr.write(`${item.ok ? 'PASS' : 'FAIL'} ${item.id} — ${item.detail}\n`)
}
if (errors.length || checks.some((item) => !item.ok)) process.exitCode = 1
