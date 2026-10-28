/** 首次使用引导与移动端布局的浏览器验收脚本（CDP）。 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_QA_APP_URL, DEFAULT_QA_CDP, selectExactPage } from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const GUIDE_KEY = 'ladderlab.guide.v1'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const QA_DIR = resolve('docs/qa')
await mkdir(QA_DIR, { recursive: true })

const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
const page = selectExactPage(targets, APP_URL, CDP_HTTP)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', rejectOpen, { once: true })
})

let nextId = 0
const pending = new Map()
const errors = []

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolveCommand, rejectCommand) => {
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails?.exception?.description ?? 'exception')
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '))
  }
})

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  })
}

async function reloadFresh() {
  await evaluate(`window.localStorage.removeItem(${JSON.stringify(GUIDE_KEY)})`)
  await send('Page.navigate', { url: APP_URL })
  await sleep(900)
}

async function screenshot(path) {
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

async function screenshotFull(path) {
  const metrics = await send('Page.getLayoutMetrics')
  const size = metrics.cssContentSize
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
  })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

const checks = {}
function check(name, value) {
  checks[name] = Boolean(value)
}

await send('Page.enable')
await send('Runtime.enable')

// 桌面：首次进入自动打开引导。
await setViewport(1600, 1000, false)
await reloadFresh()

const desktopGuide = await evaluate(`(() => {
  const backdrop = document.querySelector('.guide-backdrop')
  const sheet = document.querySelector('.guide-sheet')
  if (!backdrop || !sheet) return { open: false }
  const rect = sheet.getBoundingClientRect()
  return {
    open: true,
    focused: document.activeElement?.classList.contains('guide-primary') ?? false,
    fits: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
    scrolls: sheet.scrollHeight > sheet.clientHeight ? getComputedStyle(sheet).overflowY !== 'visible' : true,
    steps: document.querySelectorAll('.guide-step').length,
  }
})()`)
check('desktop/guide-opens', desktopGuide.open)
check('desktop/primary-focused', desktopGuide.focused)
check('desktop/guide-fits', desktopGuide.fits)
check('desktop/guide-scrollable', desktopGuide.scrolls)
check('desktop/four-steps', desktopGuide.steps === 4)
await screenshot('docs/qa/guide-desktop.png')

// 主按钮：载入启保停、自动运行，并切到变量表。
await evaluate(`document.querySelector('.guide-primary').click()`)
await sleep(1000)
const demo = await evaluate(`({
  guideClosed: !document.querySelector('.guide-backdrop'),
  powered: [...document.querySelectorAll('.ll-rung')].filter((rung) => rung.classList.contains('is-powered')).length,
  tagsVisible: !!document.querySelector('.tag-list'),
  activeTab: document.querySelector('.inspector-tabs button.active')?.textContent?.trim(),
  running: document.querySelector('.run-button')?.getAttribute('aria-pressed') === 'true',
  startButton: [...document.querySelectorAll('.tag-card')].some((card) => card.querySelector('.tag-name-input')?.value === 'StartBtn'),
})`)
check('desktop/cta-closes-guide', demo.guideClosed)
check('desktop/cta-runs-demo', demo.running)
check('desktop/cta-opens-tags', demo.tagsVisible && demo.startButton)
check('desktop/cta-active-tab', String(demo.activeTab ?? '').includes('变量表'))

// 按引导提示点一下 StartBtn，电机应自锁并保持。
await evaluate(`(() => {
  const card = [...document.querySelectorAll('.tag-card')].find((item) => item.querySelector('.tag-name-input')?.value === 'StartBtn')
  card?.querySelector('.live-value')?.click()
})()`)
await sleep(450)
const motorStarted = await evaluate(`({
  powered: [...document.querySelectorAll('.ll-rung')].filter((rung) => rung.classList.contains('is-powered')).length,
  motor: [...document.querySelectorAll('.tag-card')].find((card) => card.querySelector('.tag-name-input')?.value === 'Motor')?.querySelector('.live-value')?.textContent?.trim(),
})`)
check('desktop/cta-motor-starts', motorStarted.powered >= 1 && motorStarted.motor === 'TRUE')
await screenshot('docs/qa/guide-demo.png')

// 关闭后不再自动出现；右上角可重新打开；ESC 与背景点击都能关闭。
await send('Page.reload')
await sleep(900)
check('desktop/no-repeat', !(await evaluate(`!!document.querySelector('.guide-backdrop')`)))
await evaluate(`document.querySelector('.guide-button').click()`)
await sleep(250)
check('desktop/reopen', await evaluate(`!!document.querySelector('.guide-backdrop')`))
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(250)
check('desktop/escape-closes', !(await evaluate(`!!document.querySelector('.guide-backdrop')`)))
await evaluate(`document.querySelector('.guide-button').click()`)
await sleep(250)
await evaluate(`document.querySelector('.guide-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
await sleep(250)
check('desktop/backdrop-closes', !(await evaluate(`!!document.querySelector('.guide-backdrop')`)))

// 手机：弹层与主界面都不横向溢出。
await setViewport(390, 844, true)
await reloadFresh()
const mobileGuide = await evaluate(`(() => {
  const sheet = document.querySelector('.guide-sheet')
  if (!sheet) return { open: false }
  const rect = sheet.getBoundingClientRect()
  return {
    open: true,
    fitsWidth: rect.left >= 0 && rect.right <= innerWidth + 1,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollable: sheet.scrollHeight <= sheet.clientHeight || ['auto', 'scroll'].includes(getComputedStyle(sheet).overflowY),
  }
})()`)
check('mobile/guide-opens', mobileGuide.open)
check('mobile/guide-fits-width', mobileGuide.fitsWidth)
check('mobile/guide-no-page-overflow', !mobileGuide.pageOverflow)
check('mobile/guide-scrollable', mobileGuide.scrollable)
await screenshot('docs/qa/guide-mobile.png')

await evaluate(`document.querySelector('.guide-secondary').click()`)
await sleep(400)
await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`)
const mobileLayout = await evaluate(`({
  noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  toolbarHeight: document.querySelector('.toolbar')?.getBoundingClientRect().height,
  cssWidth: innerWidth,
})`)
check('mobile/page-no-overflow', mobileLayout.noOverflow)
await screenshot('docs/qa/screenshot-mobile.png')
await screenshotFull('docs/qa/screenshot-mobile-full.png')

socket.close()
console.log(JSON.stringify({ checks, demo, mobileLayout, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || errors.length > 0) process.exitCode = 1
