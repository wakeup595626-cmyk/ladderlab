/**
 * Resizable drafting-sheet regression: default composition, both drag handles,
 * reset paths, persistence, split view, and phone overflow.
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
      `document.readyState !== 'loading' && !!document.querySelector('.wb-program-frame')`,
    ).catch(() => false)
    if (ready) return
    await sleep(200)
  }
  throw new Error(`等待页面就绪超时：${APP_URL}`)
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
  await send('Emulation.setEmulatedMedia', {
    features: mobile
      ? [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }]
      : [{ name: 'pointer', value: 'fine' }, { name: 'any-pointer', value: 'fine' }],
  })
}

async function reload() {
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  await sleep(300)
}

async function screenshot(path) {
  await evaluate(
    `document.querySelectorAll('plasmo-csui, #dx-sibebar-container').forEach((node) => node.remove())`,
  ).catch(() => {})
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

async function sheetMetrics() {
  return evaluate(`(() => {
    const pane = document.querySelector('.wb-program-pane')
    const frame = document.querySelector('.wb-program-frame')
    const right = document.querySelector('.wb-program-resizer.is-right')
    const left = document.querySelector('.wb-program-resizer.is-left')
    if (!pane || !frame || !right || !left) return null
    const paneBox = pane.getBoundingClientRect()
    const frameBox = frame.getBoundingClientRect()
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      paneWidth: paneBox.width,
      frameWidth: frameBox.width,
      frameLeft: frameBox.left,
      frameRight: frameBox.right,
      leftGutter: frameBox.left - paneBox.left,
      rightGutter: paneBox.right - frameBox.right,
      leftHandleDisplay: getComputedStyle(left).display,
      rightHandleDisplay: getComputedStyle(right).display,
      storedWidth: localStorage.getItem('ladderlab.program-sheet.width.v1'),
    }
  })()`)
}

async function handleCenter(side) {
  return evaluate(`(() => {
    const box = document.querySelector('.wb-program-resizer.is-${side}').getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + 72 }
  })()`)
}

async function dragHandle(side, deltaX) {
  const start = await handleCenter(side)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: start.x,
    y: start.y,
    button: 'none',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: start.x,
    y: start.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: start.x + deltaX,
    y: start.y,
    button: 'left',
    buttons: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: start.x + deltaX,
    y: start.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await sleep(380)
}

async function doubleClickHandle(side) {
  const point = await handleCenter(side)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
  })
  for (const clickCount of [1, 2]) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount,
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount,
    })
  }
  await sleep(360)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

await send('Page.enable')
await send('Runtime.enable')
await setViewport(1699, 935)
await send('Page.navigate', { url: 'about:blank' })
await sleep(250)
await send('Storage.clearDataForOrigin', {
  origin: new URL(APP_URL).origin,
  storageTypes: 'local_storage',
})
await reload()

await evaluate(`document.querySelector('.wb-coach-demo')?.click()`)
await sleep(650)
await evaluate(`document.querySelector('.wb-context-panel button[aria-label="关闭属性面板"]')?.click()`)
await sleep(320)

const initial = await sheetMetrics()
assert(initial, '没有找到程序区图纸或拖动柄')
assert(Math.abs(initial.frameWidth - 1360) <= 1, `默认宽度不是 1360px：${initial.frameWidth}`)
assert(initial.leftGutter >= 120 && initial.rightGutter >= 120, '默认图纸没有形成左右灰色留白')
assert(initial.leftHandleDisplay !== 'none', '桌面左拖动柄没有显示')
assert(initial.rightHandleDisplay !== 'none', '桌面右拖动柄没有显示')
await screenshot('docs/qa/desktop-sheet-default.png')

const leftHover = await handleCenter('left')
await send('Input.dispatchMouseEvent', {
  type: 'mouseMoved',
  x: leftHover.x,
  y: leftHover.y,
  button: 'none',
})
await sleep(220)
const hoverTip = await evaluate(`(() => {
  const tip = document.querySelector('.wb-program-resizer.is-left .wb-program-resizer-tip')
  if (!tip) return null
  const box = tip.getBoundingClientRect()
  return {
    text: tip.textContent.trim(),
    opacity: getComputedStyle(tip).opacity,
    left: box.left,
    right: box.right,
    inViewport: box.left >= 0 && box.right <= innerWidth,
  }
})()`)
assert(hoverTip?.text.includes('拖动调宽'), '拖动柄悬停后没有出现操作提示')
assert(hoverTip.opacity === '1', `拖动柄提示没有显示：${hoverTip.opacity}`)
assert(hoverTip.inViewport, '拖动柄提示被裁切')
await screenshot('docs/qa/desktop-sheet-hover.png')

await dragHandle('right', 90)
const draggedRight = await sheetMetrics()
assert(draggedRight.frameWidth > initial.frameWidth + 150, '向右拖动没有放大图纸')
assert(Math.abs(draggedRight.storedWidth - draggedRight.frameWidth) <= 1, '宽度没有写入存储')

await dragHandle('left', -60)
const draggedLeft = await sheetMetrics()
assert(draggedLeft.frameWidth > draggedRight.frameWidth + 90, '向左拖动没有继续放大图纸')
await screenshot('docs/qa/desktop-sheet-resized.png')

await reload()
const restored = await sheetMetrics()
assert(Math.abs(restored.frameWidth - draggedLeft.frameWidth) <= 1, '刷新后没有恢复自定义宽度')

await doubleClickHandle('right')
const reset = await sheetMetrics()
assert(Math.abs(reset.frameWidth - 1360) <= 1, `双击后没有恢复 1360px：${reset.frameWidth}`)

await evaluate(`document.querySelector('.wb-program-resizer.is-right')?.focus()`)
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'ArrowRight',
  code: 'ArrowRight',
  windowsVirtualKeyCode: 39,
})
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'ArrowRight',
  code: 'ArrowRight',
  windowsVirtualKeyCode: 39,
})
await sleep(220)
const keyboardResized = await sheetMetrics()
assert(keyboardResized.frameWidth > reset.frameWidth, '方向键没有调整图纸宽度')

await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Home',
  code: 'Home',
  windowsVirtualKeyCode: 36,
})
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Home',
  code: 'Home',
  windowsVirtualKeyCode: 36,
})
await sleep(220)
const keyboardReset = await sheetMetrics()
assert(Math.abs(keyboardReset.frameWidth - 1360) <= 1, 'Home 键没有恢复默认宽度')

await evaluate(`[...document.querySelectorAll('.wb-doc-action')]
  .find((button) => button.textContent?.includes('变量表'))?.click()`)
await sleep(450)
const splitView = await sheetMetrics()
assert(splitView.paneWidth < initial.paneWidth, '打开属性栏后程序区没有让出空间')
assert(
  splitView.frameWidth <= splitView.paneWidth - 40,
  '打开属性栏后图纸没有适配剩余空间',
)
await screenshot('docs/qa/desktop-sheet-split.png')
await evaluate(`document.querySelector('.wb-context-panel button[aria-label="关闭属性面板"]')?.click()`)
await sleep(300)

await setViewport(390, 844, true)
await reload()
const mobile = await sheetMetrics()
assert(mobile.frameWidth <= mobile.viewportWidth - 24, '手机端图纸超出可用宽度')
assert(mobile.rightHandleDisplay === 'none', '手机端仍显示了桌面拖动柄')
assert(mobile.documentWidth <= mobile.viewportWidth, `手机端出现横向溢出：${mobile.documentWidth}`)
await screenshot('docs/qa/mobile-sheet-default.png')

assert(errors.length === 0, `浏览器控制台出现错误：${errors.join(' | ')}`)
await writeFile(
  resolve('docs/qa/program-sheet-results.json'),
  JSON.stringify({ initial, draggedRight, draggedLeft, restored, reset, keyboardResized, splitView, mobile }, null, 2),
)
console.log('Program sheet QA PASS')
socket.close()
