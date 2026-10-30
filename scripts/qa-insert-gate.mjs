#!/usr/bin/env node
/**
 * 收藏指令插入门禁验收：先点图纸上的 +，收藏触点、分支、合并才会改工程。
 */
import { chromium } from '@playwright/test'

const APP_URL = process.env.LADDERLAB_URL ?? 'http://127.0.0.1:5199/'
const SHOT_DIR = process.env.LADDERLAB_SHOT_DIR ?? ''

const tag = (name, address) => ({
  id: name + '-tag',
  name,
  address,
  kind: 'BOOL',
  initial: false,
  comment: '',
})

const PROGRAM = {
  schema: 1,
  name: '插入门禁验收',
  profile: 'v14',
  tags: ['A', 'B', 'C', 'D', 'Q1'].map((name, index) => tag(name, `%M${index}.0`)),
  rungs: [{
    id: 'gate-r1',
    label: '插入门禁',
    nodes: [{ type: 'contact', id: 'gate-a', kind: 'NO', tag: 'A' }],
    output: { id: 'gate-q1', kind: 'COIL', tag: 'Q1' },
  }],
}

function record(program) {
  const savedAt = Date.now()
  return {
    schema: 2,
    id: 'insert-gate-project',
    createdAt: savedAt,
    savedAt,
    revision: String(savedAt),
    program,
  }
}

function check(list, id, ok, detail, data) {
  list.push({ id, ok: Boolean(ok), detail, ...(data === undefined ? {} : { data }) })
}

function structureOf(snapshot) {
  return JSON.stringify({
    contacts: snapshot.contacts.map(({ id, path }) => ({ id, path })),
    outputs: snapshot.outputs,
    parallels: snapshot.parallels,
    openBranches: snapshot.openBranches,
  })
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
})
await context.addInitScript((payload) => {
  window.localStorage.clear()
  window.localStorage.setItem('ladderlab.coach.v1', 'seen')
  window.localStorage.setItem('ladderlab.library.v2.ready', JSON.stringify({ schema: 2 }))
  window.localStorage.setItem(
    'ladderlab.library.v2.project.insert-gate-project',
    JSON.stringify(payload),
  )
  window.sessionStorage.setItem('ladderlab.library.v1.active', 'insert-gate-project')
}, record(PROGRAM))

const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push('page: ' + error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push('console: ' + message.text())
})

const sleep = (ms) => page.waitForTimeout(ms)
const evaluate = (source) => page.evaluate(source)

async function waitFor(source, label, timeout = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(source)) return true
    await sleep(50)
  }
  throw new Error('等待超时：' + label)
}

async function clickText(selector, text) {
  return evaluate(`(() => {
    const item = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((element) => element.textContent?.includes(${JSON.stringify(text)}))
    if (!item || item.disabled) return false
    item.click()
    return true
  })()`)
}

async function toastText() {
  return evaluate(`document.querySelector('.toast-message')?.textContent?.trim() ?? ''`)
}

async function snapshot() {
  return evaluate(`(() => ({
    contacts: [...document.querySelectorAll('.ll-node[data-node-id]')].map((node) => ({
      id: node.dataset.nodeId,
      path: node.dataset.nodePath ?? '',
    })),
    outputs: [...document.querySelectorAll('[data-output-id]')]
      .map((node) => node.dataset.outputId),
    parallels: document.querySelectorAll('.ll-parallel').length,
    openBranches: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  }))()`)
}

await page.goto(APP_URL, { waitUntil: 'load' })
await page.waitForSelector('.ll-rung[data-rung-id="gate-r1"] .ll-contact', { timeout: 8000 })
await sleep(500)

const checks = []
const initialSnapshot = await snapshot()
const initialTarget = await evaluate(`(() => {
  const control = document.querySelector('.wb-instruction-strip .wb-insert-target')
  const select = control?.querySelector('select')
  const locate = control?.querySelector('.wb-insert-target-locate')
  return {
    empty: control?.classList.contains('is-empty') === true,
    value: select?.value ?? null,
    option: select?.selectedOptions?.[0]?.textContent?.trim() ?? null,
    locateDisabled: locate?.disabled === true,
  }
})()`)
check(
  checks,
  'initial/no-target',
  initialTarget.empty
    && initialTarget.value === ''
    && initialTarget.option === '点 + 选位置'
    && initialTarget.locateDisabled,
  initialTarget,
)

// 没有图纸上的 + 时，收藏触点只能提示，不能改工程。
const clickedNo = await clickText('.wb-instruction-button', '常开')
await sleep(120)
const afterNo = await snapshot()
const noToast = await toastText()
check(
  checks,
  'initial/favorite-contact-blocked',
  clickedNo
    && structureOf(afterNo) === structureOf(initialSnapshot)
    && noToast.includes('请先在图纸上点 + 选择插入位'),
  { clickedNo, toast: noToast },
)

// 输出收藏同样需要先选程序段，不能替换默认段末线圈。
const clickedCoil = await clickText('.wb-instruction-button', '线圈')
await sleep(120)
const afterCoil = await snapshot()
const coilToast = await toastText()
check(
  checks,
  'initial/favorite-output-blocked',
  clickedCoil
    && structureOf(afterCoil) === structureOf(initialSnapshot)
    && coilToast.includes('请先在图纸上点 + 选择程序段，再选输出指令'),
  { clickedCoil, toast: coilToast },
)

const clickedBranch = await clickText('.wb-construct-button', '分支')
await sleep(120)
const afterBranchButton = await snapshot()
const branchToast = await toastText()
check(
  checks,
  'initial/branch-blocked',
  clickedBranch
    && structureOf(afterBranchButton) === structureOf(initialSnapshot)
    && branchToast.includes('请先在图纸上点 + 选择分叉位置'),
  { clickedBranch, toast: branchToast },
)

const clickedMerge = await clickText('.wb-construct-button', '合并')
await sleep(120)
const afterMergeButton = await snapshot()
const mergeToast = await toastText()
const mergeCandidatesBeforeTarget = await evaluate(
  `document.querySelectorAll('.ll-slot.is-merge-candidate').length`,
)
check(
  checks,
  'initial/merge-blocked',
  clickedMerge
    && structureOf(afterMergeButton) === structureOf(initialSnapshot)
    && mergeCandidatesBeforeTarget === 0
    && mergeToast.includes('请先在图纸上点 + 选择要合并的程序段'),
  { clickedMerge, toast: mergeToast, mergeCandidatesBeforeTarget },
)

// 点主线路上的 +，再按 Esc 收起菜单：落点本身仍然保留。
const openedFirstTarget = await evaluate(`(() => {
  const slot = document.querySelector('.ll-rung[data-rung-id="gate-r1"] .ll-slot[data-chain=""][data-index="1"]')
  const plus = slot?.querySelector('.ll-slot-plus')
  if (!plus) return false
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await waitFor(`!!document.querySelector('.ll-slot-menu[role="menu"]')`, '插入菜单打开')
await page.keyboard.press('Escape')
await waitFor(`!document.querySelector('.ll-slot-menu')`, '插入菜单关闭')
await sleep(100)
const armedTarget = await evaluate(`(() => {
  const control = document.querySelector('.wb-instruction-strip .wb-insert-target')
  const select = control?.querySelector('select')
  return {
    empty: control?.classList.contains('is-empty') === true,
    rungId: select?.value ?? null,
    option: select?.selectedOptions?.[0]?.textContent?.trim() ?? null,
    locateDisabled: control?.querySelector('.wb-insert-target-locate')?.disabled === true,
    targetIndex: document.querySelector('.ll-slot.is-favorite-target')?.dataset.index ?? null,
  }
})()`)
check(
  checks,
  'target/plus-arms-cursor',
  openedFirstTarget
    && !armedTarget.empty
    && armedTarget.rungId === 'gate-r1'
    && armedTarget.option === '程序段 1'
    && !armedTarget.locateDisabled
    && armedTarget.targetIndex === '1',
  { openedFirstTarget, ...armedTarget },
)

const noClickedFromTarget = await clickText('.wb-instruction-button', '常开')
await waitFor(
  `document.querySelectorAll('.ll-node[data-node-id]').length === 2`,
  '收藏常开触点插入',
)
await sleep(100)
const afterFirstFavorite = await snapshot()
const firstFavoriteTarget = await evaluate(`(() => ({
  index: document.querySelector('.ll-slot.is-favorite-target')?.dataset.index ?? null,
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? '',
}))()`)
const firstNew = afterFirstFavorite.contacts.find(
  (node) => !initialSnapshot.contacts.some((old) => old.id === node.id),
)
check(
  checks,
  'target/first-favorite-appends',
  noClickedFromTarget
    && firstNew?.path === '1'
    && firstFavoriteTarget.index === '2'
    && String(firstFavoriteTarget.toast).includes('已插入到程序段 1'),
  { noClickedFromTarget, firstNew, ...firstFavoriteTarget },
)

const ncClickedFromTarget = await clickText('.wb-instruction-button', '常闭')
await waitFor(
  `document.querySelectorAll('.ll-node[data-node-id]').length === 3`,
  '收藏常闭触点插入',
)
await sleep(100)
const afterSecondFavorite = await snapshot()
const secondTarget = await evaluate(
  `document.querySelector('.ll-slot.is-favorite-target')?.dataset.index ?? null`,
)
const secondNew = afterSecondFavorite.contacts.find(
  (node) => !afterFirstFavorite.contacts.some((old) => old.id === node.id),
)
check(
  checks,
  'target/second-favorite-appends',
  ncClickedFromTarget && secondNew?.path === '2' && secondTarget === '3',
  { ncClickedFromTarget, secondNew, secondTarget },
)

// 重新选同一位置并打开并联分支；收藏触点应只落在当前草稿支路。
await evaluate(`(() => {
  const plus = document.querySelector('.ll-rung[data-rung-id="gate-r1"] .ll-slot[data-chain=""][data-index="1"] .ll-slot-plus')
  if (!plus) return false
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await waitFor(`!!document.querySelector('.ll-slot-menu[role="menu"]')`, '再次打开插入菜单')
const openedDraftFromMenu = await clickText('.ll-slot-menu-item[role="menuitem"]', '加入并联分支')
await waitFor(
  `document.querySelectorAll('.ll-parallel.is-branch-open').length === 1`,
  '草稿支路打开',
)
await sleep(120)
const draftState = await evaluate(`(() => {
  const group = document.querySelector('.ll-parallel.is-branch-open')
  const selectedPath = document.querySelector('.ll-node.is-selected')?.dataset.nodePath ?? ''
  const parts = selectedPath.split('.')
  const chain = parts.length > 1 ? parts.slice(0, -1).join('.') : ''
  return {
    selectedPath,
    chain,
    contacts: [...group.querySelectorAll('.ll-node[data-node-id]')]
      .map((node) => ({ id: node.dataset.nodeId, path: node.dataset.nodePath ?? '' }))
      .filter((node) => node.path.startsWith(chain + '.')),
  }
})()`)
check(
  checks,
  'branch/opens-with-explicit-target',
  openedDraftFromMenu && draftState.chain !== '' && draftState.contacts.length === 1,
  { openedDraftFromMenu, ...draftState },
)

const beforeBranchFavorite = await evaluate(`(() => ({
  ids: [...document.querySelectorAll('.ll-node[data-node-id]')]
    .map((node) => node.dataset.nodeId),
}))()`)
const ncInBranch = await clickText('.wb-instruction-button', '常闭')
await waitFor(
  `document.querySelectorAll('.ll-node[data-node-id]').length === ${beforeBranchFavorite.ids.length + 1}`,
  '支路内收藏常闭触点',
)
await sleep(120)
const afterBranchFavorite = await evaluate(`(() => {
  const group = document.querySelector('.ll-parallel.is-branch-open')
  return {
    open: document.querySelectorAll('.ll-parallel.is-branch-open').length,
    contacts: [...group.querySelectorAll('.ll-node[data-node-id]')]
      .map((node) => ({ id: node.dataset.nodeId, path: node.dataset.nodePath ?? '' }))
      .filter((node) => node.path.startsWith('${draftState.chain}.')),
  }
})()`)
const branchNew = afterBranchFavorite.contacts.find(
  (node) => !beforeBranchFavorite.ids.includes(node.id),
)
check(
  checks,
  'branch/favorite-stays-in-branch',
  ncInBranch
    && afterBranchFavorite.open === 1
    && afterBranchFavorite.contacts.length === 2
    && Boolean(branchNew?.path.startsWith(draftState.chain + '.')),
  { ncInBranch, chain: draftState.chain, branchNew, afterBranchFavorite },
)

const clickedMergeWithTarget = await clickText('.wb-construct-button', '合并')
await waitFor(
  `document.querySelectorAll('.ll-slot.is-merge-candidate').length > 0`,
  '主线合入点亮',
)
const mergeArmed = await evaluate(`(() => ({
  candidates: document.querySelectorAll('.ll-slot.is-merge-candidate').length,
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? '',
}))()`)
check(
  checks,
  'merge/top-arms-candidates',
  clickedMergeWithTarget
    && mergeArmed.candidates > 0
    && String(mergeArmed.toast).includes('请点主线上标「合」的 + 选择合并位置'),
  { clickedMergeWithTarget, ...mergeArmed },
)

const pickedMergeSlot = await evaluate(`(() => {
  const plus = document.querySelector('.ll-slot.is-merge-candidate .ll-slot-plus')
  if (!plus) return false
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await waitFor(
  `document.querySelectorAll('.ll-parallel.is-branch-open').length === 0`,
  '草稿支路闭合',
)
await sleep(120)
const mergedState = await evaluate(`(() => ({
  open: document.querySelectorAll('.ll-parallel.is-branch-open').length,
  candidates: document.querySelectorAll('.ll-slot.is-merge-candidate').length,
  parallels: document.querySelectorAll('.ll-parallel').length,
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? '',
}))()`)
check(
  checks,
  'merge/closes-at-chosen-slot',
  pickedMergeSlot
    && mergedState.open === 0
    && mergedState.candidates === 0
    && mergedState.parallels === 1
    && String(mergedState.toast).includes('并联分支已闭合'),
  { pickedMergeSlot, ...mergedState },
)

checks.push({
  id: 'browser/errors',
  ok: errors.length === 0,
  detail: errors.length === 0 ? '[]' : errors.join(' | '),
})

for (const result of checks) {
  process.stdout.write(
    `${result.ok ? 'PASS' : 'FAIL'} ${result.id}`
    + (result.detail === undefined
      ? ''
      : '  ' + (typeof result.detail === 'string'
        ? result.detail
        : JSON.stringify(result.detail)))
    + '\n',
  )
}

if (SHOT_DIR) {
  await page.screenshot({
    path: `${SHOT_DIR}/insert-gate-final.png`,
    fullPage: false,
  })
}

await context.close()
await browser.close()

if (checks.some((result) => !result.ok)) {
  process.exitCode = 1
} else {
  process.stdout.write(`PASS insert-gate (${checks.length} checks)\n`)
}









