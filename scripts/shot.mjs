/**
 * 单页面截图小工具：给设计走查用，不参与测试断言。
 *
 * 用法：
 *   node scripts/shot.mjs --out docs/qa/desktop.png --width 1440 --height 900
 * 可选参数：
 *   --cdp   http://127.0.0.1:9444            专用 QA 调试端口
 *   --url   http://127.0.0.1:4173/           目标页面
 *   --existing                              复用精确匹配的现有页面（默认新建后关闭）
 *   --js    "document.querySelector('.x').click()"   截图前执行一次
 *   --keys  "Escape,Delete"                  依次发送键盘按键
 *   --after "!!document.querySelector('.x')"  按键后再求值一次，只打印结果
 *   --wait  600                              截图前额外等待毫秒
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  closeQaPage,
  connectToPage,
  createQaPage,
  DEFAULT_QA_APP_URL,
  DEFAULT_QA_CDP,
  selectExactPage,
} from './qa-cdp.mjs'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] : fallback
}

const CDP = arg('cdp', DEFAULT_QA_CDP)
const URL_TARGET = arg('url', DEFAULT_QA_APP_URL)
const WIDTH = Number(arg('width', 1440))
const HEIGHT = Number(arg('height', 900))
const OUT = resolve(arg('out', 'docs/qa/shot.png'))
const SCRIPT = arg('js', '')
const KEYS = arg('keys', '')
const AFTER = arg('after', '')
const WAIT = Number(arg('wait', 400))
const FRESH = process.argv.includes('--fresh')
const USE_EXISTING = process.argv.includes('--existing')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

let page
if (USE_EXISTING) {
  const pages = await (await fetch(`${CDP}/json`)).json()
  page = selectExactPage(pages, URL_TARGET, CDP)
} else {
  page = await createQaPage(CDP)
}

const client = await connectToPage(page)
const { send } = client

const evaluate = async (expression) => {
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

await send('Page.enable')
await send('Runtime.enable')
if (FRESH) {
  await send('Storage.clearDataForOrigin', {
    origin: new URL(URL_TARGET).origin,
    storageTypes: 'local_storage',
  })
}
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: WIDTH < 700,
})
await send('Page.navigate', { url: URL_TARGET })

let ready = false
for (let attempt = 0; attempt < 60; attempt += 1) {
  ready = await evaluate(`!!document.querySelector('.wb-shell')`).catch(() => false)
  if (ready) break
  await sleep(200)
}
if (!ready) throw new Error(`页面没有就绪：${URL_TARGET}`)

// QA 浏览器会注入扩展浮层；截图只应呈现产品本身。
await evaluate(
  `document.querySelectorAll('plasmo-csui, #dx-sibebar-container').forEach((node) => node.remove())`,
)

if (SCRIPT) {
  const value = await evaluate(SCRIPT)
  if (value !== undefined) console.log(`eval: ${JSON.stringify(value)}`)
  await sleep(320)
}

const KEY_CODES = { Escape: 27, Delete: 46, Backspace: 8, Enter: 13 }
if (KEYS) {
  for (const name of KEYS.split(',').map((item) => item.trim()).filter(Boolean)) {
    const base = { key: name, code: name, windowsVirtualKeyCode: KEY_CODES[name] ?? 0 }
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(360)
  }
}
if (AFTER) {
  const value = await evaluate(AFTER)
  console.log(`after: ${JSON.stringify(value)}`)
}
await sleep(WAIT)

// 扩展可能在等待期间重新注入浮标，截图前最后清一次。
await evaluate(
  `document.querySelectorAll('plasmo-csui, #dx-sibebar-container').forEach((node) => node.remove())`,
).catch(() => {})

const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, Buffer.from(shot.data, 'base64'))
console.log(`${OUT} ${WIDTH}x${HEIGHT}`)
client.close()
if (!USE_EXISTING) await closeQaPage(CDP, page.id)
