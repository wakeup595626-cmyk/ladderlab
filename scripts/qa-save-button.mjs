/**
 * Manual-save regression: the toolbar save control must remain clickable and
 * expose a visible outcome even when the local project library is damaged or
 * another tab is holding the cross-tab write lock.
 *
 * Requires `npm run preview -- --port 4173` and the dedicated Chromium CDP port.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  closeQaPage,
  connectToPage,
  createQaPage,
  DEFAULT_QA_APP_URL,
  DEFAULT_QA_CDP,
  READ_LIBRARY_IN_PAGE,
} from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const ORIGIN = new URL(APP_URL).origin
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const checks = {}
const details = {}

await mkdir(resolve('docs/qa'), { recursive: true })
const target = await createQaPage(CDP_HTTP)
const client = await connectToPage(target)
const { send } = client
const errors = []

client.onEvent((message) => {
  if (message.method === 'Runtime.exceptionThrown') {
    const data = message.params.exceptionDetails
    if (!JSON.stringify(data).includes('chrome-extension://')) {
      errors.push(data?.exception?.description ?? data?.text ?? 'exception')
    }
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

function check(name, value, note) {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
  if (process.env.LADDERLAB_QA_TRACE === '1') {
    console.error('[QA] ' + (checks[name] ? 'PASS' : 'FAIL') + ' ' + name)
  }
}

async function waitUntil(readValue, timeout = 12000, interval = 80) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await readValue()) return true
    await sleep(interval)
  }
  return false
}

async function waitForApp() {
  const ready = await waitUntil(() => evaluate(
    "document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')",
  ).catch(() => false), 15000, 160)
  if (!ready) throw new Error('等待 LadderLab 页面就绪超时：' + APP_URL)
  await evaluate(`(() => {
    document.querySelector('.guide-backdrop .guide-secondary')?.click()
    document.querySelector('.wb-coach-dismiss')?.click()
    return true
  })()`)
  await sleep(180)
}

async function reload({ clearStorage = false, corruptLegacyLibrary = false } = {}) {
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(220)
  if (clearStorage) {
    await send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'local_storage,session_storage' })
  }
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  if (corruptLegacyLibrary) {
    await evaluate(`(() => {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index)
        if (key?.startsWith('ladderlab.library.')) localStorage.removeItem(key)
      }
      localStorage.setItem('ladderlab.library.v1', '{broken json')
      return true
    })()`)
    await send('Page.reload')
    await waitForApp()
  }
}

async function clickSelector(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return { ok: false, reason: 'missing' }
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const top = document.elementFromPoint(x, y)
    return {
      ok: !element.disabled && style.pointerEvents !== 'none' && style.visibility !== 'hidden' && style.display !== 'none' && !!top && element.contains(top),
      x, y, width: rect.width, height: rect.height,
      disabled: Boolean(element.disabled), pointerEvents: style.pointerEvents,
      topElement: top ? top.tagName + '.' + (typeof top.className === 'string' ? top.className : '') : null,
      text: (element.textContent || '').trim(),
    }
  })()`)
  if (!point.ok) throw new Error(`控件不可真实点击：${selector} ${JSON.stringify(point)}`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(180)
  return point
}

async function setInput(selector, value) {
  return evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

async function screenshot(path) {
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1360,
  height: 860,
  deviceScaleFactor: 1,
  mobile: false,
})

/* 1. A fresh project must open the save dialog from a real pointer click. */
await reload({ clearStorage: true })
const freshButton = await evaluate(`(() => {
  const button = document.querySelector('.wb-save-button')
  if (!button) return { found: false }
  const rect = button.getBoundingClientRect()
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  return {
    found: true,
    disabled: button.disabled,
    pointerEvents: getComputedStyle(button).pointerEvents,
    covered: !top || !button.contains(top),
    label: button.textContent?.trim() ?? '',
  }
})()`)
check('fresh/button-present', freshButton.found, freshButton)
check(
  'fresh/button-hit-target-ok',
  freshButton.found && !freshButton.disabled && freshButton.pointerEvents !== 'none' && !freshButton.covered,
  freshButton,
)

await clickSelector('.wb-save-button')
const freshDialog = await waitUntil(() => evaluate("Boolean(document.querySelector('.save-project-dialog'))"), 2500)
check('fresh/click-opens-save-dialog', freshDialog)
check('fresh/click-shows-confirm', await evaluate(
  "document.querySelector('.save-project-confirm')?.textContent?.includes('保存到项目库') ?? false",
))

await setInput('#save-project-name', '保存键回归')
await clickSelector('.save-project-confirm')
const freshSaveDone = await waitUntil(() => evaluate(`(() => {
  if (document.querySelector('.save-project-dialog')) return false
  return document.querySelector('.wb-save-button')?.classList.contains('is-saved') ?? false
})()`), 5000)
const freshResult = await evaluate(`(() => ({
  buttonText: document.querySelector('.wb-save-button')?.textContent?.trim() ?? '',
  buttonClass: document.querySelector('.wb-save-button')?.className ?? '',
  toastText: [...document.querySelectorAll('.toast, [role="status"]')].map((item) => item.textContent).join(' '),
  dialogOpen: Boolean(document.querySelector('.save-project-dialog')),
  persisted: (${READ_LIBRARY_IN_PAGE})?.projects?.some((project) => project.program?.name === '保存键回归') ?? false,
}))()`)
check('fresh/save-completes', freshSaveDone && freshResult.persisted, freshResult)
check(
  'fresh/save-shows-success',
  freshResult.buttonClass.includes('is-saved') && freshResult.buttonText.includes('已保存'),
  freshResult,
)
await screenshot('docs/qa/save-button-saved.png')

/* 2. Saving an already named project must stay on the page and confirm again. */
await sleep(1700)
await clickSelector('.wb-save-button')
await sleep(420)
const repeat = await evaluate(`(() => ({
  dialogOpen: Boolean(document.querySelector('.save-project-dialog')),
  buttonText: document.querySelector('.wb-save-button')?.textContent?.trim() ?? '',
  buttonClass: document.querySelector('.wb-save-button')?.className ?? '',
}))()`)
check('repeat/click-remains-clickable', !repeat.dialogOpen, repeat)
check('repeat/save-shows-success', repeat.buttonClass.includes('is-saved') && repeat.buttonText.includes('已保存'), repeat)

/* 3. A lock held by another tab must time out instead of swallowing every click. */
const lockReady = await evaluate(`(() => {
  if (!navigator.locks?.request) return false
  window.__llQaLockHeld = false
  navigator.locks.request('ladderlab.library.v2', { mode: 'exclusive' }, () => {
    window.__llQaLockHeld = true
    return new Promise((release) => { window.__llQaReleaseLock = release })
  })
  return true
})()`)
const lockAcquired = lockReady && await waitUntil(() => evaluate('window.__llQaLockHeld === true'), 2000)
check('lock/other-tab-lock-acquired', lockAcquired)
if (lockAcquired) {
  await clickSelector('.wb-save-button')
  await sleep(260)
  const duringLock = await evaluate(`(() => ({
    text: document.querySelector('.wb-save-button')?.textContent?.trim() ?? '',
    className: document.querySelector('.wb-save-button')?.className ?? '',
  }))()`)
  check(
    'lock/click-enters-saving-state',
    duringLock.className.includes('is-saving') && duringLock.text.includes('保存中'),
    duringLock,
  )
  const timeoutVisible = await waitUntil(() => evaluate(
    "document.querySelector('.wb-save-button')?.classList.contains('is-error') && Boolean(document.querySelector('.save-project-dialog'))",
  ), 9000, 120)
  const timeoutResult = await evaluate(`(() => ({
    dialogOpen: Boolean(document.querySelector('.save-project-dialog')),
    buttonText: document.querySelector('.wb-save-button')?.textContent?.trim() ?? '',
    buttonTitle: document.querySelector('.wb-save-button')?.title ?? '',
    dialogText: document.querySelector('.save-project-dialog')?.textContent ?? '',
  }))()`)
  check('lock/timeout-is-visible', timeoutVisible, timeoutResult)
  check(
    'lock/timeout-explains-recovery',
    timeoutResult.dialogText.includes('项目库锁') || timeoutResult.dialogText.includes('超时'),
    timeoutResult,
  )
  await evaluate('window.__llQaReleaseLock?.(); true')
}

/* 4. A corrupt library must still open a recoverable export path. */
await reload({ clearStorage: true, corruptLegacyLibrary: true })
const corruptButton = await evaluate(`(() => {
  const button = document.querySelector('.wb-save-button')
  if (!button) return { found: false }
  const rect = button.getBoundingClientRect()
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  return {
    found: true,
    disabled: button.disabled,
    pointerEvents: getComputedStyle(button).pointerEvents,
    covered: !top || !button.contains(top),
    label: button.textContent?.trim() ?? '',
    title: button.title,
  }
})()`)
check(
  'corrupt/button-remains-clickable',
  corruptButton.found && !corruptButton.disabled && corruptButton.pointerEvents !== 'none' && !corruptButton.covered,
  corruptButton,
)
await clickSelector('.wb-save-button')
const corruptDialogOpen = await waitUntil(() => evaluate("Boolean(document.querySelector('.save-project-dialog'))"), 2500)
const corruptResult = await evaluate(`(() => ({
  dialogOpen: Boolean(document.querySelector('.save-project-dialog')),
  exportText: [...document.querySelectorAll('.save-project-dialog button')]
    .find((button) => button.textContent?.includes('导出工程 JSON'))?.textContent?.trim() ?? '',
  exportDisabled: Boolean([...document.querySelectorAll('.save-project-dialog button')]
    .find((button) => button.textContent?.includes('导出工程 JSON'))?.disabled),
  mainText: document.querySelector('.save-project-confirm')?.textContent?.trim() ?? '',
  mainDisabled: Boolean(document.querySelector('.save-project-confirm')?.disabled),
  inputDisabled: Boolean(document.querySelector('#save-project-name')?.disabled),
  warning: document.querySelector('.save-project-warning')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
  message: document.querySelector('.save-project-dialog')?.textContent ?? '',
}))()`)
check('corrupt/click-opens-recovery-dialog', corruptDialogOpen, corruptResult)
check(
  'corrupt/export-action-is-available',
  corruptResult.exportText.includes('导出工程 JSON')
    && !corruptResult.exportDisabled
    && corruptResult.warning.includes('导出工程 JSON')
    && !corruptResult.inputDisabled
    && corruptResult.mainText === '保存到项目库'
    && !corruptResult.mainDisabled,
  corruptResult,
)
await screenshot('docs/qa/save-button-corrupt-library.png')

const unexpectedErrors = errors.filter((error) => !String(error).includes('Failed to load resource'))
check('runtime/no-uncaught-errors', unexpectedErrors.length === 0, unexpectedErrors)

client.close()
await closeQaPage(CDP_HTTP, target.id)
console.log(JSON.stringify({ checks, details, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || unexpectedErrors.length > 0) process.exitCode = 1
