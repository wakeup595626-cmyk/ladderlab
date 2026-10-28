/**
 * 收藏指令连续插入的真实浏览器回归。
 *
 * 覆盖：空程序段无输出线圈、点 + 后游标持续存在、收藏触点顺序推进、
 * 点画布空白清除游标、收藏条的分支/合并按钮走通现有线路操作。
 */
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

async function waitForApp(timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = await evaluate(
      `document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')`,
    ).catch(() => false)
    if (ready) return
    await sleep(150)
  }
  throw new Error(`等待页面就绪超时：${APP_URL}`)
}

async function clickAt(x, y) {
  await send('Page.bringToFront')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
  })
  await sleep(380)
}

async function clickSelector(selector, text = '') {
  const point = await evaluate(`(() => {
    const items = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const element = items.find((item) => !${JSON.stringify(text)}
      || item.textContent?.includes(${JSON.stringify(text)}))
    if (!element) return null
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  if (!point) throw new Error(`找不到可点击元素：${selector}${text ? `（${text}）` : ''}`)
  await clickAt(point.x, point.y)
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
  await sleep(350)
}

const checks = {}
const details = {}
function check(name, value, note) {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await reload(true)

await evaluate(`document.querySelector('.wb-coach-demo')?.click()`)
await sleep(650)

/* 空程序段必须只有横线，不能预留输出线圈。 */
const emptyRung = await evaluate(`(() => {
  const rung = document.querySelector('.ll-rung.is-placeholder')
  if (!rung) return null
  const svg = rung.querySelector('.ll-diagram')
  const rail = svg?.querySelector('.ll-power-wire')
  const renderedRail = rail?.getBoundingClientRect()
  const box = svg?.getBoundingClientRect()
  return {
    outputs: rung.querySelectorAll('.ll-output').length,
    emptyChains: rung.querySelectorAll('.ll-empty-chain').length,
    slots: rung.querySelectorAll('.ll-slot').length,
    rail: rail ? {
      x1: Number(rail.getAttribute('x1')),
      x2: Number(rail.getAttribute('x2')),
      width: renderedRail.width,
      parentWidth: box.width,
    } : null,
  }
})()`)
check(
  'empty-rung/has-no-output-coil',
  emptyRung?.outputs === 0 && emptyRung?.emptyChains === 1 && emptyRung?.slots === 1,
  emptyRung,
)
check(
  'empty-rung/wire-reaches-both-rails',
  Boolean(emptyRung?.rail)
    && emptyRung.rail.x1 === 18
    && emptyRung.rail.x2 === emptyRung.rail.parentWidth - 18
    && Math.abs(emptyRung.rail.width - (emptyRung.rail.parentWidth - 36)) < 1,
  emptyRung?.rail,
)

/* 点空段的 +：游标应持续高亮，不受两秒临时预览定时器影响。 */
await clickSelector('.ll-rung.is-placeholder .ll-slot-plus')
const cursorAfterPlus = await evaluate(`(() => {
  const slot = document.querySelector('.ll-rung.is-placeholder .ll-slot.is-favorite-target')
  const plus = slot?.querySelector('.ll-slot-plus')
  return {
    slots: document.querySelectorAll('.ll-rung.is-placeholder .ll-slot.is-favorite-target').length,
    halos: document.querySelectorAll('.ll-insert-cursor-halo').length,
    plusFill: plus ? getComputedStyle(plus).fill : null,
    menuOpen: Boolean(document.querySelector('.ll-slot-menu')),
  }
})()`)
check(
  'cursor/plus-marks-slot',
  cursorAfterPlus.slots === 1 && cursorAfterPlus.halos === 1 && cursorAfterPlus.menuOpen,
  cursorAfterPlus,
)

await sleep(2600)
const cursorStillMarked = await evaluate(`({
  slots: document.querySelectorAll('.ll-slot.is-favorite-target').length,
  halos: document.querySelectorAll('.ll-insert-cursor-halo').length,
})`)
check(
  'cursor/survives-preview-timeout',
  cursorStillMarked.slots === 1 && cursorStillMarked.halos === 1,
  cursorStillMarked,
)

/* 真实点击收藏：第一次点击只应插入，不应被打开的 + 菜单吞掉。 */
await clickSelector('.wb-instruction-card .wb-instruction-button', '常开')
await sleep(450)
const firstFavorite = await evaluate(`(() => {
  const rung = document.querySelector('.ll-rung.is-favorite-target')
  const cursor = rung?.querySelector('.ll-slot.is-favorite-target')
  return {
    contacts: rung?.querySelectorAll('.ll-contact, .ll-node[data-node-id^="c_"]').length ?? 0,
    labels: [...(rung?.querySelectorAll('.ll-node[data-node-id]') ?? [])]
      .map((node) => node.getAttribute('aria-label')).filter(Boolean),
    cursor: cursor ? { chain: cursor.dataset.chain, index: cursor.dataset.index } : null,
    menuOpen: Boolean(document.querySelector('.ll-slot-menu')),
    toast: document.querySelector('.toast')?.innerText ?? null,
  }
})()`)
check(
  'favorites/first-real-click-inserts-no',
  firstFavorite.labels.some((label) => label.startsWith('常开触点'))
    && firstFavorite.cursor?.chain === ''
    && firstFavorite.cursor?.index === '1'
    && firstFavorite.menuOpen === false,
  firstFavorite,
)

await clickSelector('.wb-instruction-card .wb-instruction-button', '常闭')
await sleep(450)
const secondFavorite = await evaluate(`(() => {
  const rung = document.querySelector('.ll-rung.is-favorite-target')
  const cursor = rung?.querySelector('.ll-slot.is-favorite-target')
  return {
    labels: [...(rung?.querySelectorAll('.ll-node[data-node-id]') ?? [])]
      .map((node) => node.getAttribute('aria-label')).filter(Boolean),
    cursor: cursor ? { chain: cursor.dataset.chain, index: cursor.dataset.index } : null,
    cursorCount: rung?.querySelectorAll('.ll-slot.is-favorite-target').length ?? 0,
    halos: rung?.querySelectorAll('.ll-insert-cursor-halo').length ?? 0,
  }
})()`)
check(
  'favorites/second-click-appends-and-advances',
  secondFavorite.labels.some((label) => label.startsWith('常开触点'))
    && secondFavorite.labels.some((label) => label.startsWith('常闭触点'))
    && secondFavorite.cursor?.chain === ''
    && secondFavorite.cursor?.index === '2'
    && secondFavorite.cursorCount === 1
    && secondFavorite.halos === 1,
  secondFavorite,
)

const cursorRungId = await evaluate(
  `document.querySelector('.ll-rung.is-favorite-target')?.dataset.rungId ?? null`,
)

/* 点真正的画布留白：固定游标和光晕都应立即消失。 */
const blankPoint = await evaluate(`(() => {
  const canvas = document.querySelector('.ll-canvas')
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const blocked = 'button, input, textarea, select, a, summary, [role="button"], [role="menu"], [data-node-id], [data-output-id], .ll-slot, .ll-merge-chip, .ll-node-grip, [data-drag-handle], .ll-rung-header'
  for (let y = Math.max(0, rect.top) + 16; y < Math.min(innerHeight, rect.bottom) - 16; y += 12) {
    for (let x = Math.max(0, rect.left) + 16; x < Math.min(innerWidth, rect.right) - 16; x += 12) {
      const hit = document.elementFromPoint(x, y)
      if (hit?.closest('.ll-canvas') && !hit.closest(blocked)) return { x, y }
    }
  }
  return null
})()`)
if (blankPoint) await clickAt(blankPoint.x, blankPoint.y)
const afterBlank = await evaluate(`({
  slots: document.querySelectorAll('.ll-slot.is-favorite-target').length,
  halos: document.querySelectorAll('.ll-insert-cursor-halo').length,
})`)
check(
  'cursor/blank-click-clears-marker',
  Boolean(blankPoint) && afterBlank.slots === 0 && afterBlank.halos === 0,
  { blankPoint, ...afterBlank },
)

/* 收藏条按钮必须真实存在，并能驱动画布上的分支与合并。 */
const constructButtons = await evaluate(`[...document.querySelectorAll('.wb-construct-button')]
  .map((button) => ({ text: button.innerText.trim(), title: button.title }))`)
check(
  'construct/buttons-present',
  constructButtons.some((button) => button.text === '分支')
    && constructButtons.some((button) => button.text === '合并'),
  constructButtons,
)

if (cursorRungId) {
  const betweenPoint = await evaluate(`(() => {
    const rung = document.querySelector('.ll-rung[data-rung-id="${cursorRungId}"]')
    const slot = rung?.querySelector('.ll-slot[data-chain=""][data-index="1"]')
    const plus = slot?.querySelector('.ll-slot-plus')
    if (!plus) return null
    plus.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = plus.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  if (betweenPoint) await clickAt(betweenPoint.x, betweenPoint.y)
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  })
  await sleep(250)
}

const rearmedCursor = await evaluate(`(() => {
  const slot = document.querySelector('.ll-slot.is-favorite-target')
  return slot ? { chain: slot.dataset.chain, index: slot.dataset.index } : null
})()`)
check(
  'cursor/plus-rearms-after-blank',
  Boolean(rearmedCursor) && rearmedCursor.chain === '' && rearmedCursor.index === '1',
  { cursorRungId, rearmedCursor },
)

await clickSelector('.wb-construct-button', '分支')
const afterBarBranch = await evaluate(`({
  openBranches: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  chips: document.querySelectorAll('.ll-merge-chip').length,
  toast: document.querySelector('.toast')?.innerText ?? null,
})`)
check(
  'construct/bar-opens-draft-branch',
  afterBarBranch.openBranches >= 1 && afterBarBranch.chips >= 1,
  afterBarBranch,
)

await clickSelector('.wb-construct-button', '合并')
await sleep(350)
const afterBarMerge = await evaluate(`({
  candidates: document.querySelectorAll('.ll-slot.is-merge-candidate').length,
  openBranches: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  toast: document.querySelector('.toast')?.innerText ?? null,
})`)
check(
  'construct/bar-arms-merge-targets',
  afterBarMerge.candidates >= 1 && afterBarMerge.openBranches >= 1,
  afterBarMerge,
)

await clickSelector('.ll-slot.is-merge-candidate .ll-slot-plus')
await sleep(500)
const merged = await evaluate(`({
  openBranches: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  chips: document.querySelectorAll('.ll-merge-chip').length,
  cursor: document.querySelectorAll('.ll-slot.is-favorite-target').length,
  toast: document.querySelector('.toast')?.innerText ?? null,
})`)
check(
  'construct/merge-completes-and-keeps-cursor',
  merged.openBranches === 0 && merged.chips === 0 && merged.cursor === 1,
  merged,
)
check('runtime/no-console-errors', errors.length === 0, errors)

console.log(JSON.stringify({ app: APP_URL, checks, details }, null, 2))

const failed = Object.entries(checks).filter(([, passed]) => !passed)
client.close()
await closeQaPage(CDP_HTTP, target.id)
if (failed.length > 0) process.exitCode = 1
