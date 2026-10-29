/**
 * Issue #12 回归：变量表跟随指令增删，并按程序段分组、可展开收起。
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

/* ---------- 场景一：程序段里改了操作数，变量表自动补上，并按程序段分组 ---------- */
await freshStart()
await openTagsPanel()
const initial = await readTags()
/* 分组视图按程序段顺序排列，基线只比较集合，不锁死顺序。 */
check(
  'tags/demo-baseline',
  initial.count === 3 && initial.cards.map((tag) => tag.name).sort().join(',') === 'Motor,StartBtn,StopBtn',
  initial,
)

const contactId = await clickNodeByName('StopBtn')
check('tags/contact-selected', Boolean(contactId), contactId)
const edited = await setPrimaryOperand('M100.0')
await closeEditor()
await openTagsPanel()
const afterOperand = await readTags()
const autoTag = afterOperand.cards.find((tag) => tag.address === '%M100.0')
check('tags/auto-created-from-operand', edited && Boolean(autoTag) && afterOperand.count === initial.count + 1, afterOperand)
if (!autoTag) throw new Error('没有生成 %M100.0 的自动变量，后续步骤无法继续')
/* 「全部」视图保持登记顺序，新变量排在最后。 */
await evaluate("(() => { const button = [...document.querySelectorAll('.tags-toolbar button')].find((item) => item.textContent?.trim() === '全部'); button?.click() })()")
await sleep(320)
const flat = await readTags()
check(
  'tags/auto-appended-last',
  Boolean(autoTag) && flat.cards[flat.cards.length - 1].name === autoTag.name,
  flat.cards.map((tag) => tag.name),
)

/* 回到默认的分组视图：每段一格，默认全部展开，可单独收起。 */
await evaluate("(() => { const button = [...document.querySelectorAll('.tags-toolbar button')].find((item) => item.textContent?.trim() === '按程序段'); button?.click() })()")
await sleep(360)
const readGroups = async () => evaluate(`(() => ({
  view: document.querySelector('.tag-list')?.getAttribute('data-view') ?? null,
  groups: [...document.querySelectorAll('.tag-list .tag-group')].map((group) => ({
    title: group.querySelector('.tag-group-title')?.textContent?.trim() ?? '',
    total: Number(group.querySelector('.tag-group-count')?.textContent ?? -1),
    expanded: group.querySelector('.tag-group-head')?.getAttribute('aria-expanded') ?? null,
    collapsed: group.querySelector('.tag-group-body')?.getAttribute('data-collapsed') ?? null,
    height: Math.round(group.getBoundingClientRect().height),
    cards: [...group.querySelectorAll('.tag-card .tag-name-input')].map((input) => input.value),
  })),
  chips: [...document.querySelectorAll('.tag-chip')].map((chip) => chip.textContent?.trim() ?? ''),
}))()`)
const grouped = await readGroups()
const autoGroup = grouped.groups.find((group) => group.cards.includes(autoTag.name))
const rungGroups = grouped.groups.filter((group) => group.title.startsWith('程序段'))
check(
  'tags/grouped-by-rung',
  grouped.view === 'rungs'
    && rungGroups.length >= 1
    && grouped.groups.every((group) => group.title.startsWith('程序段') || group.title === '未引用'),
  grouped.groups.map((group) => group.title + ':' + group.cards.join('|')),
)
check(
  'tags/unused-group-holds-orphan',
  grouped.groups.some((group) => group.title === '未引用' && group.cards.includes('StopBtn')),
  grouped.groups.filter((group) => group.title === '未引用'),
)
check('tags/new-tag-lands-in-its-rung', Boolean(autoGroup) && autoGroup.cards.includes(autoTag.name), autoGroup)
/* 单段示例里没有跨段复用，胶囊在下面的「创建副本」场景里验证。 */
await screenshot('docs/qa/tags-sync-groups.png')

/* 折叠：点分组头收起，卡片退出布局但仍留在 DOM 里；再点一次恢复。 */
const firstGroupId = await evaluate("document.querySelector('.tag-list .tag-group .tag-group-body')?.id ?? null")
await evaluate("document.querySelector('.tag-list .tag-group .tag-group-head')?.click()")
await sleep(560)
const collapsedGroup = (await readGroups()).groups[0]
check(
  'tags/group-collapse',
  collapsedGroup.expanded === 'false'
    && collapsedGroup.collapsed === 'true'
    && collapsedGroup.height < grouped.groups[0].height,
  { before: grouped.groups[0].height, after: collapsedGroup.height },
)
const stillInDom = await evaluate("!!document.getElementById(" + JSON.stringify(firstGroupId) + ")?.querySelector('.tag-card')")
check('tags/collapsed-cards-stay-in-dom', stillInDom === true, firstGroupId)
await screenshot('docs/qa/tags-sync-collapsed.png')
await evaluate("document.querySelector('.tag-list .tag-group .tag-group-head')?.click()")
await sleep(560)
const reopenedGroup = (await readGroups()).groups[0]
check(
  'tags/group-expand',
  reopenedGroup.expanded === 'true'
    && reopenedGroup.collapsed === 'false'
    && Math.abs(reopenedGroup.height - grouped.groups[0].height) <= 2,
  { before: grouped.groups[0].height, after: reopenedGroup.height },
)

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

/* 同一变量出现在第二段时只给胶囊提示，不再重复一张表单；点胶囊跳回维护它的那一段。 */
await evaluate("document.querySelector('.ll-rung-menu summary')?.click()")
await sleep(220)
const duplicated = await evaluate(`(() => {
  const button = [...document.querySelectorAll('.ll-rung-menu-panel button')].find((item) => item.textContent?.trim() === '创建副本')
  if (!button) return false
  button.click()
  return true
})()`)
await sleep(560)
await openTagsPanel()
const shared = await readGroups()
check(
  'tags/shared-variable-chip',
  duplicated && shared.groups.length >= 2 && shared.chips.length > 0,
  { duplicated, chips: shared.chips },
)
check(
  'tags/shared-variable-not-duplicated',
  shared.groups.reduce((total, group) => total + group.cards.length, 0) === restored.count,
  shared.groups.map((group) => group.title + ':' + group.cards.join('|')),
)
const chipPreparation = await evaluate(`(() => {
  const chip = document.querySelector('.tag-chip')
  if (!chip) return null
  const name = chip.textContent?.trim() ?? ''
  const owner = [...document.querySelectorAll('.tag-group')].find((group) =>
    [...group.querySelectorAll('.tag-card .tag-name-input')].some((input) => input.value === name),
  )
  if (!owner) return { name, ownerFound: false }
  const head = owner.querySelector('.tag-group-head')
  const expandedBefore = head?.getAttribute('aria-expanded') ?? null
  head?.click()
  return { name, ownerFound: true, expandedBefore }
})()`)
await sleep(560)
const sharedChipName = chipPreparation?.name ?? ''
const ownerCollapsed = await evaluate(`(() => {
  const name = ${JSON.stringify(sharedChipName)}
  const owner = [...document.querySelectorAll('.tag-group')].find((group) =>
    [...group.querySelectorAll('.tag-card .tag-name-input')].some((input) => input.value === name),
  )
  return {
    expanded: owner?.querySelector('.tag-group-head')?.getAttribute('aria-expanded') ?? null,
    bodyCollapsed: owner?.querySelector('.tag-group-body')?.getAttribute('data-collapsed') ?? null,
  }
})()`)
const chipTouched = await evaluate(`(() => {
  const chip = [...document.querySelectorAll('.tag-chip')].find((item) => item.textContent?.trim() === ${JSON.stringify(sharedChipName)})
  if (!chip) return false
  chip.click()
  return true
})()`)
await sleep(200)
const revealed = await evaluate(`(() => {
  const name = ${JSON.stringify(sharedChipName)}
  const owner = [...document.querySelectorAll('.tag-group')].find((group) =>
    [...group.querySelectorAll('.tag-card .tag-name-input')].some((input) => input.value === name),
  )
  return {
    ownerExpanded: owner?.querySelector('.tag-group-head')?.getAttribute('aria-expanded') ?? null,
    flashedName: owner?.querySelector('.tag-card[data-flash=true] .tag-name-input')?.value ?? null,
  }
})()`)
check(
  'tags/shared-chip-reveals-owner',
  Boolean(chipPreparation?.ownerFound)
    && chipPreparation?.expandedBefore === 'true'
    && ownerCollapsed.expanded === 'false'
    && ownerCollapsed.bodyCollapsed === 'true'
    && chipTouched === true
    && revealed.ownerExpanded === 'true'
    && revealed.flashedName === sharedChipName,
  { chipPreparation, ownerCollapsed, chipTouched, revealed },
)

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
