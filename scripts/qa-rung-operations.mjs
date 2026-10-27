/**
 * 程序段级操作回归：拖动排序、复制、剪切、粘贴、删除和撤销。
 *
 * 用法：先启动生产预览，再以远程调试端口启动 Edge/Chrome，最后运行
 * `npm run qa:rungs`。默认连接 http://127.0.0.1:9222 与 4173 端口，
 * 也可用 LADDERLAB_CDP / LADDERLAB_URL 覆盖。
 */
const CDP_HTTP = process.env.LADDERLAB_CDP ?? 'http://127.0.0.1:9222'
const APP_URL = process.env.LADDERLAB_URL ?? 'http://127.0.0.1:4173/'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

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
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function waitForApp(timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = await evaluate(
      `document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')`,
    ).catch(() => false)
    if (ready) return
    await sleep(200)
  }
  throw new Error(`等待页面就绪超时：${APP_URL}`)
}

async function reload(clearStorage = false) {
  if (clearStorage) {
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(320)
    await send('Storage.clearDataForOrigin', {
      origin: new URL(APP_URL).origin,
      storageTypes: 'local_storage',
    })
  }
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  await sleep(300)
}

async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  })
  await send('Emulation.setTouchEmulationEnabled', {
    enabled: mobile,
    maxTouchPoints: mobile ? 5 : 1,
  })
}

async function pressKey(key, code, vk, modifiers = 0) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(320)
}

async function pointOf(selector, index = 0) {
  return evaluate(`(() => {
    const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!node) return null
    node.scrollIntoView({ block: 'center', inline: 'nearest' })
    const box = node.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })()`)
}

async function click(selector, index = 0) {
  const point = await pointOf(selector, index)
  if (!point) throw new Error(`找不到可点击元素：${selector}[${index}]`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await sleep(280)
}

async function clickVisibleMenuItem(label) {
  const point = await evaluate(`(() => {
    const panel = [...document.querySelectorAll('.ll-rung-menu-panel')]
      .find((node) => node.closest('details')?.open)
    const item = [...(panel?.querySelectorAll('button') ?? [])]
      .find((node) => node.textContent.includes(${JSON.stringify(label)}))
    if (!item) return { missing: true }
    if (item.disabled) return { disabled: true }
    const box = item.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })()`)
  if (point.missing) throw new Error(`菜单项不存在：${label}`)
  if (point.disabled) throw new Error(`菜单项不可用：${label}`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await sleep(380)
}

async function dragRungToBoundary(rungIndex, boundary) {
  const source = await pointOf('.ll-rung-drag', rungIndex)
  if (!source) throw new Error(`找不到第 ${rungIndex + 1} 段的拖动手柄`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: source.x,
    y: source.y,
    button: 'none',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: source.x,
    y: source.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: source.x + 12,
    y: source.y + 10,
    button: 'left',
    buttons: 1,
  })
  await sleep(140)
  const drop = await pointOf('.ll-rung-dropzone', boundary)
  if (!drop) throw new Error(`找不到第 ${boundary} 个段间插入线`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: drop.x,
    y: drop.y,
    button: 'left',
    buttons: 1,
  })
  await sleep(100)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: drop.x,
    y: drop.y,
    button: 'left',
    buttons: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: drop.x,
    y: drop.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await sleep(480)
}

async function rungIds() {
  return evaluate(`[...document.querySelectorAll('.ll-rung')].map((node) => node.dataset.rungId)`)
}

async function selectedRungId() {
  return evaluate(`document.querySelector('.ll-rung.is-whole-selected')?.dataset.rungId ?? null`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

await send('Page.enable')
await send('Runtime.enable')
await setViewport(1440, 1000)
await reload(true)

await evaluate(`document.querySelector('.wb-coach-demo')?.click()`)
await sleep(600)
await evaluate(`document.querySelector('.wb-context-panel button[aria-label="关闭属性面板"]')?.click()`)
await sleep(260)

// 从一段示例扩成三段，用真实按钮创建，不用测试专用状态注入。
for (let i = 0; i < 2; i += 1) {
  await evaluate(`document.querySelector('.ll-add-rung')?.click()`)
  await sleep(420)
}

let ids = await rungIds()
assert(ids.length === 3, `准备阶段应有 3 个程序段，实际 ${ids.length}`)

// 点标题栏选整段；输出线圈仍是独立选择，Delete 不得误删整段。
await click('.ll-rung-drag', 0)
assert((await selectedRungId()) === ids[0], '点击段标题后没有选中整段')
assert(await evaluate(`document.querySelectorAll('.ll-rung.is-whole-selected').length === 1`), '整段高亮状态不唯一')

await click('.ll-rung [data-output-id]', 0)
assert(await evaluate(`document.querySelectorAll('.ll-rung.is-whole-selected').length === 0`), '点输出线圈后仍保留整段选中，状态混淆')
await pressKey('Delete', 'Delete', 46)
assert((await rungIds()).length === 3, '选中输出线圈时 Delete 误删了整段')

// 段间插入线：第一段拖到末尾，再撤销恢复。
await dragRungToBoundary(0, 3)
let actual = await rungIds()
assert(actual.join(',') === [ids[1], ids[2], ids[0]].join(','), `拖动排序结果错误：${actual.join(',')}`)
await pressKey('z', 'KeyZ', 90, 2)
actual = await rungIds()
assert(actual.join(',') === ids.join(','), `拖动后的撤销没有恢复原顺序：${actual.join(',')}`)

// 复制第一段，粘到第二段之后；连续再粘一次必须继续向后追加。
await click('.ll-rung-drag', 0)
await pressKey('c', 'KeyC', 67, 2)
await click('.ll-rung-drag', 1)
await pressKey('v', 'KeyV', 86, 2)
actual = await rungIds()
assert(actual.length === 4, `第一次粘贴后应有 4 段，实际 ${actual.length}`)
let selected = await selectedRungId()
assert(actual.indexOf(selected) === 2, '第一次粘贴没有落在选中段之后')
await pressKey('v', 'KeyV', 86, 2)
actual = await rungIds()
assert(actual.length === 5, `连续粘贴后应有 5 段，实际 ${actual.length}`)
assert(new Set(actual).size === actual.length, '连续粘贴产生了重复的程序段 ID')
selected = await selectedRungId()
assert(actual.indexOf(selected) === 3, '连续粘贴没有接在上一份副本之后')

// 剪切最后一段，再粘到第一段之后；撤销应恢复粘贴前的四段状态。
const beforeCut = await rungIds()
const cutId = beforeCut.at(-1)
await click('.ll-rung-drag', beforeCut.length - 1)
assert((await selectedRungId()) === cutId, '准备剪切时没有选中最后一段')
await pressKey('x', 'KeyX', 88, 2)
actual = await rungIds()
assert(actual.length === 4 && !actual.includes(cutId), 'Ctrl+X 没有移除原程序段')
const firstAfterCut = actual[0]
await click('.ll-rung-drag', 0)
await pressKey('v', 'KeyV', 86, 2)
actual = await rungIds()
assert(actual.length === 5, `剪切粘贴后应有 5 段，实际 ${actual.length}`)
assert(actual[0] === firstAfterCut && actual[1] !== cutId, '剪切粘贴没有插入到当前段之后')
await pressKey('z', 'KeyZ', 90, 2)
assert((await rungIds()).length === 4, '撤销剪切粘贴没有恢复四段状态')

// 整段 Delete 与 Ctrl+Z；删除选中输出时已在上方单独验证。
await click('.ll-rung-drag', 0)
const deletedId = await selectedRungId()
await pressKey('Delete', 'Delete', 46)
actual = await rungIds()
assert(actual.length === 3 && !actual.includes(deletedId), '选中整段后 Delete 没有删除程序段')
await pressKey('z', 'KeyZ', 90, 2)
actual = await rungIds()
assert(actual.length === 4 && actual.includes(deletedId), 'Delete 后撤销没有恢复原程序段')

// 菜单必须完整暴露同类操作，并真的能执行上下移动。
await click('.ll-rung-menu summary', 1)
const menu = await evaluate(`(() => {
  const panel = [...document.querySelectorAll('.ll-rung-menu-panel')]
    .find((node) => node.closest('details')?.open)
  if (!panel) return null
  const box = panel.getBoundingClientRect()
  return {
    labels: [...panel.querySelectorAll('button')].map((node) => node.textContent.trim()),
    fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
  }
})()`)
assert(menu, '程序段菜单没有打开')
for (const label of ['剪切程序段', '复制程序段', '粘贴程序段', '上移', '下移', '创建副本', '删除程序段']) {
  assert(menu.labels.some((item) => item.includes(label)), `菜单缺少“${label}”`)
}
assert(menu.fits, '桌面端程序段菜单超出视口')

const beforeMenuMove = await rungIds()
assert(beforeMenuMove[1] === await selectedRungId(), '菜单操作前没有选中第二段')
await clickVisibleMenuItem('上移')
actual = await rungIds()
assert(actual[0] === beforeMenuMove[1] && actual[1] === beforeMenuMove[0], '菜单“上移”没有交换相邻程序段')
await pressKey('z', 'KeyZ', 90, 2)

// 手机宽度下，段菜单仍完整落在视口内，页面不横向溢出。
await setViewport(390, 844, true)
await sleep(420)
await click('.ll-rung-menu summary', 0)
await sleep(300)
const mobile = await evaluate(`(() => {
  const panel = [...document.querySelectorAll('.ll-rung-menu-panel')]
    .find((node) => node.closest('details')?.open)
  if (!panel) return null
  const box = panel.getBoundingClientRect()
  return {
    fits: box.left >= 0 && box.right <= innerWidth + 1,
    box: {
      left: Math.round(box.left),
      right: Math.round(box.right),
      top: Math.round(box.top),
      bottom: Math.round(box.bottom),
    },
    viewport: [innerWidth, innerHeight],
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})()`)
assert(mobile?.fits, `手机端程序段菜单超出视口：${JSON.stringify(mobile)}`)
assert(!mobile.overflow, '手机端出现横向页面溢出')
assert(errors.length === 0, `浏览器控制台出现错误：${errors.join(' | ')}`)

socket.close()
console.log(JSON.stringify({
  ok: true,
  checks: {
    wholeRungSelection: true,
    outputDeleteGuard: true,
    dragReorder: true,
    undoReorder: true,
    copyPaste: true,
    continuousPaste: true,
    cutPaste: true,
    deleteUndo: true,
    menuOperations: true,
    mobileLayout: true,
  },
}, null, 2))
