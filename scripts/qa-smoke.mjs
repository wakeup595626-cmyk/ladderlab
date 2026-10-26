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
  // 手机验收同时模拟粗指针，触控尺寸（44px）才按真实设备生效。
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
  await send('Emulation.setEmulatedMedia', {
    features: mobile
      ? [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }]
      : [{ name: 'pointer', value: 'fine' }, { name: 'any-pointer', value: 'fine' }],
  })
}

async function reload(clearStorage = false) {
  if (clearStorage) {
    // 应用在 pagehide 里会补写一次待保存工程，直接清 localStorage 再刷新会被
    // 刚离开的页面写回去。先切到空白页触发收尾，再按源清空，才是真正的首访。
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(320)
    await send('Storage.clearDataForOrigin', {
      origin: new URL(APP_URL).origin,
      storageTypes: 'local_storage',
    })
  }
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  await sleep(250)
}

/** 等 React 真正挂载再开始点：远程预览首包慢时，固定 sleep 会误判成功能缺失。 */
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

async function screenshot(path) {
  // 验收用的浏览器带着第三方侧边栏扩展，它会把浮标注入页面；
  // 截图前移除，保证交付截图里只有应用本身。
  await evaluate(
    `document.querySelectorAll('plasmo-csui, #dx-sibebar-container').forEach((node) => node.remove())`,
  ).catch(() => {})
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

/** 回到干净的启保停示例，后面的检查互不继承上一步留下的落点。 */
async function reloadDemo() {
  await reload(true)
  await loadDemoFromAnywhere()
  await sleep(700)
}

/** 在主线第 2 个插入位的 + 菜单里选「加入并联分支」，返回是否真的开出来。 */
async function openDraftBranch() {
  const opened = await evaluate(`(() => {
    const slot = document.querySelector('.ll-slot[data-chain=""][data-index="1"]')
    const plus = slot?.querySelector('.ll-slot-plus')
    if (!plus) return false
    plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })()`)
  await sleep(320)
  const picked = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.ll-slot-menu-item[role="menuitem"]')]
      .find((button) => button.textContent?.includes('加入并联分支'))
    if (!item || item.disabled) return false
    item.click()
    return true
  })()`)
  await sleep(520)
  return opened && picked
}

/**
 * 点支路右侧「合并分支」，等主线上的合法插入位亮起，再点第一个位置收拢。
 * 返回亮起的位置数，方便调用方判断“合并”和“取消合并”两条路都走到了。
 */
async function closeDraftBranch() {
  await evaluate(`document.querySelector('.ll-merge-chip')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(320)
  const candidates = await evaluate(
    `document.querySelectorAll('.ll-slot.is-merge-candidate').length`,
  )
  await evaluate(`document.querySelector('.ll-slot.is-merge-candidate .ll-slot-plus')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(520)
  return candidates
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

// 顶栏「更多」浮层不能被 40px 高的按钮组裁掉，也不能被右侧属性栏压住。
await evaluate(`document.querySelector('.wb-more .icon-button')?.click()`)
await sleep(300)
const moreMenu = await evaluate(`(() => {
  const menu = document.querySelector('.wb-more-menu')
  if (!menu) return { open: false }
  const rect = menu.getBoundingClientRect()
  const items = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
  const misses = items.filter((item) => {
    const r = item.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !(item === hit || item.contains(hit))
  }).length
  return {
    open: true,
    items: items.length,
    misses,
    fits: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
    rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), right: Math.round(rect.right) },
  }
})()`)
check(
  'desktop/more-menu-not-clipped',
  moreMenu.open && moreMenu.items >= 6 && moreMenu.misses === 0 && moreMenu.fits,
  moreMenu,
)
await screenshot('docs/qa/desktop-more-menu.png')
await evaluate(`document.querySelector('.wb-more .icon-button')?.click()`)
await sleep(200)

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
  plusClickable: (() => {
    const plus = document.querySelector('.ll-rung.is-selected .ll-slot-plus')
    return plus ? getComputedStyle(plus).pointerEvents !== 'none' : false
  })(),
  inspectorOpen: !!document.querySelector('.wb-context-panel'),
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
check('desktop/insert-affordance-clickable', editor.plusClickable)
check('desktop/editor-is-single-layer', !editor.inspectorOpen, {
  inspectorOpen: editor.inspectorOpen,
  editorMode: editor.open ? 'inline editor' : 'missing',
})

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

// 地址和符号名分开：直接改地址应立刻同步到画布，并且画布保留带引号的符号名。
const addressStarted = await evaluate(`(() => {
  const field = [...document.querySelectorAll('.qe-field')]
    .find((item) => item.querySelector(':scope > span')?.textContent?.trim() === '地址')
  const input = field?.querySelector('input')
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, 'M100.0')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
  return input.value === 'M100.0'
})()`)
await sleep(100)
await pressKey('Enter', 'Enter', 13)
await sleep(380)
const addressEdit = await evaluate(`({
  addresses: [...document.querySelectorAll('.ll-node-address, .ll-output-address')]
    .map((item) => item.textContent?.trim()),
  names: [...document.querySelectorAll('.ll-node-name, .ll-output-name')]
    .map((item) => item.textContent?.trim()),
  field: document.querySelector('.qe-field .qe-input')?.value ?? null,
})`)
check(
  'desktop/address-edits-and-symbol-persists',
  addressStarted
    && addressEdit.addresses.includes('%M100.0')
    && addressEdit.names.some((name) => /^"[^"]+"$/.test(name)),
  addressEdit,
)
await screenshot('docs/qa/desktop-quick-editor.png')

// 反方向也必须是单层：就近参数框开着时点「变量表」，参数框要收起，
// 不能让同一个触点同时出现在浮动框和右侧属性栏里。
await evaluate(`[...document.querySelectorAll('.wb-doc-action')]
  .find((button) => button.textContent?.includes('变量表'))?.click()`)
await sleep(320)
const inspectorSwitch = await evaluate(`({
  editor: !!document.querySelector('.qe-panel'),
  inspector: !!document.querySelector('.wb-context-panel'),
})`)
check(
  'desktop/inspector-and-editor-exclusive',
  !inspectorSwitch.editor && inspectorSwitch.inspector,
  inspectorSwitch,
)
await evaluate(`document.querySelector('.wb-context-panel button[aria-label="关闭属性面板"]')?.click()`)
await sleep(280)

// 点线路只选线、不改程序；点同一个插入位的 + 才打开元件菜单。
const beforeInsert = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
const wireSelected = await evaluate(`(() => {
  const slot = document.querySelector('.ll-rung .ll-slot[data-chain=""][data-index="1"]')
  const wire = slot?.querySelector('.ll-slot-wire')
  if (!wire) return false
  wire.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await sleep(250)
const wireSelection = await evaluate(`({
  nodes: document.querySelectorAll('.ll-node[data-node-id]').length,
  wires: document.querySelectorAll('.ll-slot.is-wire-selected').length,
  chip: document.querySelector('.ll-selected-chip')?.textContent?.trim() ?? null,
})`)
check(
  'desktop/slot-wire-selects-without-insert',
  wireSelected
    && wireSelection.nodes === beforeInsert
    && wireSelection.wires === 1
    && String(wireSelection.chip ?? '').includes('已选线路'),
  wireSelection,
)

const slotMenuTriggered = await evaluate(`(() => {
  const slot = document.querySelector('.ll-rung .ll-slot[data-chain=""][data-index="1"]')
  const plus = slot?.querySelector('.ll-slot-plus')
  if (!plus) return false
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await sleep(350)
const slotMenu = await evaluate(`(() => {
  const menu = document.querySelector('.ll-slot-menu[role="menu"]')
  if (!menu) return { open: false }
  const items = [...menu.querySelectorAll('.ll-slot-menu-item[role="menuitem"]')]
  const branch = items.find((item) => item.textContent?.includes('加入并联分支'))
  const rect = menu.getBoundingClientRect()
  return {
    open: true,
    items: items.length,
    labels: items.map((item) => item.textContent?.trim() ?? ''),
    branchEnabled: branch?.disabled === false,
    fits: rect.left >= 0 && rect.right <= innerWidth + 1
      && rect.top >= 0 && rect.bottom <= innerHeight + 1,
  }
})()`)
check(
  'desktop/slot-plus-opens-menu',
  slotMenuTriggered && slotMenu.open && slotMenu.items >= 6 && slotMenu.branchEnabled && slotMenu.fits,
  slotMenu,
)

await evaluate(`[...document.querySelectorAll('.ll-slot-menu-item[role="menuitem"]')]
  .find((item) => item.textContent?.includes('常闭触点'))?.click()`)
await sleep(420)
const afterInsert = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
const slotInsert = await evaluate(`({
  selected: document.querySelectorAll('.ll-node.is-selected').length,
  menuOpen: !!document.querySelector('.ll-slot-menu'),
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
  primaryFocused: document.activeElement?.matches('.qe-panel .qe-input[data-primary="true"]') === true,
})`)
check(
  'desktop/slot-menu-inserts-contact',
  afterInsert === beforeInsert + 1
    && slotInsert.selected === 1
    && !slotInsert.menuOpen
    && slotInsert.primaryFocused
    && String(slotInsert.toast ?? '').includes('常闭触点已插入'),
  { beforeInsert, afterInsert, ...slotInsert },
)

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

// 操作数输入框也能直接接收绝对地址：不必先去变量表建变量。
await evaluate(`document.querySelector('.ll-node[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
const operandStarted = await evaluate(`(() => {
  const input = document.querySelector('.qe-panel .qe-input[data-primary="true"]')
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, 'M4.0')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
  return input.value === 'M4.0'
})()`)
await sleep(100)
await pressKey('Enter', 'Enter', 13)
await sleep(380)
const operandAddress = await evaluate(`({
  address: [...document.querySelectorAll('.ll-node-address, .ll-output-address')]
    .map((item) => item.textContent?.trim()),
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
})`)
check(
  'desktop/operand-accepts-absolute-address',
  operandStarted && operandAddress.address.includes('%M4.0'),
  operandAddress,
)

// 插入位菜单要能被 Esc 收起：触屏上误点开菜单后，不能只靠再点一次 + 才关得掉。
await reload(true)
await loadDemoFromAnywhere()
await sleep(700)
await evaluate(`(() => {
  const slot = document.querySelector('.ll-slot[data-chain=""][data-index="1"]')
  const plus = slot?.querySelector('.ll-slot-plus')
  if (!plus) return false
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await sleep(320)
const menuBeforeEscape = await evaluate(`!!document.querySelector('.ll-slot-menu[role="menu"]')`)
await pressEscape()
const menuAfterEscape = await evaluate(`!!document.querySelector('.ll-slot-menu')`)
check(
  'desktop/slot-menu-escape-closes',
  menuBeforeEscape && !menuAfterEscape,
  { menuBeforeEscape, menuAfterEscape },
)

// 选线路后再用段头「插入触点」，触点必须落在这条线上，而不是跑到段尾。
await evaluate(`(() => {
  const rung = document.querySelectorAll('.ll-rung')[0]
  const slot = rung?.querySelector('.ll-slot[data-chain=""][data-index="1"]')
  const wire = slot?.querySelector('.ll-slot-wire')
  if (!wire) return false
  wire.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await sleep(280)
const wireForToolbar = await evaluate(`({
  selectedWires: document.querySelectorAll('.ll-slot.is-wire-selected').length,
  chip: document.querySelector('.ll-selected-chip')?.textContent?.trim() ?? null,
})`)
await evaluate(`document.querySelector('.ll-insert-trigger')?.click()`)
await sleep(280)
await evaluate(`[...document.querySelectorAll('.ll-insert-panel button')]
  .find((button) => button.textContent?.includes('常开触点'))?.click()`)
await sleep(420)
const wireInserted = await evaluate(`(() => {
  const rung = document.querySelectorAll('.ll-rung')[0]
  const nodes = [...(rung?.querySelectorAll('.ll-node[data-node-id]') ?? [])]
  return {
    selectedIndex: nodes.findIndex((node) => node.classList.contains('is-selected')),
    selectedCount: nodes.filter((node) => node.classList.contains('is-selected')).length,
    count: nodes.length,
  }
})()`)
check(
  'desktop/toolbar-insert-uses-selected-wire',
  wireForToolbar.selectedWires === 1
    && String(wireForToolbar.chip ?? '').includes('已选线路')
    && wireInserted.selectedIndex === 1
    && wireInserted.selectedCount === 1,
  { wireForToolbar, wireInserted },
)
await evaluate(`document.querySelector('.wb-history-actions [aria-label="撤销上一步"]')?.click()`)
await sleep(420)

/* 程序段工具栏：插入与删除是常显按钮，不再只靠画布角上的小加号。 */
await pressEscape()
await evaluate(`document.querySelectorAll('.ll-node[data-node-id]')[0]
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
await pressEscape()

const rungTools = await evaluate(`(() => {
  const tools = document.querySelector('.ll-rung-tools')
  const trigger = tools?.querySelector('.ll-insert-trigger')
  const remove = tools?.querySelector('.ll-tool-remove')
  if (!tools || !trigger || !remove) return { present: false }
  const rect = tools.getBoundingClientRect()
  return {
    present: true,
    insertLabel: trigger.textContent?.trim() ?? '',
    removeLabel: remove.textContent?.trim() ?? '',
    removeEnabled: remove.disabled === false,
    removeTitle: remove.getAttribute('title'),
    inViewport: rect.left >= 0 && rect.right <= innerWidth + 1,
    height: Math.round(rect.height),
  }
})()`)
check(
  'desktop/rung-toolbar-visible',
  rungTools.present
    && rungTools.insertLabel.includes('插入触点')
    && rungTools.removeLabel.includes('删除元件'),
  rungTools,
)
check('desktop/rung-toolbar-in-viewport', rungTools.inViewport)
check('desktop/delete-enabled-on-selection', rungTools.removeEnabled, rungTools.removeTitle)

// 打开「插入触点」菜单，选常开触点：元件 +1，新元件保持选中，删除键随之可用。
const beforeBarInsert = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
await evaluate(`document.querySelector('.ll-insert-trigger')?.click()`)
await sleep(320)
const insertMenu = await evaluate(`(() => {
  const panel = document.querySelector('.ll-insert-panel')
  if (!panel) return { open: false }
  const rect = panel.getBoundingClientRect()
  return {
    open: true,
    items: [...panel.querySelectorAll('button')].map((button) => button.textContent?.trim()),
    fits: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
  }
})()`)
check('desktop/insert-menu-opens', insertMenu.open && insertMenu.items.length >= 5, insertMenu.items)
check('desktop/insert-menu-fits', insertMenu.fits)

await evaluate(`[...document.querySelectorAll('.ll-insert-panel button')]
  .find((button) => button.textContent?.includes('常开触点'))?.click()`)
await sleep(420)
const barInserted = await evaluate(`({
  count: document.querySelectorAll('.ll-node[data-node-id]').length,
  selected: document.querySelectorAll('.ll-node.is-selected').length,
  deleteEnabled: document.querySelector('.ll-tool-remove')?.disabled === false,
  menuOpen: document.querySelector('details.ll-insert')?.open === true,
})`)
check(
  'desktop/toolbar-insert-adds-contact',
  barInserted.count === beforeBarInsert + 1,
  { beforeBarInsert, ...barInserted },
)
check('desktop/inserted-contact-selected', barInserted.selected >= 1 && barInserted.deleteEnabled)
check('desktop/insert-menu-closes', !barInserted.menuOpen)

// 「删除元件」删掉选中元件，Toast 提供撤销，撤销后位置与数量原样回来。
await evaluate(`document.querySelector('.ll-tool-remove')?.click()`)
await sleep(420)
const barDeleted = await evaluate(`({
  count: document.querySelectorAll('.ll-node[data-node-id]').length,
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
  undo: !!document.querySelector('.toast-action'),
})`)
check('desktop/delete-button-removes-contact', barDeleted.count === beforeBarInsert, barDeleted)
check(
  'desktop/delete-toast-offers-undo',
  barDeleted.undo && String(barDeleted.toast ?? '').includes('已删除'),
  barDeleted.toast,
)

await evaluate(`document.querySelector('.toast-action')?.click()`)
await sleep(420)
const barRestored = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
check('desktop/delete-undo-restores-contact', barRestored === beforeBarInsert + 1, barRestored)

// 键盘 Delete / Backspace 直接删选中元件；焦点在输入框时不抢键。
await evaluate(`document.querySelectorAll('.ll-node[data-node-id]')[0]
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
await pressEscape()
await pressKey('Delete', 'Delete', 46)
const deleteKeyCount = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
check('desktop/delete-key-removes-contact', deleteKeyCount === beforeBarInsert, deleteKeyCount)

await evaluate(`document.querySelectorAll('.ll-node[data-node-id]')[0]
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
await pressEscape()
await pressKey('Backspace', 'Backspace', 8)
const backspaceCount = await evaluate(`document.querySelectorAll('.ll-node[data-node-id]').length`)
check('desktop/backspace-removes-contact', backspaceCount === beforeBarInsert - 1, backspaceCount)

// Ctrl+C / Ctrl+V：复制选中触点后连续粘贴两次，第二次必须接在第一次的后面，
// 而且每次粘贴后选中的都是刚贴出来的那一个。
await reloadDemo()
await evaluate(`document.querySelector('.ll-node.ll-contact[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
await pressEscape()
await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`)
const clipboardBefore = await evaluate(`({
  ids: [...document.querySelectorAll('.ll-node[data-node-id]')]
    .map((node) => node.getAttribute('data-node-id')),
  selected: [...document.querySelectorAll('.ll-node.is-selected[data-node-id]')]
    .map((node) => node.getAttribute('data-node-id')),
})`)
await pressKey('c', 'KeyC', 67, 2)
const clipboardCopied = await evaluate(`({
  ids: [...document.querySelectorAll('.ll-node[data-node-id]')]
    .map((node) => node.getAttribute('data-node-id')),
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
})`)
await pressKey('v', 'KeyV', 86, 2)
const firstPaste = await evaluate(`({
  ids: [...document.querySelectorAll('.ll-node[data-node-id]')]
    .map((node) => node.getAttribute('data-node-id')),
  selected: [...document.querySelectorAll('.ll-node.is-selected[data-node-id]')]
    .map((node) => node.getAttribute('data-node-id')),
})`)
await pressKey('v', 'KeyV', 86, 2)
const secondPaste = await evaluate(`({
  ids: [...document.querySelectorAll('.ll-node[data-node-id]')]
    .map((node) => node.getAttribute('data-node-id')),
  selected: [...document.querySelectorAll('.ll-node.is-selected[data-node-id]')]
    .map((node) => node.getAttribute('data-node-id')),
})`)
const pastedFirst = firstPaste.ids.filter((id) => !clipboardBefore.ids.includes(id))
const pastedAll = secondPaste.ids.filter((id) => !clipboardBefore.ids.includes(id))
const pastedSecondIndex = pastedAll.length === 2 ? secondPaste.ids.indexOf(pastedAll[0]) : -1
check(
  'desktop/ctrl-c-ctrl-v-appends-in-order',
  clipboardBefore.selected.length === 1
    && String(clipboardCopied.toast ?? '').includes('已复制')
    && clipboardCopied.ids.length === clipboardBefore.ids.length
    && pastedFirst.length === 1
    && firstPaste.selected.length === 1
    && firstPaste.selected[0] === pastedFirst[0]
    && pastedAll.length === 2
    && pastedSecondIndex >= 0
    && secondPaste.ids[pastedSecondIndex + 1] === pastedAll[1]
    && secondPaste.selected.length === 1
    && secondPaste.selected[0] === pastedAll[1],
  { clipboardBefore, clipboardCopied, firstPaste, secondPaste, pastedFirst, pastedAll },
)

// 删除并联支路里的第一个触点会折叠只剩单路的并联层级；Toast 撤销必须恢复完整快照，
// 不能只给出“已恢复”的假确认。
// 并联分支从插入点菜单打开：草稿自带一个常开触点，右侧出现「合并分支」；
// 草稿还能继续加触点，取闭合点可按 Esc 取消，再点合并才真正收拢。
await reloadDemo()
const branchOpenedFromMenu = await openDraftBranch()
const draftChain = await evaluate(`(() => {
  const node = document.querySelector('.ll-node.is-selected[data-node-id]')
  if (!node) return null
  for (let element = node.parentElement; element; element = element.parentElement) {
    const slots = [...element.querySelectorAll('.ll-slot[data-chain]')]
    if (slots.length === 0) continue
    const chains = new Set(slots.map((slot) => slot.getAttribute('data-chain')))
    if (chains.size === 1) return slots[0].getAttribute('data-chain')
  }
  return null
})()`)
const branchDraft = await evaluate(`({
  open: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  chip: document.querySelectorAll('.ll-merge-chip').length,
  draftWires: document.querySelectorAll('.ll-wire.is-draft').length,
  slots: document.querySelectorAll('.ll-slot[data-chain="${draftChain}"]').length,
  label: document.querySelector('.ll-node.is-selected')?.getAttribute('aria-label') ?? null,
})`)
check(
  'desktop/branch-opens-draft',
  branchOpenedFromMenu
    && branchDraft.open === 1
    && branchDraft.chip === 1
    && branchDraft.draftWires >= 1
    && branchDraft.slots === 2
    && String(branchDraft.label ?? '').includes('常开'),
  { branchOpenedFromMenu, draftChain, ...branchDraft },
)

for (let round = 0; round < 2; round += 1) {
  await evaluate(`(() => {
    const slots = [...document.querySelectorAll('.ll-slot[data-chain="${draftChain}"]')]
    const plus = slots.at(-1)?.querySelector('.ll-slot-plus')
    if (!plus) return false
    plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })()`)
  await sleep(320)
  await evaluate(`[...document.querySelectorAll('.ll-slot-menu-item[role="menuitem"]')]
    .find((item) => item.textContent?.includes('常开触点'))?.click()`)
  await sleep(420)
}
const draftAfterInserts = await evaluate(`({
  slots: document.querySelectorAll('.ll-slot[data-chain="${draftChain}"]').length,
  open: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  menu: document.querySelectorAll('.ll-slot-menu').length,
})`)
check(
  'desktop/branch-draft-accepts-more-contacts',
  draftAfterInserts.slots === branchDraft.slots + 2
    && draftAfterInserts.open === 1
    && draftAfterInserts.menu === 0,
  { before: branchDraft.slots, ...draftAfterInserts },
)

await evaluate(`document.querySelector('.ll-merge-chip')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(320)
const mergeArmed = await evaluate(`({
  candidates: document.querySelectorAll('.ll-slot.is-merge-candidate').length,
  open: document.querySelectorAll('.ll-parallel.is-branch-open').length,
})`)
check(
  'desktop/branch-merge-arms-candidates',
  mergeArmed.candidates >= 1 && mergeArmed.open === 1,
  mergeArmed,
)

// Esc 只退出“选闭合点”，草稿支路和已加好的触点必须原样保留。
await pressEscape()
const mergeEscaped = await evaluate(`({
  candidates: document.querySelectorAll('.ll-slot.is-merge-candidate').length,
  open: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  slots: document.querySelectorAll('.ll-slot[data-chain="${draftChain}"]').length,
})`)
check(
  'desktop/branch-merge-escape-cancels',
  mergeArmed.candidates >= 1
    && mergeEscaped.candidates === 0
    && mergeEscaped.open === 1
    && mergeEscaped.slots === draftAfterInserts.slots,
  mergeEscaped,
)

const candidatesClosed = await closeDraftBranch()
const mergedBranch = await evaluate(`({
  open: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  chip: document.querySelectorAll('.ll-merge-chip').length,
  candidates: document.querySelectorAll('.ll-slot.is-merge-candidate').length,
  parallels: document.querySelectorAll('.ll-parallel').length,
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
})`)
check(
  'desktop/branch-merge-closes',
  candidatesClosed >= 1
    && mergedBranch.open === 0
    && mergedBranch.chip === 0
    && mergedBranch.candidates === 0
    && mergedBranch.parallels >= 1
    && String(mergedBranch.toast ?? '').includes('并联分支已闭合'),
  { candidatesClosed, ...mergedBranch },
)

// 博途式并联：每条支路有自己的水平线，末端进入同一根汇合竖线。
// 嵌套在最外层支路末端的并联，必须把汇合竖线并到外层的同一列。
const parallelGeometry = await evaluate(`(() => {
  const groups = [...document.querySelectorAll('.ll-parallel')]
  return groups.map((group) => {
    const right = [...group.querySelectorAll('[data-parallel-branch-side="right"]')]
      .filter((path) => path.closest('.ll-parallel') === group)
      .map((path) => {
        const box = path.getBoundingClientRect()
        return { x: box.x, y: box.y, end: box.right }
      })
    const findJoin = (owner) => [...owner.querySelectorAll('[data-parallel-join]')]
      .find((path) => path.closest('.ll-parallel') === owner)
    // 取路径首点（M collectX ...）的真实屏幕坐标。不要用包围盒中心：
    // 汇合路径同时包含水平出线和竖直汇合线，包围盒中心并不等于竖线位置。
    const joinStartX = (path) => {
      if (!path) return null
      const point = path.getPointAtLength(0)
      const matrix = path.getScreenCTM()
      return matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix).x : null
    }
    const join = findJoin(group)
    const parent = group.parentElement?.closest('.ll-parallel')
    const parentJoin = parent ? findJoin(parent) : null
    const joinX = joinStartX(join)
    return {
      branches: right.length,
      ys: right.map((item) => Math.round(item.y * 10) / 10),
      spans: right.map((item) => Math.round((item.end - item.x) * 10) / 10),
      joinX: joinX === null ? null : Math.round(joinX * 10) / 10,
      joinXGap: join && right.length
        ? Math.max(...right.map((item) => Math.abs(joinX - item.end)))
        : null,
      inherited: group.getAttribute('data-merge-inherited') === 'true',
      parentJoinX: parentJoin ? Math.round(joinStartX(parentJoin) * 10) / 10 : null,
    }
  })
})()`)
const parallelLayers = parallelGeometry.filter((group) => group.branches >= 2)
check(
  'desktop/parallel-has-separate-branch-lanes',
  parallelLayers.length >= 2
    && parallelLayers.every((group) => new Set(group.ys).size === group.branches)
    && parallelLayers.every((group) => group.spans.every((span) => span > 4))
    && parallelLayers.every((group) => group.joinXGap < 1),
  parallelGeometry,
)
check(
  'desktop/nested-parallel-shares-outer-merge-column',
  parallelLayers.some((group) => group.inherited)
    && parallelLayers
      .filter((group) => group.inherited)
      .every((group) => group.parentJoinX !== null
        && Math.abs(group.joinX - group.parentJoinX) <= 1.5),
  parallelGeometry,
)
await screenshot('docs/qa/desktop-parallel-standard.png')

// 合并后并联节点仍保持选中，点开分支面板供截图，也留给下面的折叠测试。
await evaluate(`document.querySelector('.ll-parallel.is-selected')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(420)
await screenshot('docs/qa/branch-branches-panel.png')
await pressEscape()
const parallelBeforeDelete = await evaluate(`({
  nodes: document.querySelectorAll('.ll-node[data-node-id]').length,
  parallels: document.querySelectorAll('.ll-parallel').length,
})`)
await evaluate(`document.querySelector('.ll-parallel .ll-contact')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(360)
await pressEscape()
await evaluate(`document.querySelector('.ll-rung-tools .ll-tool-remove')?.click()`)
await sleep(440)
const collapsedParallel = await evaluate(`({
  nodes: document.querySelectorAll('.ll-node[data-node-id]').length,
  parallels: document.querySelectorAll('.ll-parallel').length,
  undo: !!document.querySelector('.toast-action'),
})`)
check(
  'desktop/parallel-collapse-delete',
  parallelBeforeDelete.parallels >= 1
    && collapsedParallel.parallels === parallelBeforeDelete.parallels - 1
    && collapsedParallel.nodes < parallelBeforeDelete.nodes
    && collapsedParallel.undo,
  { parallelBeforeDelete, collapsedParallel },
)
await evaluate(`document.querySelector('.toast-action')?.click()`)
await sleep(440)
const restoredParallel = await evaluate(`({
  nodes: document.querySelectorAll('.ll-node[data-node-id]').length,
  parallels: document.querySelectorAll('.ll-parallel').length,
  selected: document.querySelectorAll('.ll-contact.is-selected').length,
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
})`)
check(
  'desktop/parallel-collapse-undo-restores',
  restoredParallel.nodes === parallelBeforeDelete.nodes
    && restoredParallel.parallels === parallelBeforeDelete.parallels
    && restoredParallel.selected === 1
    && String(restoredParallel.toast ?? '').includes('已恢复'),
  restoredParallel,
)

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

// 定时器按博途布局：IN / Q 在主功率线上，PT / ET 的值放在框外左右两侧。
const openedLibrary = await evaluate(`(() => {
  const button = document.querySelector('.wb-project-button')
  button?.click()
  return !!button
})()`)
await sleep(320)
const openedSamples = await evaluate(`(() => {
  if (!document.querySelector('.wb-project-drawer')) return false
  const item = [...document.querySelectorAll('.wb-tree-item')]
    .find((node) => node.textContent?.includes('实验库'))
  item?.click()
  return !!item
})()`)
await sleep(360)
const pickedTimerSample = await evaluate(`(() => {
  const item = [...document.querySelectorAll('.library-item')]
    .find((node) => node.textContent?.includes('顺序启动'))
  item?.click()
  return !!item
})()`)
await sleep(300)
await evaluate(`document.querySelector('.confirm-ok')?.click()`)
await sleep(700)
const timerLayout = await evaluate(`(() => {
  const graphic = document.querySelector('[data-instruction="TON"]')
  if (!graphic) return { present: false }
  const box = graphic.querySelector('.ll-instruction-box')?.getBoundingClientRect()
  const pt = graphic.querySelector('[data-pin-value="PT"]')
  const et = graphic.querySelector('[data-pin-value="ET"]')
  const ptRect = pt?.getBoundingClientRect()
  const etRect = et?.getBoundingClientRect()
  return {
    present: true,
    pins: [...graphic.querySelectorAll('[data-pin]')].map((pin) => pin.getAttribute('data-pin')),
    ptText: pt?.textContent?.trim() ?? null,
    etText: et?.textContent?.trim() ?? null,
    ptInside: box && ptRect ? ptRect.right <= box.left + 1 : null,
    etInside: box && etRect ? etRect.left >= box.right - 1 : null,
    box: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null,
    pt: ptRect ? { left: ptRect.left, right: ptRect.right } : null,
    et: etRect ? { left: etRect.left, right: etRect.right } : null,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }
})()`)
check(
  'desktop/timer-follows-tia-pin-layout',
  openedLibrary
    && openedSamples
    && pickedTimerSample
    && timerLayout.present
    && ['IN', 'PT', 'Q', 'ET'].every((pin) => timerLayout.pins.includes(pin))
    && timerLayout.ptText === 'T#3s'
    && timerLayout.etText === 'T#0ms'
    && timerLayout.ptInside === true
    && timerLayout.etInside === true
    && !timerLayout.overflow,
  timerLayout,
)
await screenshot('docs/qa/desktop-timer-standard.png')

// MOVE 按实验六 PPT：常量在 IN 左侧框外，OUT1 的地址与符号名在框外右侧，
// 框内只保留 EN / ENO / IN / OUT1。颜色同时锁定 PPT 中的灰紫框、黄绿参数线、青色地址。
await evaluate(`(() => {
  if (!document.querySelector('.library-dialog') && !document.querySelector('.wb-project-drawer')) {
    document.querySelector('.wb-project-button')?.click()
  }
  return true
})()`)
await sleep(340)
const openedMoveLab = await evaluate(`(() => {
  if (document.querySelector('.library-dialog')) return true
  const item = [...document.querySelectorAll('.wb-tree-item')]
    .find((node) => node.textContent?.includes('实验库'))
  item?.click()
  return !!item
})()`)
await sleep(380)
const pickedMoveLab = await evaluate(`(() => {
  const item = [...document.querySelectorAll('.library-item')]
    .find((node) => node.textContent?.includes('装配流水线'))
  item?.click()
  return !!item
})()`)
await sleep(320)
await evaluate(`document.querySelector('.confirm-ok')?.click()`)
await sleep(800)
const moveLayout = await evaluate(`(() => {
  const graphics = [...document.querySelectorAll('[data-instruction="MOVE"]')]
  const graphic = graphics.find((item) =>
    item.querySelector('[data-pin-value="IN"]')?.textContent?.trim() === '1')
  if (!graphic) return { present: false, count: graphics.length }
  const box = graphic.querySelector('.ll-instruction-box')?.getBoundingClientRect()
  const heading = graphic.querySelector('.ll-box-heading')
  const terminal = graphic.querySelector('.ll-pin-terminal')
  const left = graphic.querySelector('[data-pin-value="IN"]')
  const right = graphic.querySelector('[data-pin-value="OUT1"]')
  const note = graphic.querySelector('[data-pin-note="OUT1"]')
  const leftRect = left?.getBoundingClientRect()
  const rightRect = right?.getBoundingClientRect()
  const noteRect = note?.getBoundingClientRect()
  const style = (node) => node ? getComputedStyle(node) : null
  return {
    present: true,
    count: graphics.length,
    title: graphic.querySelector('.ll-box-title')?.textContent?.trim() ?? null,
    pins: [...graphic.querySelectorAll('[data-pin]')].map((pin) => pin.getAttribute('data-pin')),
    leftText: left?.textContent?.trim() ?? null,
    rightText: right?.textContent?.trim() ?? null,
    noteText: note?.textContent?.trim() ?? null,
    leftOutside: box && leftRect ? leftRect.right <= box.left + 0.5 : null,
    rightOutside: box && rightRect ? rightRect.left >= box.right - 0.5 : null,
    noteBelowAddress: rightRect && noteRect ? noteRect.top >= rightRect.bottom - 1 : null,
    noLegacyOperand: graphic.querySelectorAll('.ll-box-operand').length === 0,
    box: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null,
    colors: {
      box: style(graphic.querySelector('.ll-instruction-box'))?.fill ?? null,
      heading: style(heading)?.fill ?? null,
      terminal: style(terminal)?.stroke ?? null,
      address: style(right)?.fill ?? null,
    },
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }
})()`)
check(
  'desktop/move-follows-course-ppt-layout',
  openedMoveLab
    && pickedMoveLab
    && moveLayout.present
    && moveLayout.title === 'MOVE'
    && ['EN', 'ENO', 'IN', 'OUT1'].every((pin) => moveLayout.pins.includes(pin))
    && moveLayout.leftText === '1'
    && /^%MB6$/.test(String(moveLayout.rightText))
    && moveLayout.noteText === '"ShiftByte"'
    && moveLayout.leftOutside === true
    && moveLayout.rightOutside === true
    && moveLayout.noteBelowAddress === true
    && moveLayout.noLegacyOperand
    && moveLayout.colors.box === 'rgb(222, 223, 230)'
    && moveLayout.colors.heading === 'rgb(196, 198, 209)'
    && moveLayout.colors.terminal === 'rgb(192, 191, 72)'
    && moveLayout.colors.address === 'rgb(47, 132, 124)'
    && !moveLayout.overflow,
  moveLayout,
)
await evaluate(`[...document.querySelectorAll('[data-instruction="MOVE"]')]
  .find((item) => item.querySelector('[data-pin-value="IN"]')?.textContent?.trim() === '1')
  ?.closest('.ll-rung')?.scrollIntoView({ block: 'center' })`)
await sleep(500)
await screenshot('docs/qa/desktop-move-standard.png')

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

// 手机顶栏的「更多」浮层也必须完整落在视口内，且每个菜单项都点得到。
await evaluate(`document.querySelector('.wb-more .icon-button')?.click()`)
await sleep(300)
const mobileMore = await evaluate(`(() => {
  const menu = document.querySelector('.wb-more-menu')
  if (!menu) return { open: false }
  const rect = menu.getBoundingClientRect()
  const items = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
  const misses = items.filter((item) => {
    const r = item.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !(item === hit || item.contains(hit))
  }).length
  return {
    open: true,
    items: items.length,
    misses,
    fits: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
    rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), right: Math.round(rect.right) },
  }
})()`)
check(
  'mobile/more-menu-usable',
  mobileMore.open && mobileMore.items >= 6 && mobileMore.misses === 0 && mobileMore.fits,
  mobileMore,
)
await screenshot('docs/qa/mobile-more-menu.png')
await evaluate(`document.querySelector('.wb-more .icon-button')?.click()`)
await sleep(250)

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

// 手机端程序段工具栏换到第二行，插入菜单必须完整落在屏幕内。
const mobileTools = await evaluate(`(() => {
  const tools = document.querySelector('.ll-rung-tools')
  if (!tools) return { present: false }
  const rect = tools.getBoundingClientRect()
  return {
    present: true,
    insert: !!tools.querySelector('.ll-insert-trigger'),
    remove: !!tools.querySelector('.ll-tool-remove'),
    inViewport: rect.left >= -1 && rect.right <= innerWidth + 1,
    height: Math.round(rect.height),
  }
})()`)
check('mobile/rung-toolbar-visible', mobileTools.present && mobileTools.insert && mobileTools.remove, mobileTools)
check('mobile/rung-toolbar-in-viewport', mobileTools.inViewport)

// 窄屏段头工具很多，程序段菜单必须固定在可见位置，不能被挤出屏幕。
const mobileSegMenu = await evaluate(`(() => {
  const summary = document.querySelector('.ll-rung-menu > summary')
  if (!summary) return { present: false }
  const rect = summary.getBoundingClientRect()
  return {
    present: true,
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    width: Math.round(rect.width),
    inViewport: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.width >= 40,
  }
})()`)
check('mobile/segment-menu-in-viewport', mobileSegMenu.present && mobileSegMenu.inViewport, mobileSegMenu)
await evaluate(`document.querySelector('.ll-rung-menu > summary')?.click()`)
await sleep(320)
const mobileSegOpen = await evaluate(`(() => {
  const menu = document.querySelector('.ll-rung-menu')
  const panel = document.querySelector('.ll-rung-menu-panel')
  if (!menu?.open || !panel) return { open: false }
  const rect = panel.getBoundingClientRect()
  return {
    open: true,
    fits: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
    items: panel.querySelectorAll('button').length,
  }
})()`)
check('mobile/segment-menu-opens', mobileSegOpen.open && mobileSegOpen.fits && mobileSegOpen.items >= 3, mobileSegOpen)
await screenshot('docs/qa/mobile-segment-menu.png')
await pressEscape()
await sleep(200)

// 手机上没有悬浮插入面板了：先点导线激活插入位，再点该位的 +，走同一个落点菜单。
await evaluate(`document.querySelector('.ll-slot[data-chain=""][data-index="1"] .ll-slot-wire')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(300)
const slotPlusOpened = await evaluate(`(() => {
  const plus = document.querySelector('.ll-slot[data-chain=""][data-index="1"] .ll-slot-plus')
  if (!plus) return false
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await sleep(360)
const mobileMenu = await evaluate(`(() => {
  const menu = document.querySelector('.ll-slot-menu[role="menu"]')
  if (!menu) return { open: false, items: 0 }
  const rect = menu.getBoundingClientRect()
  return {
    open: rect.width > 0,
    items: menu.querySelectorAll('[role="menuitem"]').length,
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    fits: rect.left >= 8
      && rect.right <= innerWidth - 8 + 1
      && rect.top >= 0
      && rect.bottom <= innerHeight + 1,
  }
})()`)
check(
  'mobile/slot-menu-fits',
  slotPlusOpened && mobileMenu.open && mobileMenu.items >= 6 && mobileMenu.fits,
  mobileMenu,
)
const mobileMenuItemHeight = await evaluate(`(() => {
  const items = [...document.querySelectorAll('.ll-slot-menu[role="menu"] [role="menuitem"]')]
  if (items.length === 0) return 0
  return Math.round(Math.min(...items.map((item) => item.getBoundingClientRect().height)))
})()`)
check('mobile/slot-menu-touch-target', mobileMenuItemHeight >= 44, mobileMenuItemHeight)
await screenshot('docs/qa/mobile-rung-menu.png')
await pressEscape()
await sleep(160)

// 手机端点元件应打开底部参数面板，并有遮罩。
await evaluate(`document.querySelector('.ll-node[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(450)
const mobileEditor = await evaluate(`({
  open: !!document.querySelector('.qe-panel'),
  dialog: document.querySelector('.qe-panel')?.getAttribute('role') ?? null,
  scrim: !!document.querySelector('.qe-scrim'),
  heading: document.querySelector('.qe-panel h2')?.textContent?.trim() ?? null,
  modals: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
  propertiesOpen: !!document.querySelector('.wb-context-panel'),
  inViewport: (() => {
    const panel = document.querySelector('.qe-panel')
    if (!panel) return false
    const rect = panel.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
  })(),
})`)
check('mobile/node-opens-sheet', mobileEditor.open && mobileEditor.dialog === 'dialog', mobileEditor)
check('mobile/only-one-modal-layer', mobileEditor.modals === 1 && !mobileEditor.propertiesOpen, mobileEditor)
check('mobile/sheet-shows-contact-editor', String(mobileEditor.heading ?? '').includes('触点'), mobileEditor.heading)
check('mobile/sheet-in-viewport', mobileEditor.inViewport)
await screenshot('docs/qa/mobile-quick-editor.png')

await pressEscape()
check('mobile/escape-closes-sheet', !(await evaluate(`!!document.querySelector('.qe-panel')`)))

// 打开底部「变量」面板时，已选元件要滚到面板上方，不能被盖住。
await evaluate(`document.querySelector('.ll-node[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(420)
await pressEscape()
await sleep(300)
await evaluate(`[...document.querySelectorAll('.wb-tabbar .mobile-tab-action')]
  .find((button) => button.textContent?.trim() === '变量')?.click()`)
await sleep(800)
const mobilePanel = await evaluate(`(() => {
  const panel = document.querySelector('.wb-context-panel')
  const node = document.querySelector('.ll-node.is-selected, .ll-output.is-selected')
  if (!panel || !node) return { panel: !!panel, node: !!node }
  const panelRect = panel.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  return {
    panel: true,
    node: true,
    panelTop: Math.round(panelRect.top),
    nodeTop: Math.round(nodeRect.top),
    nodeBottom: Math.round(nodeRect.bottom),
    visible: nodeRect.top >= 0 && nodeRect.bottom <= panelRect.top + 1,
  }
})()`)
check('mobile/panel-keeps-selection-visible', mobilePanel.panel && mobilePanel.node && mobilePanel.visible, mobilePanel)
await screenshot('docs/qa/mobile-variables-panel.png')
await pressEscape()
await sleep(260)

// 手机端切到指令标签，应能打开指令抽屉。
await evaluate(`[...document.querySelectorAll('.wb-tabbar button')].find((button) => button.textContent?.includes('指令'))?.click()`)
await sleep(450)
const drawer = await evaluate(`!!document.querySelector('.wb-instruction-drawer-backdrop')`)
check('mobile/instructions-reachable', drawer)
await screenshot('docs/qa/mobile-instructions.png')

/* ------------------------------------------------------ 窄屏 360 复核 */

await setViewport(360, 800, true)
await reload(false)
await sleep(700)
const narrowHeader = await evaluate(`(() => {
  const summary = document.querySelector('.ll-rung-menu > summary')
  const tools = document.querySelector('.ll-rung-tools')
  if (!summary || !tools) return { present: false }
  const rect = summary.getBoundingClientRect()
  const toolsRect = tools.getBoundingClientRect()
  return {
    present: true,
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    width: Math.round(rect.width),
    toolsRight: Math.round(toolsRect.right),
    fits: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.width >= 40
      && toolsRect.left >= -1 && toolsRect.right <= innerWidth + 1,
  }
})()`)
check('mobile/360-header-fits', narrowHeader.present && narrowHeader.fits, narrowHeader)
await screenshot('docs/qa/mobile-360.png')

await evaluate(`document.querySelector('.ll-node[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(420)
await pressEscape()
await sleep(300)
await evaluate(`[...document.querySelectorAll('.wb-tabbar .mobile-tab-action')]
  .find((button) => button.textContent?.trim() === '变量')?.click()`)
await sleep(800)
const narrowPanel = await evaluate(`(() => {
  const panel = document.querySelector('.wb-context-panel')
  const node = document.querySelector('.ll-node.is-selected, .ll-output.is-selected')
  if (!panel || !node) return { panel: !!panel, node: !!node }
  const panelRect = panel.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  return {
    panel: true,
    node: true,
    panelTop: Math.round(panelRect.top),
    nodeTop: Math.round(nodeRect.top),
    nodeBottom: Math.round(nodeRect.bottom),
    visible: nodeRect.top >= 0 && nodeRect.bottom <= panelRect.top + 1,
  }
})()`)
check('mobile/360-panel-keeps-selection-visible', narrowPanel.panel && narrowPanel.node && narrowPanel.visible, narrowPanel)
await screenshot('docs/qa/mobile-360-panel.png')
await pressEscape()

socket.close()
console.log(JSON.stringify({ checks, details, demoState, editor, mobileFirst, mobileDemo, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || errors.length > 0) process.exitCode = 1
