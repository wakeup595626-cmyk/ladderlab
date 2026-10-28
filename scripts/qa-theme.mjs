/**
 * 主题验收：五套预设（默认原版绿）、自定义色派生、刷新持久化、portal 弹层换肤与移动端。
 *
 * 用法：先启动 preview（默认 4173）与带调试端口的浏览器（9444），
 * 然后 node scripts/qa-theme.mjs。
 */
import { mkdir, writeFile } from 'node:fs/promises'
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

await mkdir(resolve('docs/qa'), { recursive: true })

const target = await createQaPage(CDP_HTTP)
const client = await connectToPage(target)
const { send } = client
const errors = []

client.onEvent((message) => {
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

async function setViewport(width, height, mobile) {
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

async function waitForApp(timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = await evaluate(
      "document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')",
    ).catch(() => false)
    if (ready) return true
    await sleep(200)
  }
  throw new Error('等待页面就绪超时：' + APP_URL)
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
  await sleep(250)
}

async function shot(path) {
  await evaluate(
    "document.querySelectorAll('plasmo-csui, #dx-sibebar-container').forEach((node) => node.remove())",
  ).catch(() => {})
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(image.data, 'base64'))
}

async function openMenu() {
  const open = await evaluate("!!document.querySelector('#topbar-more-menu')")
  if (!open) {
    await evaluate(
      "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === '更多操作'); if (!button) return false; button.click(); return true })()",
    )
    await sleep(300)
  }
  return evaluate("!!document.querySelector('#topbar-more-menu')")
}

async function clickPreset(name) {
  return evaluate(
    "(() => { const button = [...document.querySelectorAll('.wb-theme-option')].find((item) => item.textContent.includes(" + JSON.stringify(name) + ")); if (!button) return false; button.click(); return true })()",
  )
}

function pageTokens() {
  const shell = document.querySelector('.app-shell')
  const style = getComputedStyle(shell)
  const root = getComputedStyle(document.documentElement)
  const read = (name) => style.getPropertyValue(name).trim().toLowerCase()
  return {
    theme: shell.dataset.theme,
    accent: read('--accent'),
    ground: read('--ground'),
    text: read('--text'),
    muted: read('--muted'),
    surface: read('--surface'),
    accentInk: read('--accent-ink'),
    accentWash: read('--accent-wash'),
    rootAccent: root.getPropertyValue('--accent').trim().toLowerCase(),
  }
}

function pageContrast() {
  const parse = (hex) => {
    const value = hex.replace('#', '')
    return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16))
  }
  const luminance = (hex) => {
    const channels = parse(hex).map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const ratio = (a, b) => {
    const first = luminance(a)
    const second = luminance(b)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  }
  const tokens = pageTokens()
  return {
    groundLuminance: luminance(tokens.ground),
    textOnSurface: ratio(tokens.text, tokens.surface),
    accentOnSurface: ratio(tokens.accent, tokens.surface),
    mutedOnSurface: ratio(tokens.muted, tokens.surface),
    accentInkOnWash: ratio(tokens.accentInk, tokens.accentWash),
  }
}

const TOKENS = '(' + pageTokens.toString() + ')()'
const CONTRAST =
  '(function () { const pageTokens = ' +
  pageTokens.toString() +
  '; return (' +
  pageContrast.toString() +
  ')() })()'

const PRESETS = [
  { name: '原版绿', accent: '#0f6b7a' },
  { name: '冰湖青', accent: '#0a7e93' },
  { name: '晴空蓝', accent: '#1976d2' },
  { name: '薄荷绿', accent: '#0a8478' },
  { name: '晨雾紫', accent: '#7a5cd6' },
]

const checks = {}
const details = {}
const check = (name, value, note) => {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
}

const pressEscape = async () => {
  const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(260)
}

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await setViewport(1440, 900, false)
  await reload(true)

  const initial = await evaluate(TOKENS)
  check(
    'default-classic',
    initial.theme === 'classic' && initial.accent === '#0f6b7a' && initial.ground === '#f0f1ef',
    initial,
  )

  check('menu-opens', await openMenu())
  const presetCount = await evaluate("document.querySelectorAll('.wb-theme-option:not(.is-custom)').length")
  const customEntry = await evaluate("document.querySelectorAll('.wb-theme-option.is-custom').length")
  check('presets-rendered', presetCount === 5 && customEntry === 1, { presetCount, customEntry })

  for (const preset of PRESETS) {
    const clicked = await clickPreset(preset.name)
    await sleep(420)
    const tokens = await evaluate(TOKENS)
    const stillOpen = await evaluate("!!document.querySelector('#topbar-more-menu')")
    const checked = await evaluate(
      "(() => { const button = [...document.querySelectorAll('.wb-theme-option')].find((item) => item.textContent.includes(" + JSON.stringify(preset.name) + ")); return button ? button.getAttribute('aria-checked') : null })()",
    )
    const selected = await evaluate(
      "document.querySelectorAll('.wb-theme-option[aria-checked=\"true\"]').length",
    )
    check(
      'preset-' + preset.name,
      clicked && tokens.accent === preset.accent && checked === 'true' && selected === 1 && stillOpen,
      { accent: tokens.accent, expected: preset.accent, stillOpen, selected },
    )
    await shot('docs/qa/theme-' + preset.accent.slice(1) + '.png')
  }

  await openMenu()
  const applied = await evaluate(
    "(() => { const inputs = [...document.querySelectorAll('input[type=color]')]; if (inputs.length < 2) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(inputs[0], '#ffe600'); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); inputs[0].dispatchEvent(new Event('change', { bubbles: true })); set.call(inputs[1], '#ff0066'); inputs[1].dispatchEvent(new Event('input', { bubbles: true })); inputs[1].dispatchEvent(new Event('change', { bubbles: true })); return true })()",
  )
  await sleep(520)
  const customTokens = await evaluate(TOKENS)
  const contrast = await evaluate(CONTRAST)
  check('custom-applies', applied && customTokens.theme === 'custom', customTokens.theme)
  check('custom-ground-light', contrast.groundLuminance >= 0.9, contrast.groundLuminance)
  check('custom-text-readable', contrast.textOnSurface >= 7, contrast.textOnSurface)
  check('custom-accent-readable', contrast.accentOnSurface >= 4.5, contrast.accentOnSurface)
  check('custom-muted-readable', contrast.mutedOnSurface >= 4.5, contrast.mutedOnSurface)
  check('custom-ink-on-wash', contrast.accentInkOnWash >= 5, contrast.accentInkOnWash)
  const customChecked = await evaluate(
    "(() => { const item = document.querySelector('.wb-theme-option.is-custom'); const all = document.querySelectorAll('.wb-theme-option[aria-checked=\"true\"]'); return { checked: item ? item.getAttribute('aria-checked') : null, count: all.length } })()",
  )
  check('custom-radio-checked', customChecked.checked === 'true' && customChecked.count === 1, customChecked)
  await shot('docs/qa/theme-custom.png')

  await reload(false)
  const persisted = await evaluate(TOKENS)
  const stored = await evaluate("localStorage.getItem('ladderlab.theme.v1')")
  check(
    'theme-persists',
    persisted.theme === 'custom' && typeof stored === 'string' && stored.includes('custom'),
    { theme: persisted.theme, stored },
  )

  await setViewport(1440, 900, false)
  const plusRect = await evaluate(
    "(() => { const plus = document.querySelector('.ll-slot-plus'); if (!plus) return null; const rect = plus.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })()",
  )
  if (plusRect) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: plusRect.x, y: plusRect.y, button: 'none' })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: plusRect.x, y: plusRect.y, button: 'left', buttons: 1, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plusRect.x, y: plusRect.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(420)
  }
  const portal = await evaluate(
    "(() => { const menu = document.querySelector('.ll-slot-menu'); if (!menu) return null; const style = getComputedStyle(menu); const root = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); return { accent: style.getPropertyValue('--accent').trim(), root, background: style.backgroundColor } })()",
  )
  check('portal-themed', !!portal && portal.accent === portal.root, portal)
  await pressEscape()

  await openMenu()
  await clickPreset('原版绿')
  await sleep(420)
  const restored = await evaluate(TOKENS)
  check(
    'restore-default',
    restored.theme === 'classic' && restored.accent === '#0f6b7a',
    restored.theme,
  )
  await pressEscape()
  await shot('docs/qa/theme-default-desktop.png')

  await setViewport(390, 844, true)
  await sleep(320)
  const mobileOpen = await openMenu()
  const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth')
  await clickPreset('薄荷绿')
  await sleep(420)
  const mobileTokens = await evaluate(TOKENS)
  await shot('docs/qa/theme-mobile.png')
  check('mobile-menu', mobileOpen && overflow <= 0, { overflow })
  check('mobile-switch', mobileTokens.accent === '#0a8478', mobileTokens.accent)

  check('console-errors', errors.length === 0, errors.slice(0, 5))
} finally {
  await closeQaPage(CDP_HTTP, target.id).catch(() => {})
}

const failed = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name)
console.log(JSON.stringify({ checks, details, failed }, null, 2))
if (failed.length > 0) {
  console.error('主题验收未通过：' + failed.join(', '))
  process.exit(1)
}
console.log('主题验收通过：' + Object.keys(checks).length + ' 项检查')
