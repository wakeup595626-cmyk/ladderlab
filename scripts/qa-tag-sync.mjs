/**
 * Issue #12 回归：变量表跟随指令增删，并支持按程序段排序。
 * 前置：npm run build 后由 npm run preview 提供页面，并开着 Chromium 调试端口。
 *   LADDERLAB_URL=http://127.0.0.1:4175/ node scripts/qa-tag-sync.mjs
 */
import { mkdir } from 'node:fs/promises'
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

await send('Page.enable')
await send('Runtime.enable')

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
  console.log((checks[name] ? 'PASS ' : 'FAIL ') + name)
}

async function pressKey(key, code, keyCode) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
  await send('Page.bringToFront')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

/** 参数面板把速改框做成浮层，收工时点右上角关闭，再让右侧栏回到标签页。 */
async function closeEditor() {
  await evaluate("document.querySelector('.qe-close')?.click()")
  await sleep(320)
}

async function waitForApp(timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = await evaluate("document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')").catch(() => false)
    if (ready) return
    await sleep(200)
  }
  throw new Error('waiting for app timed out: ' + APP_URL)
}

async function freshStart() {
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(320)
  await send('Storage.clearDataForOrigin', {
    origin: new URL(APP_URL).origin,
    storageTypes: 'local_storage',
  })
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  await sleep(260)
  const viaCoach = await evaluate("(() => { const button = document.querySelector('.wb-coach-demo'); if (!button) return false; button.click(); return true })()")
  if (!viaCoach) throw new Error('找不到「载入启保停示例」入口')
  await sleep(700)
}

async function openTagsPanel() {
  // 选中元件会收起右侧栏，这里统一走指令栏上的「变量表」入口。
  await evaluate(`(() => {
    const button = document.querySelector('[data-inspector-entry="tags"]')
    if (!button) return false
    if (button.getAttribute('aria-pressed') !== 'true') button.click()
    return true
  })()`)
  await sleep(320)
}

async function readTags() {
  return evaluate(`(() => ({
    count: Number(document.querySelector('.tag-count')?.textContent ?? -1),
    cards: [...document.querySelectorAll('.tag-card')].map((card) => ({
      name: card.querySelector('.tag-name-input')?.value ?? '',
      address: card.querySelector('.address-input')?.value ?? '',
    })),
  }))()`)
}

async function clickNodeByName(name) {
  const expression = '(() => { const nodes = [...document.querySelectorAll(".ll-node.ll-contact[data-node-id]")];'
    + ' const node = nodes.find((item) => (item.textContent ?? "").includes(' + JSON.stringify(name) + '));'
    + ' if (!node) return null; node.dispatchEvent(new MouseEvent("click", { bubbles: true }));'
    + ' return node.getAttribute("data-node-id"); })()'
  const id = await evaluate(expression)
  await sleep(340)
  return id
}

async function setPrimaryOperand(value) {
  const started = await evaluate(`(() => {
    const input = document.querySelector('.qe-panel .qe-input[data-primary="true"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
    return true
  })()`)
  if (!started) return false
  await sleep(120)
  await pressKey('Enter', 'Enter', 13)
  await sleep(420)
  return true
}

async function renameFirstTag(from, to) {
  return evaluate('(() => { const card = [...document.querySelectorAll(".tag-card")]'
    + '.find((item) => item.querySelector(".tag-name-input")?.value === ' + JSON.stringify(from) + ');'
    + ' const input = card?.querySelector(".tag-name-input"); if (!input) return false;'
    + ' const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;'
    + ' setter.call(input, ' + JSON.stringify(to) + ');'
    + ' input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); input.blur(); return true; })()')
}

async function toastText() {
  return evaluate("document.querySelector('.toast-message')?.textContent?.trim() ?? null")
}

async function screenshot(path) {
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

/* ---------- 场景一：程序段里改了操作数，变量表自动补上，并能按程序段排序 ---------- */
await freshStart()
await openTagsPanel()
const initial = await readTags()
check('tags/demo-baseline', initial.count === 3 && initial.cards.map((tag) => tag.name).join(',') === 'StartBtn,StopBtn,Motor', initial)

const contactId = await clickNodeByName('StopBtn')
check('tags/contact-selected', Boolean(contactId), contactId)
const edited = await setPrimaryOperand('M100.0')
await closeEditor()
await openTagsPanel()
const afterOperand = await readTags()
const autoTag = afterOperand.cards.find((tag) => tag.address === '%M100.0')
check('tags/auto-created-from-operand', edited && Boolean(autoTag) && afterOperand.count === initial.count + 1, afterOperand)
if (!autoTag) throw new Error('没有生成 %M100.0 的自动变量，后续步骤无法继续')
check(
  'tags/auto-appended-last',
  Boolean(autoTag) && afterOperand.cards[afterOperand.cards.length - 1].name === autoTag.name,
  afterOperand.cards.map((tag) => tag.name),
)

const sorted = await evaluate("(() => { const button = [...document.querySelectorAll('.tags-toolbar button')].find((item) => item.textContent?.includes('按程序段排序')); if (!button) return null; button.click(); return { pressed: button.getAttribute('aria-pressed') } })()")
await sleep(260)
const ordered = await readTags()
const sortButton = await evaluate("(() => { const button = [...document.querySelectorAll('.tags-toolbar button')].find((item) => item.textContent?.includes('按程序段排序')); return { pressed: button?.getAttribute('aria-pressed') ?? null } })()")
check(
  'tags/sort-order',
  Boolean(sorted) && ordered.cards[0]?.address === '%M100.0' && ordered.cards.map((tag) => tag.name).join(',') === autoTag.name + ',StartBtn,Motor,StopBtn',
  ordered.cards.map((tag) => tag.name),
)
check('tags/sort-button-pressed', sortButton.pressed === 'true', sortButton)
await screenshot('docs/qa/tags-sync-order.png')

await clickNodeByName(autoTag.name)
await closeEditor()
const removeEnabled = await evaluate("document.querySelector('.ll-tool-remove')?.disabled === false")
await evaluate("document.querySelector('.ll-tool-remove')?.click()")
await sleep(460)
await openTagsPanel()
const pruned = await readTags()
const pruneToast = await toastText()
check('tags/prune-after-delete', removeEnabled && pruned.count === initial.count && !pruned.cards.some((tag) => tag.address === '%M100.0'), pruned)
check('tags/prune-toast', Boolean(pruneToast && pruneToast.includes('已删除') && pruneToast.includes('变量表已同步')), pruneToast)
await screenshot('docs/qa/tags-sync-pruned.png')

await evaluate("document.querySelector('.toast-action')?.click()")
await sleep(460)
await openTagsPanel()
const restored = await readTags()
check('tags/undo-restores-tag', restored.count === initial.count + 1 && restored.cards.some((tag) => tag.address === '%M100.0'), restored)

/* ---------- 场景二：用户改过的变量不再被自动回收 ---------- */
await freshStart()
await clickNodeByName('StartBtn')
await setPrimaryOperand('M200.0')
await closeEditor()
await openTagsPanel()
const beforeRename = await readTags()
const autoSecond = beforeRename.cards.find((tag) => tag.address === '%M200.0')
const renamed = await renameFirstTag(autoSecond?.name ?? '', 'MyTag')
await sleep(360)
const afterRename = await readTags()
check('tags/rename-keeps-address', renamed && afterRename.cards.some((tag) => tag.name === 'MyTag' && tag.address === '%M200.0'), afterRename)

await clickNodeByName('MyTag')
await closeEditor()
await evaluate("document.querySelector('.ll-tool-remove')?.click()")
await sleep(460)
await openTagsPanel()
const kept = await readTags()
check(
  'tags/user-edited-tag-kept',
  kept.cards.some((tag) => tag.name === 'MyTag' && tag.address === '%M200.0') && !kept.cards.some((tag) => tag.address === '%M100.0'),
  kept,
)

socket.close()
await closeQaPage(CDP_HTTP, target.id)
console.log(JSON.stringify({ checks, details, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || errors.length > 0) process.exitCode = 1
