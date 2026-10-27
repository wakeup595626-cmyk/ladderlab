/**
 * 本轮交互回归：并联支路继续分支、全界面任意留白取消选中、全宽画布、边沿标记间距、右侧母线。
 * 先启动 preview（4173）与带 CDP 的浏览器（9222），再运行本脚本。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? 'http://127.0.0.1:9222'
const APP_URL = process.env.LADDERLAB_URL ?? 'http://127.0.0.1:4173/'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

await mkdir(resolve('docs/qa'), { recursive: true })

const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target) throw new Error(`没有可调试页面：${CDP_HTTP}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((open, fail) => {
  socket.addEventListener('open', open, { once: true })
  socket.addEventListener('error', fail, { once: true })
})

let nextId = 0
const pending = new Map()
const errors = []

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((ok, no) => {
    pending.set(id, { ok, no })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.no(new Error(message.error.message))
    else request.ok(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    if (JSON.stringify(details).includes('chrome-extension://')) return
    errors.push(details?.exception?.description ?? details?.text ?? 'exception')
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '))
  }
})

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function screenshot(path) {
  await evaluate(
    `document.querySelectorAll('plasmo-csui, #dx-sibebar-container').forEach((node) => node.remove())`,
  ).catch(() => {})
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

async function waitForApp(timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = await evaluate(
      `document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')`,
    ).catch(() => false)
    if (ready) return true
    await sleep(200)
  }
  throw new Error(`等待页面就绪超时：${APP_URL}`)
}

async function reloadDemo() {
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(320)
  await send('Storage.clearDataForOrigin', {
    origin: new URL(APP_URL).origin,
    storageTypes: 'local_storage',
  })
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  await sleep(350)
  const viaCoach = await evaluate(`(() => {
    const button = document.querySelector('.wb-coach-demo')
    if (!button) return false
    button.click(); return true
  })()`)
  if (!viaCoach) {
    await evaluate(`document.querySelector('.wb-more summary')?.click()`)
    await sleep(200)
    await evaluate(`[...document.querySelectorAll('.wb-more-menu button')]
      .find((button) => button.textContent?.includes('三步上手'))?.click()`)
    await sleep(300)
    await evaluate(`document.querySelector('.guide-primary')?.click()`)
  }
  await sleep(700)
}

async function clickPlus(chain, index) {
  return evaluate(`(() => {
    const slot = document.querySelector('.ll-slot[data-chain="${chain}"][data-index="${index}"]')
    const plus = slot?.querySelector('.ll-slot-plus')
    if (!plus) return false
    plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })()`)
}

async function pickBranch() {
  const state = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.ll-slot-menu-item[role="menuitem"]')]
      .find((button) => button.textContent?.includes('加入并联分支'))
    return { found: !!item, enabled: !!item && !item.disabled }
  })()`)
  if (state.enabled) {
    await evaluate(`[...document.querySelectorAll('.ll-slot-menu-item[role="menuitem"]')]
      .find((button) => button.textContent?.includes('加入并联分支'))?.click()`)
  }
  await sleep(520)
  return state
}

async function closeDraft() {
  await evaluate(`document.querySelector('.ll-merge-chip')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(300)
  await evaluate(`document.querySelector('.ll-slot.is-merge-candidate .ll-slot-plus')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(520)
}

async function undo() {
  await evaluate(`document.querySelector('.wb-history-actions [aria-label="撤销上一步"]')?.click()`)
  await sleep(450)
}

async function branchChains() {
  return evaluate(`[...new Set([...document.querySelectorAll('.ll-slot[data-chain]')]
    .map((slot) => slot.getAttribute('data-chain'))
    .filter((chain) => chain && chain.split('.').length === 2))].sort()`)
}

async function maxSlotIndex(chain) {
  return evaluate(`Math.max(...[...document.querySelectorAll('.ll-slot[data-chain="${chain}"]')]
    .map((slot) => Number(slot.getAttribute('data-index'))))`)
}

const checks = {}
const details = {}
const check = (name, value, note) => {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 })
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'pointer', value: 'fine' }, { name: 'any-pointer', value: 'fine' }],
})

await reloadDemo()

// Match TIA: the NC slash stays between the bars, and power is shown in the header only.
const startVisualDemo = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.tag-card')]
    .find((item) => item.querySelector('input')?.value === 'StartBtn')
  const button = card?.querySelector('.live-value')
  if (!button) return false
  button.click()
  return true
})()`)
await sleep(600)
const tiaVisuals = await evaluate(`(() => {
  const box = (element) => {
    const value = element.getBBox()
    return { left: value.x, right: value.x + value.width, width: value.width, height: value.height }
  }
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--text)'
  document.body.append(probe)
  const textColor = getComputedStyle(probe).color
  probe.style.color = 'var(--positive)'
  const positiveColor = getComputedStyle(probe).color
  probe.remove()
  const contacts = [...document.querySelectorAll('.ll-contact')]
    .filter((contact) => contact.querySelector('.ll-contact-slash'))
    .map((contact) => ({
      bars: [...contact.querySelectorAll('.ll-contact-bar')].map(box),
      slash: box(contact.querySelector('.ll-contact-slash')),
    }))
  const graphicSelector = ['.ll-wire', '.ll-power-wire', '.ll-contact-bar',
    '.ll-contact-slash', '.ll-coil-arc', '.ll-rail', '.ll-terminal'].join(',')
  const strokes = [...document.querySelectorAll('.ll-diagram ' + graphicSelector)]
    .map((element) => getComputedStyle(element).stroke)
  const coilMarks = [...document.querySelectorAll('.ll-diagram .ll-coil-mark')]
    .map((element) => getComputedStyle(element).fill)
  return {
    textColor, positiveColor,
    powered: document.querySelectorAll('.ll-rung.is-powered').length,
    contacts,
    offColorStrokes: strokes.filter((stroke) => stroke !== textColor),
    greenCoilMarks: coilMarks.filter((fill) => fill === positiveColor),
  }
})()`)
const ncInsideBars = tiaVisuals.contacts.length > 0
  && tiaVisuals.contacts.every((contact) => (
    contact.bars.length === 2
    && contact.slash.left >= contact.bars[0].left - 0.1
    && contact.slash.right <= contact.bars[1].left + 0.1
  ))
check('visual/start-and-power-state', startVisualDemo && tiaVisuals.powered > 0, tiaVisuals)
check('visual/nc-slash-stays-between-bars', ncInsideBars, tiaVisuals.contacts)
check('visual/ladder-graphics-stay-black-while-powered',
  tiaVisuals.offColorStrokes.length === 0 && tiaVisuals.greenCoilMarks.length === 0, tiaVisuals)

await clickPlus('', 1)
await sleep(300)
const branchFromMain = await pickBranch()
await closeDraft()

const initialChains = await branchChains()
const secondBranch = initialChains.at(-1)
const rails = await evaluate(`(() => ({
  count: document.querySelectorAll('.ll-rail').length,
  rightRail: [...document.querySelectorAll('.ll-rail')].filter((rail) => {
    const diagram = rail.closest('.ll-diagram')
    if (!diagram) return false
    return rail.getBoundingClientRect().left > diagram.getBoundingClientRect().left + diagram.getBoundingClientRect().width * 0.75
  }).length,
  diagramRight: Math.round(document.querySelector('.ll-diagram')?.getBoundingClientRect().right ?? 0),
  outputRight: Math.round(document.querySelector('.ll-output')?.getBoundingClientRect().right ?? 0),
}))()`)
check('branch/from-main-draft', branchFromMain.enabled && initialChains.length >= 2, {
  branchFromMain,
  initialChains,
})
check('rail/only-left-power-rail', rails.count === 1 && rails.rightRail === 0, rails)

const coils = await evaluate(`(() => {
  const box = (element) => {
    if (!element) return null
    const value = element.getBBox()
    return {
      left: value.x,
      right: value.x + value.width,
      top: value.y,
      bottom: value.y + value.height,
      width: value.width,
      height: value.height,
    }
  }
  return [...document.querySelectorAll('.ll-output.ll-coil')].map((coil) => {
    const hit = coil.querySelector('.ll-node-hit')
    const hitBox = hit?.getBBox()
    return {
      leads: [...coil.querySelectorAll('path.ll-wire')].map(box),
      arcs: [...coil.querySelectorAll('path.ll-coil-arc')].map(box),
      terminal: box(coil.querySelector('line.ll-coil-terminal')),
      outputRight: hitBox ? hitBox.x + hitBox.width + 2 : null,
    }
  })
})()`)
const coilLeadsClear = coils.length > 0 && coils.every((coil) => (
  coil.leads.length === 2
  && coil.arcs.length === 2
  && coil.leads[0].right <= coil.arcs[0].left + 0.1
  && coil.leads[1].left >= coil.arcs[1].right - 0.1
))
const coilTerminalAtEnd = coils.length > 0 && coils.every((coil) => (
  coil.terminal
  && Math.abs(coil.terminal.left - coil.outputRight) < 0.1
  && coil.terminal.width === 0
  && Math.abs(coil.terminal.height - 18) < 0.1
))
check('coil/no-horizontal-line-inside-brackets', coilLeadsClear, coils)
check('coil/right-terminal-18px-at-output-end', coilTerminalAtEnd, coils)

// 第二条支路起点继续创建嵌套草稿分支。
await clickPlus(secondBranch, 0)
await sleep(300)
const nestedMenu = await pickBranch()
const nestedState = await evaluate(`({
  open: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  chips: document.querySelectorAll('.ll-merge-chip').length,
  selected: document.querySelectorAll('.ll-node.is-selected').length,
})`)
check('branch/second-branch-can-open-nested', nestedMenu.enabled && nestedState.open >= 1
  && nestedState.chips >= 1 && nestedState.selected === 1, { nestedMenu, nestedState })
await undo()

// 第二条支路末尾直接追加第三条支路，再从第三条末尾追加第四条。
let chains = await branchChains()
const secondEnd = await maxSlotIndex(secondBranch)
await clickPlus(secondBranch, secondEnd)
await sleep(300)
await screenshot('docs/qa/desktop-branch-from-branch.png')
const siblingMenu = await pickBranch()
const afterSibling = await evaluate(`({
  chips: document.querySelectorAll('.ll-merge-chip').length,
  selectedLabel: document.querySelector('.ll-node.is-selected')?.getAttribute('aria-label') ?? null,
})`)
chains = await branchChains()
const thirdBranch = chains.find((chain) => !initialChains.includes(chain))
check('branch/second-branch-adds-third', siblingMenu.enabled && afterSibling.chips === 0
  && Boolean(thirdBranch), { secondEnd, siblingMenu, afterSibling, chains, thirdBranch })

const thirdEnd = await maxSlotIndex(thirdBranch)
await clickPlus(thirdBranch, thirdEnd)
await sleep(300)
const thirdMenu = await pickBranch()
chains = await branchChains()
check('branch/third-branch-adds-fourth', thirdMenu.enabled
  && chains.length === initialChains.length + 2, {
  thirdEnd,
  thirdMenu,
  initialChains,
  chains,
})
await undo()
await undo()

// 点击元件或线路后，再点画布容器空白处必须取消全部选中并收起参数框。
await evaluate(`document.querySelector('.ll-node.ll-contact[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(360)
const beforeBlank = await evaluate(`({
  selected: document.querySelectorAll('.ll-node.is-selected').length,
  editor: !!document.querySelector('.qe-panel'),
})`)
await evaluate(`document.querySelector('.ll-canvas')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(260)
const afterBlank = await evaluate(`({
  selected: document.querySelectorAll('.ll-node.is-selected').length,
  wires: document.querySelectorAll('.ll-slot.is-wire-selected').length,
  editor: !!document.querySelector('.qe-panel'),
})`)
check('selection/blank-clears-node', beforeBlank.selected >= 1 && beforeBlank.editor
  && afterBlank.selected === 0 && afterBlank.wires === 0 && !afterBlank.editor,
  { beforeBlank, afterBlank })

await evaluate(`(() => {
  const wire = document.querySelector('.ll-slot[data-chain=""][data-index="1"] .ll-slot-wire')
  if (!wire) return false
  wire.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await sleep(240)
const wireBeforeBlank = await evaluate(`document.querySelectorAll('.ll-slot.is-wire-selected').length`)
await evaluate(`document.querySelector('.ll-canvas')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(240)
const wireAfterBlank = await evaluate(`document.querySelectorAll('.ll-slot.is-wire-selected').length`)
check('selection/blank-clears-wire', wireBeforeBlank === 1 && wireAfterBlank === 0, {
  wireBeforeBlank,
  wireAfterBlank,
})

// 图纸之外、甚至程序区之外的界面留白也必须清除选中。
await evaluate(`document.querySelector('.ll-node.ll-contact[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
const beforeGutterClear = await evaluate(`({
  selected: document.querySelectorAll('.ll-node.is-selected').length,
  editor: !!document.querySelector('.qe-panel'),
})`)
await evaluate(`document.querySelector('.wb-documentbar')
  ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`)
await sleep(240)
const afterHeaderClear = await evaluate(`({
  selected: document.querySelectorAll('.ll-node.is-selected').length,
  wires: document.querySelectorAll('.ll-slot.is-wire-selected').length,
  editor: !!document.querySelector('.qe-panel'),
})`)
check('selection/any-blank-clears-node', beforeGutterClear.selected >= 1
  && beforeGutterClear.editor && afterHeaderClear.selected === 0
  && afterHeaderClear.wires === 0 && !afterHeaderClear.editor, {
  beforeGutterClear,
  afterHeaderClear,
})

// 程序区四周的留白也不能保留整块画布的选中状态。
await evaluate(`document.querySelector('.ll-node.ll-contact[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
await evaluate(`document.querySelector('.wb-program-pane')
  ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`)
await sleep(240)
const paneGeometry = await evaluate(`(() => {
  const pane = document.querySelector('.wb-program-pane')
  const sheet = document.querySelector('.ll-program-sheet')
  if (!pane || !sheet) return { present: false }
  const paneRect = pane.getBoundingClientRect()
  const sheetRect = sheet.getBoundingClientRect()
  const style = getComputedStyle(pane)
  return {
    present: true,
    selected: document.querySelectorAll('.ll-node.is-selected').length,
    wires: document.querySelectorAll('.ll-slot.is-wire-selected').length,
    editor: !!document.querySelector('.qe-panel'),
    paneWidth: Math.round(paneRect.width),
    sheetWidth: Math.round(sheetRect.width),
    leftGap: Math.round(sheetRect.left - paneRect.left),
    rightGap: Math.round(paneRect.right - sheetRect.right),
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
  }
})()`)
check('selection/program-gutter-clears-node', paneGeometry.selected === 0
  && paneGeometry.wires === 0 && !paneGeometry.editor, {
  paneGeometry,
})
check('layout/program-sheet-default-width', paneGeometry.present
  && paneGeometry.sheetWidth === 1360
  && paneGeometry.leftGap >= 24 && paneGeometry.rightGap >= 24
  && Math.abs(paneGeometry.leftGap - paneGeometry.rightGap) <= 2, paneGeometry)

// P/N 标记位于两根触点竖线之间、变量名下方，不能贴字。
await evaluate(`document.querySelector('.ll-node.ll-contact[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(350)
await evaluate(`[...document.querySelectorAll('.qe-segments button')]
  .find((button) => button.textContent?.trim() === '上升沿')?.click()`)
await sleep(420)
const edgeGeometry = await evaluate(`(() => {
  const node = document.querySelector('.ll-node.ll-contact:has(.ll-edge-mark)')
  if (!node) return { found: false }
  const mark = node.querySelector('.ll-edge-mark').getBoundingClientRect()
  const bars = [...node.querySelectorAll('.ll-contact-bar')].map((bar) => bar.getBoundingClientRect())
  const name = node.querySelector('.ll-node-name')?.getBoundingClientRect()
  if (bars.length < 2 || !name) return { found: false, bars: bars.length }
  return {
    found: true,
    mark: { left: mark.left, right: mark.right, top: mark.top, bottom: mark.bottom },
    betweenBars: mark.left >= bars[0].right - 1 && mark.right <= bars[1].left + 1,
    belowName: mark.top >= name.bottom + 1,
    nameGap: Math.round((mark.top - name.bottom) * 10) / 10,
  }
})()`)
check('edge-mark/clear-of-name-and-between-bars', edgeGeometry.found
  && edgeGeometry.betweenBars && edgeGeometry.belowName && edgeGeometry.nameGap >= 3,
  edgeGeometry)
await screenshot('docs/qa/desktop-edge-mark.png')

// 手机尺寸复核同一批关键控件不溢出。
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
})
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }],
})
await reloadDemo()
const mobile = await evaluate(`(() => {
  const canvas = document.querySelector('.ll-canvas')
  const rung = document.querySelector('.ll-rung')
  if (!canvas || !rung) return { present: false }
  const rect = rung.getBoundingClientRect()
  return {
    present: true,
    railCount: document.querySelectorAll('.ll-rail').length,
    fits: rect.left >= -1 && rect.right <= innerWidth + 1,
    bodyOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
  }
})()`)
check('mobile/branch-details-fit', mobile.present && mobile.railCount === 1
  && mobile.fits && mobile.bodyOverflow, mobile)
await screenshot('docs/qa/mobile-branch-details.png')

socket.close()
console.log(JSON.stringify({ checks, details, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || errors.length > 0) process.exitCode = 1
