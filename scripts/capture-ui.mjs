/** 交互式 UI 快速验证：需要 preview 服务与专用 QA Chromium 的 CDP 端口 9444。 */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_QA_APP_URL, DEFAULT_QA_CDP, selectExactPage } from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const output = resolve(process.argv[2] ?? 'docs/screenshot.png')
const viewportWidth = Number(process.env.LADDERLAB_WIDTH ?? 1600)
const viewportHeight = Number(process.env.LADDERLAB_HEIGHT ?? 1000)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

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
  } else if (message.method === 'Page.javascriptDialogOpening') {
    void send('Page.handleJavaScriptDialog', { accept: true })
  } else if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    if (JSON.stringify(details).includes('chrome-extension://')) return
    errors.push(details?.exception?.description ?? details?.text ?? 'exception')
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '))
  }
})

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: viewportWidth,
  height: viewportHeight,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: 'about:blank' })
await sleep(320)
await send('Storage.clearDataForOrigin', {
  origin: new URL(APP_URL).origin,
  storageTypes: 'local_storage',
})
await send('Page.navigate', { url: APP_URL })
for (let attempt = 0; attempt < 60; attempt += 1) {
  const ready = await send('Runtime.evaluate', {
    expression: `document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')`,
    returnByValue: true,
  }).then((result) => result.result.value).catch(() => false)
  if (ready) break
  if (attempt === 59) throw new Error(`等待页面就绪超时：${APP_URL}`)
  await sleep(200)
}
await sleep(250)

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

async function click(selector) {
  const clicked = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return false
    element.click(); return true
  })()`)
  if (!clicked) throw new Error(`找不到元素：${selector}`)
}

// 如果使用指南正开着，先关掉它，再进入可编辑工作台。
await evaluate(`(() => {
  const backdrop = document.querySelector('.guide-backdrop')
  if (!backdrop) return 'not-open'
  backdrop.querySelector('.guide-secondary')?.click()
  return 'closed'
})()`)
await sleep(300)
await evaluate(`window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`)

await click('.wb-coach-demo')
await sleep(800)

const startButton = `(() => {
  const card = [...document.querySelectorAll('.tag-card')].find((item) => item.querySelector('input')?.value === 'StartBtn')
  const button = card?.querySelector('.live-value')
  if (!button) return false
  button.click(); return true
})()`
if (!(await evaluate(startButton))) throw new Error('变量表里找不到 StartBtn')
await sleep(700)

const state = await evaluate(`({
  rungPowered: [...document.querySelectorAll('.ll-rung')].filter((rung) => rung.classList.contains('is-powered')).length,
  motor: [...document.querySelectorAll('.tag-card')].find((card) => card.querySelector('input')?.value === 'Motor')?.querySelector('.live-value')?.textContent.trim(),
  scan: document.querySelector('.status-bar')?.innerText,
  overflow: {
    tags: (() => { const el = document.querySelector('.tag-list'); return el ? el.scrollWidth > el.clientWidth : null })(),
    inspector: (() => { const el = document.querySelector('.inspector-body'); return el ? el.scrollWidth > el.clientWidth : null })(),
    page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  },
})`)
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
await writeFile(output, Buffer.from(shot.data, 'base64'))
socket.close()
console.log(JSON.stringify({ output, state, errors }, null, 2))
if (
  state.rungPowered < 1 ||
  state.motor !== 'TRUE' ||
  state.overflow.page ||
  state.overflow.tags ||
  errors.length > 0
) process.exitCode = 1
