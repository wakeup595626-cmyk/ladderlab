/**
 * 真实浏览器冒烟验收：桌面 1440×900 与手机 390×844 各跑一遍核心路径。
 *
 * 用法：先 `npm run preview`（默认 4173），再开一个带调试端口的浏览器，
 * 例如 Edge：`msedge --headless=new --remote-debugging-port=9222`，
 * 然后 `npm run qa`。脚本会顺带产出 README 用的截图。
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

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
}

async function reload(clearStorage = false) {
  if (clearStorage) await evaluate('window.localStorage.clear()')
  await send('Page.navigate', { url: APP_URL })
  await sleep(1100)
}

async function screenshot(path) {
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

async function pressEscape() {
  const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(260)
}

/** 发送组合键；modifiers 位掩码：Alt=1、Ctrl=2、Meta=4、Shift=8。 */
async function pressKey(key, code, vk, modifiers = 0) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(360)
}

const checks = {}
const details = {}
const check = (name, value, note) => {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
}

/** 载入启保停示例：优先用教练条按钮，教练条已关就从「更多 → 三步上手」进。 */
async function loadDemoFromAnywhere() {
  const viaCoach = await evaluate(`(() => {
    const button = document.querySelector('.wb-coach-demo')
    if (!button) return false
    button.click(); return true
  })()`)
  if (viaCoach) return 'coach'
  await evaluate(`document.querySelector('.wb-more summary')?.click()`)
  await sleep(200)
  const viaMenu = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.wb-more-menu button')]
      .find((button) => button.textContent?.includes('三步上手'))
    if (!item) return false
    item.click(); return true
  })()`)
  if (!viaMenu) return 'missing'
  await sleep(300)
  await evaluate(`document.querySelector('.guide-primary')?.click()`)
  return 'guide'
}

await send('Page.enable')
await send('Runtime.enable')

/* ------------------------------------------------------------------ 桌面 */

await setViewport(1440, 900, false)
await reload(true)

check('desktop/coach-visible-on-first-run', await evaluate(`!!document.querySelector('.wb-coach')`))
const demoSource = await loadDemoFromAnywhere()
check('desktop/demo-loads', demoSource !== 'missing', demoSource)
await sleep(700)

const demoState = await evaluate(`({
  running: document.querySelector('.wb-run-toggle')?.getAttribute('aria-pressed') === 'true',
  powered: document.querySelectorAll('.ll-rung.is-powered').length,
  tagPanel: !!document.querySelector('.inspector [role="tab"][aria-selected="true"]')?.textContent?.includes('变量表'),
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
})`)
check('desktop/demo-runs', demoState.running, demoState)
check('desktop/demo-opens-tags', demoState.tagPanel)
check('desktop/no-page-overflow', !demoState.overflow)

// 点 StartBtn 切换仿真输入，电机应自锁。
const started = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.tag-card')]
    .find((item) => item.querySelector('input')?.value === 'StartBtn')
  const button = card?.querySelector('.live-value')
  if (!button) return false
  button.click(); return true
})()`)
check('desktop/start-button-reachable', started)
await sleep(600)
const motor = await evaluate(`({
  value: [...document.querySelectorAll('.tag-card')]
    .find((card) => card.querySelector('input')?.value === 'Motor')
    ?.querySelector('.live-value')?.textContent?.trim(),
  powered: document.querySelectorAll('.ll-rung.is-powered').length,
})`)
check('desktop/motor-latches', motor.value === 'TRUE' && motor.powered >= 1, motor)
await screenshot('docs/qa/desktop-1440.png')
await screenshot('docs/screenshot.png')

// 点画布元件：参数编辑面板要开、插入位要显影。
const nodeClick = await evaluate(`(() => {
  const node = document.querySelector('.ll-node[data-node-id]')
  if (!node) return { clicked: false }
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return { clicked: true }
})()`)
await sleep(400)
const editor = await evaluate(`({
  open: !!document.querySelector('.qe-panel'),
  title: document.querySelector('.qe-panel h2')?.textContent?.trim() ?? null,
  selected: document.querySelectorAll('.ll-node.is-selected').length,
  slotVisible: (() => {
    const plus = document.querySelector('.ll-rung.is-selected .ll-slot-plus')
    if (!plus) return false
    return Number(getComputedStyle(plus).opacity) > 0.2
  })(),
  rungSelectedClass: document.querySelectorAll('.ll-rung.is-selected').length,
  rungClasses: [...document.querySelectorAll('.ll-rung')].map((item) => item.className),
  slotCount: document.querySelectorAll('.ll-slot').length,
  plusOpacity: (() => {
    const plus = document.querySelector('.ll-rung.is-selected .ll-slot-plus')
    return plus ? getComputedStyle(plus).opacity : null
  })(),
  inspectorTab: document.querySelector('.inspector-tabs button.active')?.textContent?.trim() ?? null,
  fits: (() => {
    const panel = document.querySelector('.qe-panel')
    if (!panel) return false
    const rect = panel.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1
  })(),
})`)
check('desktop/node-opens-editor', nodeClick.clicked && editor.open, editor)
check('desktop/editor-anchored-on-screen', editor.fits)
check('desktop/selection-visible', editor.selected >= 1)
check('desktop/insert-affordance-visible', editor.slotVisible, {
  rungSelectedClass: editor.rungSelectedClass,
  slotCount: editor.slotCount,
  plusOpacity: editor.plusOpacity,
})
check('desktop/inspector-follows-selection', String(editor.inspectorTab ?? '').includes('属性'), editor.inspectorTab)

// 面板里切换触点类型，梯形图应立刻反映。
const kindSwitch = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('.qe-segments button')]
  const target = buttons.find((button) => button.textContent?.trim() === '常闭')
  if (!target) return false
  target.click(); return true
})()`)
await sleep(350)
const kindApplied = await evaluate(`(() => {
  const active = [...document.querySelectorAll('.qe-segments button')]
    .find((button) => button.getAttribute('aria-pressed') === 'true')
  return active?.textContent?.trim() ?? null
})()`)
check('desktop/contact-kind-edits', kindSwitch && kindApplied === '常闭', kindApplied)
await screenshot('docs/qa/desktop-quick-editor.png')

// 插入位点击后元件数增加。
const beforeInsert = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
await evaluate(`document.querySelector('.ll-slot')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(400)
const afterInsert = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
const insertToast = await evaluate(`document.querySelector('.toast-message')?.textContent?.trim() ?? null`)
check('desktop/slot-inserts-contact', afterInsert > beforeInsert, { beforeInsert, afterInsert, insertToast })

// 顶栏撤销/重做必须常显，并且真的能回退刚才的插入。
const historyUi = await evaluate(`({
  undoVisible: !!document.querySelector('.wb-history-actions [aria-label="撤销上一步"]'),
  redoVisible: !!document.querySelector('.wb-history-actions [aria-label="重做下一步"]'),
  undoEnabled: document.querySelector('.wb-history-actions [aria-label="撤销上一步"]')?.disabled === false,
  segments: [...document.querySelectorAll('.ll-rung-index')].map((item) => item.textContent?.trim()),
})`)
check('desktop/history-visible', historyUi.undoVisible && historyUi.redoVisible && historyUi.undoEnabled, historyUi)
check('desktop/segment-labels', historyUi.segments[0] === '程序段 1', historyUi.segments)
await evaluate(`document.querySelector('.wb-history-actions [aria-label="撤销上一步"]')?.click()`)
await sleep(450)
const afterUndo = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
await evaluate(`document.querySelector('.wb-history-actions [aria-label="重做下一步"]')?.click()`)
await sleep(450)
const afterRedo = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
check('desktop/history-works', afterUndo === beforeInsert && afterRedo === afterInsert, { afterUndo, afterRedo })

// 程序段号跟着位置走：新增一段显示「程序段 2」，上移后仍是 1、2。
const firstTitle = await evaluate(`document.querySelector('.ll-rung-name')?.value ?? null`)
await evaluate(`document.querySelector('.ll-add-rung')?.click()`)
await sleep(500)
const twoSegments = await evaluate(`({
  labels: [...document.querySelectorAll('.ll-rung-index')].map((item) => item.textContent?.trim()),
  rungs: document.querySelectorAll('.ll-rung').length,
  ids: [...document.querySelectorAll('.ll-rung')].map((item) => item.getAttribute('data-rung-id')),
})`)
check('desktop/segment-numbering-new', twoSegments.rungs === 2 && twoSegments.labels.join('|') === '程序段 1|程序段 2', twoSegments)
await screenshot('docs/qa/desktop-segments.png')

await evaluate(`document.querySelectorAll('.ll-rung')[1]?.querySelector('.ll-rung-menu summary')?.click()`)
await sleep(260)
const moveClicked = await evaluate(`(() => {
  const menu = document.querySelectorAll('.ll-rung')[1]?.querySelector('.ll-rung-menu')
  const button = [...(menu?.querySelectorAll('button') ?? [])]
    .find((item) => item.textContent?.trim() === '上移')
  if (!button) return false
  button.click(); return true
})()`)
await sleep(500)
const reordered = await evaluate(`({
  labels: [...document.querySelectorAll('.ll-rung-index')].map((item) => item.textContent?.trim()),
  firstTitle: document.querySelector('.ll-rung-name')?.value ?? null,
  ids: [...document.querySelectorAll('.ll-rung')].map((item) => item.getAttribute('data-rung-id')),
})`)
check(
  'desktop/segment-numbering-reorder',
  moveClicked
    && reordered.labels.join('|') === '程序段 1|程序段 2'
    && reordered.ids.join(',') === [twoSegments.ids[1], twoSegments.ids[0]].join(','),
  reordered,
)

// Ctrl+Z / Ctrl+Y 与博途一致，且在输入框之外直接生效。
await pressKey('z', 'KeyZ', 90, 2)
const keyboardUndo = await evaluate(`[...document.querySelectorAll('.ll-rung')].map((item) => item.getAttribute('data-rung-id'))`)
check('desktop/ctrl-z-undo', keyboardUndo.join(',') === twoSegments.ids.join(','), { keyboardUndo, firstTitle })
await pressKey('y', 'KeyY', 89, 2)
const keyboardRedo = await evaluate(`[...document.querySelectorAll('.ll-rung')].map((item) => item.getAttribute('data-rung-id'))`)
check('desktop/ctrl-y-redo', keyboardRedo.join(',') === reordered.ids.join(','), keyboardRedo)

// 收尾：撤回上移、撤回新增，让后续截图回到单程序段。
await pressKey('z', 'KeyZ', 90, 2)
await pressKey('z', 'KeyZ', 90, 2)
const restoredRungs = await evaluate(`document.querySelectorAll('.ll-rung').length`)
check('desktop/segments-restored', restoredRungs === 1, restoredRungs)

// 工程改名后刷新仍保留。
const renameReady = await evaluate(`(() => {
  const input = document.querySelector('#project-name')
  if (!input) return false
  input.focus()
  input.select()
  return true
})()`)
if (renameReady) {
  await send('Input.insertText', { text: 'QA 持久化检查' })
  await sleep(250)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
await sleep(900)
await reload(false)
const persisted = await evaluate(`document.querySelector('#project-name')?.value ?? null`)
check('desktop/rename-persists', persisted === 'QA 持久化检查', persisted)

/* ------------------------------------------------------------------ 手机 */

await setViewport(390, 844, true)
await reload(true)
await sleep(400)

const mobileFirst = await evaluate(`({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  coach: !!document.querySelector('.wb-coach'),
  tabbar: !!document.querySelector('.wb-tabbar'),
  heights: ['.wb-topbar', '.wb-documentbar'].map((selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().height ?? 0)),
})`)
check('mobile/no-page-overflow', !mobileFirst.overflow)
check('mobile/tabbar-present', mobileFirst.tabbar)

await loadDemoFromAnywhere()
await sleep(800)
await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`)
const mobileDemo = await evaluate(`({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  running: document.querySelector('.wb-run-toggle')?.getAttribute('aria-pressed') === 'true',
  ladderScrolls: (() => {
    const box = document.querySelector('.ll-svg-scroll')
    return box ? box.scrollWidth - box.clientWidth : null
  })(),
  powered: document.querySelectorAll('.ll-rung.is-powered').length,
})`)
check('mobile/demo-runs', mobileDemo.running, mobileDemo)
check('mobile/still-no-page-overflow', !mobileDemo.overflow)
details['mobile/ladder-overflow-px'] = mobileDemo.ladderScrolls
await screenshot('docs/qa/mobile-390.png')
await screenshot('docs/ui-check.png')

// 手机端点元件应打开底部参数面板，并有遮罩。
await evaluate(`document.querySelector('.ll-node[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(450)
const mobileEditor = await evaluate(`({
  open: !!document.querySelector('.qe-panel'),
  dialog: document.querySelector('.qe-panel')?.getAttribute('role') ?? null,
  scrim: !!document.querySelector('.qe-scrim'),
  inViewport: (() => {
    const panel = document.querySelector('.qe-panel')
    if (!panel) return false
    const rect = panel.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
  })(),
})`)
check('mobile/node-opens-sheet', mobileEditor.open && mobileEditor.dialog === 'dialog', mobileEditor)
check('mobile/sheet-in-viewport', mobileEditor.inViewport)
await screenshot('docs/qa/mobile-quick-editor.png')

await pressEscape()
check('mobile/escape-closes-sheet', !(await evaluate(`!!document.querySelector('.qe-panel')`)))

// 手机端切到指令标签，应能打开指令抽屉。
await evaluate(`[...document.querySelectorAll('.wb-tabbar button')].find((button) => button.textContent?.includes('指令'))?.click()`)
await sleep(450)
const drawer = await evaluate(`!!document.querySelector('.wb-instruction-drawer-backdrop')`)
check('mobile/instructions-reachable', drawer)
await screenshot('docs/qa/mobile-instructions.png')

socket.close()
console.log(JSON.stringify({ checks, details, demoState, editor, mobileFirst, mobileDemo, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || errors.length > 0) process.exitCode = 1
