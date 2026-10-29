/**
 * 打赏/Star 小浮标的真实浏览器验收：尺寸、鼠标与触屏拖动、记忆落点、
 * 拖后不误触、面板避让、键盘移动和窗口缩放。
 *
 * 用法：先 `npm run preview`，再启动带调试端口的 Edge，然后运行
 * `npm run qa:badge`。
 */
import { resolve } from 'node:path'
import {
  closeQaPage,
  connectToPage,
  createQaPage,
  DEFAULT_QA_APP_URL,
  DEFAULT_QA_CDP,
} from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const checks = []
let target
let client
const pageErrors = []

function check(name, pass, detail = '') {
  checks.push({ name, pass: Boolean(pass), detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  target = await createQaPage(CDP_HTTP)
  client = await connectToPage(target)
  const { send, onEvent } = client

  onEvent((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      const text = message.params.exceptionDetails?.exception?.description
        ?? message.params.exceptionDetails?.text
        ?? 'exception'
      if (!text.includes('chrome-extension://')) pageErrors.push(text)
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
      if (text) pageErrors.push(text)
    }
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setBypassServiceWorker', { bypass: true })

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

  async function waitForApp(timeout = 12000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const ready = await evaluate(
        "document.readyState !== 'loading' && !!document.querySelector('.support-badge-pill')",
      ).catch(() => false)
      if (ready) return
      await sleep(150)
    }
    throw new Error(`等待小浮标超时：${APP_URL}`)
  }

  async function reload(clearStorage = false) {
    if (clearStorage) {
      await send('Page.navigate', { url: 'about:blank' })
      await sleep(250)
      await send('Storage.clearDataForOrigin', {
        origin: new URL(APP_URL).origin,
        storageTypes: 'local_storage,service_workers',
      })
    }
    await send('Page.navigate', { url: APP_URL })
    await waitForApp()
    await sleep(350)
  }

  async function badgeGeometry() {
    return evaluate(`(() => {
      const root = document.querySelector('.support-badge')
      const pill = document.querySelector('.support-badge-pill')
      const trigger = document.querySelector('.support-badge-trigger')
      const star = document.querySelector('.support-badge-star')
      const rect = (node) => {
        const box = node.getBoundingClientRect()
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
      }
      return {
        root: rect(root), pill: rect(pill), trigger: rect(trigger), star: rect(star),
        viewport: { width: innerWidth, height: innerHeight },
        open: root.dataset.open === 'true',
        panel: document.querySelector('.support-badge-panel')?.getBoundingClientRect().toJSON() ?? null,
        anchor: JSON.parse(localStorage.getItem('ladderlab.support-badge.anchor') || 'null'),
      }
    })()`)
  }

  async function mouseDrag(from, to) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' })
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1,
    })
    for (let step = 1; step <= 8; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / 8
      const y = from.y + ((to.y - from.y) * step) / 8
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1,
    })
    await sleep(300)
  }

  async function mouseClick(point) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' })
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
    })
    await sleep(250)
  }

  async function touchDrag(from, to) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, radiusX: 4, radiusY: 4, id: 1 }],
    })
    for (let step = 1; step <= 8; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / 8
      const y = from.y + ((to.y - from.y) * step) / 8
      await send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, id: 1 }],
      })
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(350)
  }

  async function touchTap(point) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, radiusX: 4, radiusY: 4, id: 1 }],
    })
    // 稳定按住一小段时间，避免 CDP 把紧贴在拖动之后的瞬时 down/up 合并掉。
    await sleep(80)
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(280)
  }

  async function executeKey(key, vk, modifiers = 0) {
    await send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers,
    })
    await sleep(180)
  }

  async function pageTargets() {
    const response = await fetch(`${CDP_HTTP}/json`)
    return (await response.json()).filter((item) => item.type === 'page')
  }

  await setViewport(1440, 900)
  await reload(true)
  let geometry = await badgeGeometry()
  check(
    'desktop/pill-is-small',
    geometry.pill.width <= 68 && geometry.pill.height <= 36,
    `${geometry.pill.width}×${geometry.pill.height}`,
  )
  check(
    'desktop/defaults-bottom-left',
    geometry.root.left <= 16 && geometry.root.bottom >= geometry.viewport.height - 52,
    `left=${geometry.root.left}, bottom=${geometry.root.bottom}`,
  )

  const targetsBeforeTriggerDrag = new Set((await pageTargets()).map((item) => item.id))
  await mouseDrag(
    { x: geometry.trigger.left + geometry.trigger.width / 2, y: geometry.trigger.top + geometry.trigger.height / 2 },
    { x: 40, y: 40 },
  )
  geometry = await badgeGeometry()
  const afterTriggerDragTargets = await pageTargets()
  check('desktop/trigger-drag-moves', geometry.root.left <= 40 && geometry.root.top <= 40)
  check('desktop/trigger-drag-does-not-open-panel', !geometry.open && !geometry.panel)
  check(
    'desktop/trigger-drag-does-not-navigate',
    afterTriggerDragTargets.every((item) => targetsBeforeTriggerDrag.has(item.id)),
  )
  check('desktop/anchor-is-saved', !!geometry.anchor, JSON.stringify(geometry.anchor))

  await reload(false)
  geometry = await badgeGeometry()
  check('desktop/position-restores-after-reload', geometry.root.left <= 40 && geometry.root.top <= 40)

  const targetsBeforeStarDrag = new Set((await pageTargets()).map((item) => item.id))
  await mouseDrag(
    { x: geometry.star.left + geometry.star.width / 2, y: geometry.star.top + geometry.star.height / 2 },
    { x: 1410, y: 825 },
  )
  geometry = await badgeGeometry()
  check(
    'desktop/star-drag-stays-in-viewport',
    geometry.root.right <= geometry.viewport.width - 10 && geometry.root.bottom <= geometry.viewport.height - 10,
    `right=${geometry.root.right}, bottom=${geometry.root.bottom}`,
  )
  check(
    'desktop/star-drag-does-not-navigate',
    (await pageTargets()).every((item) => targetsBeforeStarDrag.has(item.id)),
  )

  await mouseClick({
    x: geometry.trigger.left + geometry.trigger.width / 2,
    y: geometry.trigger.top + geometry.trigger.height / 2,
  })
  geometry = await badgeGeometry()
  check('desktop/coffee-click-opens-panel', geometry.open && !!geometry.panel)
  check(
    'desktop/panel-stays-in-viewport',
    !!geometry.panel
      && geometry.panel.left >= 10
      && geometry.panel.top >= 10
      && geometry.panel.right <= geometry.viewport.width - 10
      && geometry.panel.bottom <= geometry.viewport.height - 10,
    JSON.stringify(geometry.panel),
  )

  await executeKey('Escape', 27)
  geometry = await badgeGeometry()
  check('desktop/escape-closes-panel', !geometry.open && !geometry.panel)
  check(
    'desktop/escape-restores-trigger-focus',
    await evaluate("document.activeElement?.classList.contains('support-badge-trigger')"),
  )

  const beforeKeyboard = geometry.root.left
  await executeKey('ArrowLeft', 37, 1)
  geometry = await badgeGeometry()
  check(
    'desktop/keyboard-alt-arrow-moves',
    geometry.root.left < beforeKeyboard && geometry.root.left >= 10,
    `${beforeKeyboard} -> ${geometry.root.left}`,
  )

  await send('Emulation.setDeviceMetricsOverride', {
    width: 360, height: 520, deviceScaleFactor: 1, mobile: false,
  })
  await sleep(300)
  geometry = await badgeGeometry()
  check(
    'desktop/resize-keeps-badge-visible',
    geometry.root.left >= 7 && geometry.root.right <= geometry.viewport.width - 7,
    `${geometry.root.left}..${geometry.root.right} / ${geometry.viewport.width}`,
  )

  await setViewport(390, 844, true)
  await reload(true)
  geometry = await badgeGeometry()
  check(
    'mobile/default-sits-above-bottom-bar',
    geometry.root.bottom <= geometry.viewport.height - 88,
    `bottom=${geometry.root.bottom}, height=${geometry.viewport.height}`,
  )

  await touchDrag(
    { x: geometry.trigger.left + geometry.trigger.width / 2, y: geometry.trigger.top + geometry.trigger.height / 2 },
    { x: 360, y: 70 },
  )
  geometry = await badgeGeometry()
  check(
    'mobile/touch-drag-moves',
    geometry.root.top <= 70 && geometry.root.right <= geometry.viewport.width - 7,
    `top=${geometry.root.top}, right=${geometry.root.right}`,
  )
  check('mobile/touch-drag-does-not-open-panel', !geometry.open && !geometry.panel)

  const mobileTapPoint = {
    x: geometry.trigger.left + geometry.trigger.width / 2,
    y: geometry.trigger.top + geometry.trigger.height / 2,
  }
  await touchTap(mobileTapPoint)
  geometry = await badgeGeometry()
  check('mobile/touch-tap-opens-panel', geometry.open && !!geometry.panel)
  check(
    'mobile/panel-stays-in-viewport',
    !!geometry.panel
      && geometry.panel.left >= 7
      && geometry.panel.top >= 7
      && geometry.panel.right <= geometry.viewport.width - 7
      && geometry.panel.bottom <= geometry.viewport.height - 7,
    JSON.stringify(geometry.panel),
  )

  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const shotPath = resolve(process.env.TEMP ?? '.', 'ladderlab-support-badge-mobile.png')
  await (await import('node:fs/promises')).writeFile(shotPath, Buffer.from(shot.data, 'base64'))
  console.log(`SCREENSHOT ${shotPath}`)

  await touchTap({ x: 12, y: 420 })
  check('mobile/blank-tap-closes-panel', !(await badgeGeometry()).open)
} finally {
  try {
    client?.close()
  } catch {}
  if (target) await closeQaPage(CDP_HTTP, target.id)
}

check('console/no-errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 600))
const failed = checks.filter((item) => !item.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) process.exitCode = 1
