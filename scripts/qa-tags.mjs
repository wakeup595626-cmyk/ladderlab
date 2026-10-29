/**
 * Issue #11 regression: dense tag rows, filtering, clearing, editing and mobile fit.
 * Requires `npm run preview` plus the Chromium debugging endpoint.
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
const checks = {}
const details = {}

await mkdir(resolve('docs/qa'), { recursive: true })
const target = await createQaPage(CDP_HTTP)
const client = await connectToPage(target)
const { socket, send } = client
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

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
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
      "document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')",
    ).catch(() => false)
    if (ready) return
    await sleep(200)
  }
  throw new Error('waiting for app timed out: ' + APP_URL)
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

async function loadDemo() {
  const viaCoach = await evaluate("(() => { const button = document.querySelector('.wb-coach-demo'); if (!button) return false; button.click(); return true })()")
  if (viaCoach) {
    await sleep(650)
    return 'coach'
  }
  await evaluate("document.querySelector('.wb-more summary')?.click()")
  await sleep(180)
  const viaMenu = await evaluate("(() => { const item = [...document.querySelectorAll('.wb-more-menu button')].find((button) => button.textContent?.includes('三步上手')); if (!item) return false; item.click(); return true })()")
  if (viaMenu) {
    await sleep(280)
    await evaluate("document.querySelector('.guide-primary')?.click()")
    await sleep(650)
  }
  return viaMenu ? 'guide' : 'missing'
}

async function openTagsPanel() {
  await evaluate("(() => { const tab = [...document.querySelectorAll('[role=tab]')].find((item) => item.textContent?.includes('变量表')); tab?.click() })()")
  await sleep(240)
}

async function enterSearch(value) {
  await evaluate("(() => { const input = document.querySelector('.tag-search-input'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, " + JSON.stringify(value) + "); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()")
  await sleep(180)
}

async function screenshot(path) {
  await evaluate("document.querySelectorAll('plasmo-csui, #dx-sibebar-container').forEach((node) => node.remove())").catch(() => {})
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

async function pressEscape() {
  const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
  await sleep(160)
}

await send('Page.enable')
await send('Runtime.enable')

/* Desktop: compact cards and every search entry point. */
await setViewport(1440, 900, false)
await reload(true)
check('desktop/demo-loads', (await loadDemo()) !== 'missing')
await openTagsPanel()

const base = await evaluate(`(() => {
  const panel = document.querySelector('.tags-panel')
  const cards = [...document.querySelectorAll('.tag-card')]
  const search = document.querySelector('.tag-search')
  const select = cards[0]?.querySelector('select.table-input')
  const selectStyle = select ? getComputedStyle(select) : null
  const measure = document.createElement('canvas').getContext('2d')
  if (selectStyle) measure.font = selectStyle.fontWeight + ' ' + selectStyle.fontSize + ' ' + selectStyle.fontFamily
  const selectTextWidth = select ? measure.measureText(select.selectedOptions[0]?.textContent ?? '').width : Infinity
  const selectRoom = select && selectStyle
    ? select.clientWidth - parseFloat(selectStyle.paddingLeft) - parseFloat(selectStyle.paddingRight)
    : 0
  const centeredControls = cards.length > 0 && cards.every((card) => {
    const controls = [
      card.querySelector('.tag-name-input'),
      card.querySelector('.address-input'),
      card.querySelector('select.table-input'),
      card.querySelector('.live-value'),
      card.querySelector('.comment-input'),
    ].filter(Boolean)
    return controls.every((control) => getComputedStyle(control).textAlign === 'center')
  })
  const rowCenters = cards.map((card) => {
    const controls = [
      card.querySelector('.tag-name-input'),
      card.querySelector('.address-input'),
      card.querySelector('select.table-input'),
      card.querySelector('.live-value'),
    ].filter(Boolean)
    return controls.map((control) => {
      const rect = control.getBoundingClientRect()
      return Math.round((rect.top + rect.bottom) / 2)
    })
  })
  return {
    cards: cards.length,
    cardHeight: cards[0]?.getBoundingClientRect().height ?? 0,
    fieldsPerCard: cards[0]?.querySelectorAll('.tag-card-fields label').length ?? 0,
    searchRole: search?.getAttribute('role') ?? null,
    nestedControlInLabel: !!document.querySelector('label .tag-search-clear'),
    oldMonitorPresent: !!document.querySelector('.tags-monitor'),
    overflow: panel ? panel.scrollWidth > panel.clientWidth + 1 : true,
    centeredControls,
    alignedRows: rowCenters.length > 0 && rowCenters.every((centers) => new Set(centers).size === 1),
    rowCenters,
    selectTextFits:
      Boolean(select)
      && selectStyle?.appearance === 'none'
      && selectRoom >= selectTextWidth + 8,
    selectRoom,
    selectTextWidth,
  }
})()`)
check('desktop/tag-cards-present', base.cards === 3, base)
check('desktop/tag-card-is-dense', base.cardHeight > 40 && base.cardHeight < 95, base.cardHeight)
check('desktop/tag-fields-in-one-row', base.fieldsPerCard === 3, base.fieldsPerCard)
check('desktop/search-is-semantic', base.searchRole === 'search' && !base.nestedControlInLabel, base)
check('desktop/old-monitor-removed', !base.oldMonitorPresent)
check('desktop/tag-panel-no-overflow', !base.overflow)
check('desktop/tag-controls-centered', base.centeredControls, base)
check('desktop/tag-controls-aligned', base.alignedRows, base.rowCenters)
check('desktop/select-text-fits', base.selectTextFits, base)

await enterSearch('Start')
const byName = await evaluate(`({
  cards: document.querySelectorAll('.tag-card').length,
  values: [...document.querySelectorAll('.tag-card input')].map((input) => input.value).join(' '),
  togglePressed: document.querySelector('.tag-card .live-value')?.getAttribute('aria-pressed') ?? null,
})`)
check('desktop/search-by-name', byName.cards === 1 && byName.values.includes('StartBtn'), byName)
check('desktop/runtime-toggle-exposes-state', byName.togglePressed === 'false', byName)

await enterSearch('%I0.0')
const byAddress = await evaluate(`({
  cards: document.querySelectorAll('.tag-card').length,
  values: [...document.querySelectorAll('.tag-card input')].map((input) => input.value).join(' '),
})`)
check('desktop/search-by-address', byAddress.cards === 1 && byAddress.values.includes('StartBtn'), byAddress)

await enterSearch('启动按钮')
const byComment = await evaluate("document.querySelectorAll('.tag-card').length")
check('desktop/search-by-comment', byComment === 1, byComment)

await enterSearch('missing-tag-value')
const empty = await evaluate(`({
  empty: !!document.querySelector('.tag-empty'),
  cards: document.querySelectorAll('.tag-card').length,
})`)
check('desktop/search-empty-state', empty.empty && empty.cards === 0, empty)

await evaluate("document.querySelector('.tag-search-input')?.focus()")
await pressEscape()
const clearedByEscape = await evaluate(`({
  value: document.querySelector('.tag-search-input')?.value ?? null,
  cards: document.querySelectorAll('.tag-card').length,
})`)
check('desktop/escape-clears-search', clearedByEscape.value === '' && clearedByEscape.cards === 3, clearedByEscape)

await enterSearch('Motor')
await evaluate("document.querySelector('.tag-search-clear')?.click()")
await sleep(160)
const clearedByButton = await evaluate(`({
  value: document.querySelector('.tag-search-input')?.value ?? null,
  cards: document.querySelectorAll('.tag-card').length,
})`)
check('desktop/button-clears-search', clearedByButton.value === '' && clearedByButton.cards === 3, clearedByButton)

// A new row stays editable end-to-end: comment, name, address, delete.
await evaluate(`[...document.querySelectorAll('.tags-toolbar button')]
  .find((button) => button.textContent?.trim() === '+ BOOL')
  ?.click()`)
await sleep(180)
const editResult = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.tag-card')].at(-1)
  if (!card) return { added: false }
  const set = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  }
  // Keep the QA contract tied to semantic controls, not DOM order: the
  // comment is its own full-width row now and must not be mistaken for the
  // address field when the card layout changes again.
  set(card.querySelector('.tag-name-input'), 'QaTag')
  set(card.querySelector('.address-input'), '%M9.9')
  set(card.querySelector('.comment-input'), 'QA 变量')
  return { added: true }
})()`)
await sleep(240)
const edited = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.tag-card')].at(-1)
  return {
    name: card?.querySelector('.tag-name-input')?.value ?? null,
    comment: card?.querySelector('.comment-input')?.value ?? null,
    address: card?.querySelector('.address-input')?.value ?? null,
    total: document.querySelectorAll('.tag-card').length,
  }
})()`)
check(
  'desktop/new-tag-editable',
  editResult.added
    && edited.name === 'QaTag'
    && edited.comment === 'QA 变量'
    && edited.address === '%M9.9'
    && edited.total === 4,
  edited,
)
await evaluate(`[...document.querySelectorAll('.tag-card')].at(-1)?.querySelector('.delete-mini')?.click()`)
await sleep(180)
check(
  'desktop/new-tag-deletable',
  (await evaluate("document.querySelectorAll('.tag-card').length")) === 3,
)
await screenshot('docs/qa/tags-desktop.png')

/* Mobile: the compact list must remain visible and fit without horizontal scroll. */
await setViewport(390, 844, true)
await reload(false)
await evaluate(`document.querySelector('.ll-node[data-node-id]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(360)
await pressEscape()
await evaluate(`[...document.querySelectorAll('.wb-tabbar .mobile-tab-action')]
  .find((button) => button.textContent?.trim() === '变量')?.click()`)
await sleep(620)
await openTagsPanel()

const mobile = await evaluate(`(() => {
  const panel = document.querySelector('.wb-context-panel')
  const list = document.querySelector('.tag-list')
  const card = document.querySelector('.tag-card')
  const fields = card ? [...card.querySelectorAll('.tag-card-fields label')] : []
  const select = card?.querySelector('select.table-input')
  const selectStyle = select ? getComputedStyle(select) : null
  const measure = document.createElement('canvas').getContext('2d')
  if (selectStyle) measure.font = selectStyle.fontWeight + ' ' + selectStyle.fontSize + ' ' + selectStyle.fontFamily
  const selectTextWidth = select ? measure.measureText(select.selectedOptions[0]?.textContent ?? '').width : Infinity
  const selectRoom = select && selectStyle
    ? select.clientWidth - parseFloat(selectStyle.paddingLeft) - parseFloat(selectStyle.paddingRight)
    : 0
  const rect = card?.getBoundingClientRect()
  return {
    panel: !!panel,
    listDisplay: list ? getComputedStyle(list).display : null,
    listHeight: list?.getBoundingClientRect().height ?? 0,
    cards: document.querySelectorAll('.tag-card').length,
    cardHeight: rect?.height ?? 0,
    cardWidth: rect?.width ?? 0,
    fieldsVisible: fields.length === 3 && fields.every((item) => item.getBoundingClientRect().width > 20),
    selectTextFits:
      Boolean(select)
      && selectStyle?.appearance === 'none'
      && selectRoom >= selectTextWidth + 8,
    selectWidth: select?.getBoundingClientRect().width ?? 0,
    selectRoom,
    selectTextWidth,
    selectPadding: selectStyle ? selectStyle.padding : null,
    selectAppearance: selectStyle?.appearance ?? null,
    selectFont: selectStyle?.font ?? null,
    overflow: panel ? panel.scrollWidth > panel.clientWidth + 1 : true,
    documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})()`)
check('mobile/tag-list-visible', mobile.panel && mobile.listDisplay !== 'none' && mobile.listHeight > 0, mobile)
check('mobile/tag-cards-dense', mobile.cards === 3 && mobile.cardHeight < 130, mobile)
check(
  'mobile/tag-fields-fit',
  mobile.fieldsVisible && mobile.selectTextFits && !mobile.overflow && !mobile.documentOverflow,
  mobile,
)
await screenshot('docs/qa/tags-mobile-390.png')

await setViewport(320, 800, true)
await sleep(260)
const narrow = await evaluate(`(() => {
  const panel = document.querySelector('.wb-context-panel')
  const list = document.querySelector('.tag-list')
  const card = document.querySelector('.tag-card')
  const head = card?.querySelector('.tag-card-head')
  const fieldLabels = card ? [...card.querySelectorAll('.tag-card-fields label > span')] : []
  const select = card?.querySelector('select.table-input')
  const selectStyle = select ? getComputedStyle(select) : null
  const measure = document.createElement('canvas').getContext('2d')
  if (selectStyle) measure.font = selectStyle.fontWeight + ' ' + selectStyle.fontSize + ' ' + selectStyle.fontFamily
  const selectTextWidth = select ? measure.measureText(select.selectedOptions[0]?.textContent ?? '').width : Infinity
  const selectRoom = select && selectStyle
    ? select.clientWidth - parseFloat(selectStyle.paddingLeft) - parseFloat(selectStyle.paddingRight)
    : 0
  const selectTextFits =
    Boolean(select)
    && selectStyle?.appearance === 'none'
    && selectRoom >= selectTextWidth + 8
  const labelsVisible = fieldLabels.length === 3 && fieldLabels.every((label) => {
    const rect = label.getBoundingClientRect()
    return getComputedStyle(label).display !== 'none' && rect.width > 0 && rect.height > 0
  })
  return {
    listVisible: !!list && getComputedStyle(list).display !== 'none' && list.getBoundingClientRect().height > 0,
    cardWidth: card?.getBoundingClientRect().width ?? 0,
    headWidth: head?.getBoundingClientRect().width ?? 0,
    labelsVisible,
    selectTextFits,
    overflow: panel ? panel.scrollWidth > panel.clientWidth + 1 : true,
  }
})()`)
check(
  'mobile/320-labels-and-no-overflow',
  narrow.listVisible
    && narrow.cardWidth > 0
    && narrow.labelsVisible
    && narrow.selectTextFits
    && !narrow.overflow,
  narrow,
)
await screenshot('docs/qa/tags-mobile-320.png')

socket.close()
await closeQaPage(CDP_HTTP, target.id)
console.log(JSON.stringify({ checks, details, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || errors.length > 0) process.exitCode = 1
