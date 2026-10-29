/**
 * 本轮交互回归：并联支路继续分支、全界面任意留白取消选中、全宽画布、边沿标记间距、右侧母线。
 * 先启动 preview（4173）与专用 QA Chromium（9444），再运行本脚本。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_QA_APP_URL, DEFAULT_QA_CDP, selectExactPage } from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

await mkdir(resolve('docs/qa'), { recursive: true })

const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
const target = selectExactPage(targets, APP_URL, CDP_HTTP)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((open, fail) => {
  socket.addEventListener('open', open, { once: true })
  socket.addEventListener('error', fail, { once: true })
})

let nextId = 0
const pending = new Map()
const errors = []

function send(method, params = {}, timeoutMs = 10000) {
  const id = ++nextId
  return new Promise((ok, no) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      no(new Error(`CDP 请求超时（${timeoutMs}ms）：${method}`))
    }, timeoutMs)
    pending.set(id, { ok, no, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
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
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 45000)
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
  const origin = new URL(APP_URL).origin
  await send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' })
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  // 教练浮层的“已关闭”标记和自动恢复的工程都在 localStorage；进页面后再清一次，
  // 保证每次验收都从真正的首次打开状态开始。
  await evaluate(`(() => { localStorage.clear(); sessionStorage.clear(); return true })()`)
  await send('Page.reload', { ignoreCache: false })
  await waitForApp()
  await sleep(400)
  const demoReady = () => evaluate(`document.querySelectorAll('.tag-card').length > 0`)

  const viaCoach = await evaluate(`(() => {
    const button = document.querySelector('.wb-coach-demo')
    if (!button) return false
    button.click(); return true
  })()`)
  if (viaCoach) {
    await sleep(700)
    if (await demoReady()) {
      console.log('QA branch: demo via coach')
      return 'coach'
    }
  }

  // 教练条缺失或已关闭时，走顶栏“更多 → 三步上手 → 开始搭建”的正式入口。
  const viaGuide = await evaluate(`(() => {
    const more = [...document.querySelectorAll('.wb-more button')]
      .find((button) => button.getAttribute('aria-label') === '更多操作')
    if (!more) return false
    more.click()
    const item = [...document.querySelectorAll('.wb-more-menu button')]
      .find((button) => button.textContent?.includes('三步上手'))
    if (!item) return false
    item.click()
    return true
  })()`)
  await sleep(300)
  const started = viaGuide && await evaluate(`(() => {
    const primary = document.querySelector('.guide-primary')
    if (!primary) return false
    primary.click(); return true
  })()`)
  await sleep(800)
  if (started && await demoReady()) {
    console.log('QA branch: demo via guide')
    return 'guide'
  }

  const diagnostics = await evaluate(`({
    coach: Boolean(document.querySelector('.wb-coach-demo')),
    more: Boolean(document.querySelector('.wb-more button')),
    guide: Boolean(document.querySelector('.guide-dialog, .guide-card, .guide-primary')),
    tags: document.querySelectorAll('.tag-card').length,
    rungs: document.querySelectorAll('.ll-rung').length,
  })`)
  throw new Error(`示例载入失败：${JSON.stringify({ viaCoach, viaGuide, started, diagnostics })}`)
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

async function clickAt(point) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  })
  await sleep(35)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
  })
}

/** 用浏览器真实命中测试找空白坐标，避免合成事件绕过实际遮挡关系。 */
async function clickBlankCanvas() {
  const point = await evaluate(`(() => {
    const canvas = document.querySelector('.ll-canvas')
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const blocked = 'button, input, textarea, select, a, summary, [role="button"], '
      + '[role="menu"], [data-node-id], [data-output-id], .ll-slot, '
      + '.ll-merge-chip, .ll-node-grip, [data-drag-handle], .ll-rung-header'
    for (let y = Math.max(8, rect.top + 12); y < Math.min(innerHeight - 8, rect.bottom - 12); y += 18) {
      for (let x = Math.max(8, rect.left + 12); x < Math.min(innerWidth - 8, rect.right - 12); x += 18) {
        const hit = document.elementFromPoint(x, y)
        if (!hit || !canvas.contains(hit) || hit.closest(blocked)) continue
        return { x, y, target: hit.className?.baseVal ?? hit.className ?? hit.tagName }
      }
    }
    return null
  })()`)
  if (!point) throw new Error('找不到画布内的真实空白点击坐标')
  await clickAt(point)
  // 保持指针在点击位置：虚线框的消失必须来自状态清理，不能靠移走鼠标掩盖 hover 回归。
  return point
}

async function clickParallelSelector() {
  const point = await evaluate(`(() => {
    const target = document.querySelector('.ll-parallel-select')
    if (!target) return null
    const rect = target.getBoundingClientRect()
    for (let y = Math.max(8, rect.top + 4); y < Math.min(innerHeight - 8, rect.bottom - 4); y += 10) {
      for (let x = Math.max(8, rect.left + 4); x < Math.min(innerWidth - 8, rect.right - 4); x += 10) {
        const hit = document.elementFromPoint(x, y)
        if (hit && target.contains(hit) && hit.closest('.ll-parallel-select') === target) {
          return { x, y, target: hit.className?.baseVal ?? hit.className ?? hit.tagName }
        }
      }
    }
    return null
  })()`)
  if (!point) throw new Error('找不到并联分支选择层的真实点击坐标')
  await clickAt(point)
  return point
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
// 后台标签页会暂停 requestAnimationFrame 与 CSS 过渡：仿真不扫描、虚线框永远停在
// opacity:0，整段验收就会假失败。连接后先把目标页切到前台。
await send('Page.bringToFront').catch(() => {})
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
console.log('QA branch: demo-ready')

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
// 连续扫描每个周期都会重算能流；给慢机器留出最多 2 秒，但一旦带电就立即取样。
for (let i = 0; i < 10; i += 1) {
  if (await evaluate(`document.querySelectorAll('.ll-rung.is-powered').length > 0`)) break
  await sleep(200)
}
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
    runLabel: document.querySelector('.wb-run-toggle')?.getAttribute('aria-label') ?? null,
    rungCount: document.querySelectorAll('.ll-rung').length,
    tags: [...document.querySelectorAll('.tag-card')]
      .map((card) => card.querySelector('input')?.value ?? ''),
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
console.log('QA branch: visual-state')

await clickPlus('', 1)
await sleep(300)
const branchFromMain = await pickBranch()
await closeDraft()

const initialChains = await branchChains()
const secondBranch = initialChains.at(-1)
const nestedFrameGeometry = await evaluate(`(() => {
  const box = (element) => {
    if (!element) return null
    const value = element.getBBox()
    return {
      left: value.x,
      right: value.x + value.width,
      top: value.y,
      bottom: value.y + value.height,
    }
  }
  return [...document.querySelectorAll('.ll-parallel[data-split-inherited="true"]')].map((parallel) => ({
    nodeId: parallel.getAttribute('data-node-id'),
    frame: box(parallel.querySelector(':scope > .ll-branch-frame')),
    untrimmedFrameHeight: Number(
      parallel.querySelector(':scope > .ll-branch-frame')?.getAttribute('data-frame-untrimmed-height'),
    ),
    entry: box(parallel.querySelector(':scope > [data-parallel-entry]')),
    join: box(parallel.querySelector(':scope > [data-parallel-join]')),
  }))
})()`)
const nestedFramePadding = 7
const trimmedFrameRatio = 2 / 3
const framesTrimmedToTwoThirds = nestedFrameGeometry.length > 0
  && nestedFrameGeometry.every(({ frame, untrimmedFrameHeight }) => (
    frame && Number.isFinite(untrimmedFrameHeight) && untrimmedFrameHeight > 0
    && Math.abs(frame.bottom - frame.top - untrimmedFrameHeight * trimmedFrameRatio) < 0.1
  ))
const nestedFramesContainInheritedWires = nestedFrameGeometry.length > 0
  && nestedFrameGeometry.every(({ frame, entry, join }) => (
    frame && entry && join
    && frame.left <= entry.left - nestedFramePadding
    && frame.right >= join.right + nestedFramePadding
  ))
const rails = await evaluate(`(() => ({
  count: document.querySelectorAll('.ll-rail').length,
  rungCount: document.querySelectorAll('.ll-rung').length,
  countsPerDiagram: [...document.querySelectorAll('.ll-diagram')].map(
    (diagram) => diagram.querySelectorAll('.ll-rail').length,
  ),
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
check('branch/frame-surrounds-inherited-split', nestedFramesContainInheritedWires, {
  nestedFrameGeometry,
  nestedFramePadding,
})
check('branch/frame-trimmed-to-two-thirds', framesTrimmedToTwoThirds, {
  nestedFrameGeometry,
  trimmedFrameRatio,
})
check('rail/only-left-power-rail', rails.rungCount > 0
  && rails.count === rails.rungCount
  && rails.countsPerDiagram.every((count) => count === 1)
  && rails.rightRail === 0, rails)
console.log('QA branch: draft-created')

// 并联虚线框只在选中或键盘聚焦时出现；悬停本身不得显框，点空白后必须消失。
const initialBlankPoint = await clickBlankCanvas()
await sleep(320)
const frameOpacity = (nodeId) => evaluate(`(() => {
  const parallel = ${nodeId
    ? `document.querySelector('.ll-parallel[data-node-id="${nodeId}"]')`
    : `document.querySelector('.ll-parallel.is-selected') ?? document.querySelector('.ll-parallel')`}
  const frame = parallel?.querySelector(':scope > .ll-branch-frame')
  if (!frame) return null
  const style = getComputedStyle(frame)
  return style.opacity
})()`)
const frameDiagnostics = (nodeId) => evaluate(`(() => {
  const matches = [...document.querySelectorAll('.ll-parallel[data-node-id="${nodeId}"]')]
  return matches.map((parallel) => {
    const frame = parallel.querySelector(':scope > .ll-branch-frame')
    return {
      cls: parallel.getAttribute('class'),
      hasFrame: Boolean(frame),
      opacity: frame ? getComputedStyle(frame).opacity : null,
      visible: frame ? getComputedStyle(frame).visibility : null,
      hover: parallel.matches(':hover'),
      selected: parallel.matches('.is-selected'),
      focusVisible: Boolean(parallel.querySelector('.ll-parallel-select:focus-visible')),
      parent: parallel.parentElement?.getAttribute?.('class') ?? parallel.parentElement?.tagName ?? null,
    }
  })
})()`)
const waitForFrameOpacity = async (nodeId, expected, timeout = 1200) => {
  const deadline = Date.now() + timeout
  let value = await frameOpacity(nodeId)
  while (Date.now() < deadline && value !== expected) {
    await sleep(50)
    value = await frameOpacity(nodeId)
  }
  return value
}
const initialFrameOpacities = await evaluate(`[...document.querySelectorAll('.ll-parallel > .ll-branch-frame')]
  .map((frame) => getComputedStyle(frame).opacity)`)
const frameHiddenInitially = initialFrameOpacities.every((value) => value === '0') ? '0' : 'mixed'

// 把真实指针停在并联选择层内部但不点击：整组虽然处于 :hover，外框仍须保持隐藏。
const hoverPoint = await evaluate(`(() => {
  const target = document.querySelector('.ll-parallel-select')
  if (!target) return null
  const rect = target.getBoundingClientRect()
  for (let y = Math.max(8, rect.top + 4); y < Math.min(innerHeight - 8, rect.bottom - 4); y += 10) {
    for (let x = Math.max(8, rect.left + 4); x < Math.min(innerWidth - 8, rect.right - 4); x += 10) {
      const hit = document.elementFromPoint(x, y)
      if (hit && target.contains(hit) && hit.closest('.ll-parallel-select') === target) {
        return { x, y }
      }
    }
  }
  return null
})()`)
if (!hoverPoint) throw new Error('找不到并联组内部空白悬停坐标')
await send('Input.dispatchMouseEvent', {
  type: 'mouseMoved', x: hoverPoint.x, y: hoverPoint.y, button: 'none', buttons: 0,
})
await sleep(320)
const hoverFrameState = await evaluate(`(() => {
  const parallel = document.querySelector('.ll-parallel')
  const frame = parallel?.querySelector(':scope > .ll-branch-frame')
  return {
    hover: Boolean(parallel?.matches(':hover')),
    selected: Boolean(parallel?.matches('.is-selected')),
    opacity: frame ? getComputedStyle(frame).opacity : null,
  }
})()`)
const frameHiddenWhileHovered = hoverFrameState.opacity === '0' ? '0' : hoverFrameState.opacity

const selectedPoint = await clickParallelSelector()
const selectedParallelState = await evaluate(`({
  selected: document.querySelectorAll('.ll-parallel.is-selected').length,
  selectedId: document.querySelector('.ll-parallel.is-selected')?.getAttribute('data-node-id') ?? null,
  frameCount: document.querySelectorAll('.ll-parallel').length,
  focused: document.activeElement?.closest?.('.ll-parallel') ? 1 : 0,
  activeClass: document.activeElement?.getAttribute?.('class') ?? document.activeElement?.tagName ?? null,
})`)
const selectedParallelId = selectedParallelState.selectedId
const frameVisibleWhenSelected = selectedParallelId
  ? await waitForFrameOpacity(selectedParallelId, '1')
  : null
const selectedFrameDiagnostics = selectedParallelId
  ? await frameDiagnostics(selectedParallelId)
  : null
const blankAfterSelectedPoint = await clickBlankCanvas()
const frameHiddenAfterBlank = selectedParallelId
  ? await waitForFrameOpacity(selectedParallelId, '0')
  : null
check('branch/frame-only-on-context', frameHiddenInitially === '0'
  && frameHiddenWhileHovered === '0'
  && frameVisibleWhenSelected === '1' && frameHiddenAfterBlank === '0', {
  frameHiddenInitially,
  frameHiddenWhileHovered,
  hoverFrameState,
  frameVisibleWhenSelected,
  frameHiddenAfterBlank,
  initialFrameOpacities,
  selectedParallelState,
  selectedFrameDiagnostics,
  initialBlankPoint,
  selectedPoint,
  blankAfterSelectedPoint,
})
console.log('QA branch: frame-context')

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
console.log('QA branch: coil-geometry')

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
const nodeBlankPoint = await clickBlankCanvas()
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
const wireBlankPoint = await clickBlankCanvas()
await sleep(240)
const wireAfterBlank = await evaluate(`document.querySelectorAll('.ll-slot.is-wire-selected').length`)
check('selection/blank-clears-wire', wireBeforeBlank === 1 && wireAfterBlank === 0, {
  wireBeforeBlank,
  wireAfterBlank,
  nodeBlankPoint,
  wireBlankPoint,
})

// 图纸之外、甚至程序区之外的界面留白也必须清除选中。
await evaluate(`document.querySelector('.ll-node.ll-contact[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
const beforeGutterClear = await evaluate(`({
  selected: document.querySelectorAll('.ll-node.is-selected').length,
  editor: !!document.querySelector('.qe-panel'),
})`)
await evaluate(`document.querySelector('.wb-instruction-intro')
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
  const overflowingElements = [...document.querySelectorAll('body *')]
    .filter((element) => {
      const box = element.getBoundingClientRect()
      return box.right > innerWidth + 1 || box.left < -1
    })
    .slice(0, 12)
    .map((element) => ({
      tag: element.tagName,
      cls: String(element.getAttribute('class') ?? ''),
      left: Math.round(element.getBoundingClientRect().left * 10) / 10,
      right: Math.round(element.getBoundingClientRect().right * 10) / 10,
    }))
  return {
    present: true,
    rungCount: document.querySelectorAll('.ll-rung').length,
    railCount: document.querySelectorAll('.ll-rail').length,
    countsPerDiagram: [...document.querySelectorAll('.ll-diagram')].map(
      (diagram) => diagram.querySelectorAll('.ll-rail').length,
    ),
    rightRail: [...document.querySelectorAll('.ll-rail')].filter((rail) => {
      const diagram = rail.closest('.ll-diagram')
      if (!diagram) return false
      return rail.getBoundingClientRect().left > diagram.getBoundingClientRect().left + diagram.getBoundingClientRect().width * 0.75
    }).length,
    fits: rect.left >= -1 && rect.right <= innerWidth + 1,
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
    overflowingElements,
  }
})()`)
check('mobile/branch-details-fit', mobile.present
  && mobile.railCount === mobile.rungCount
  && mobile.countsPerDiagram.every((count) => count === 1)
  && mobile.rightRail === 0
  && mobile.fits && mobile.bodyOverflow, mobile)
await screenshot('docs/qa/mobile-branch-details.png')

socket.close()
console.log(JSON.stringify({ checks, details, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || errors.length > 0) process.exitCode = 1
