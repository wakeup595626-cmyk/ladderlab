/** 多标签页同时保存压力回归：验证项目库在 N 个真实标签页并发写入时不丢项目。 */
import { mkdir } from 'node:fs/promises'
import {
  closeQaPage,
  createQaPage,
  DEFAULT_QA_APP_URL,
  DEFAULT_QA_CDP,
  READ_LIBRARY_IN_PAGE,
} from './qa-cdp.mjs'

const CDP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const TAB_COUNT = Math.max(2, Math.min(10, Number(process.env.LADDERLAB_TABS ?? 6)))
const ROUNDS = Math.max(1, Math.min(20, Number(process.env.LADDERLAB_ROUNDS ?? 2)))
const LIBRARY_LOCK_NAME = 'ladderlab.library.v2'
const ACTIVE_KEY = 'ladderlab.library.v1.active'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await mkdir(new URL('../docs/qa/', import.meta.url), { recursive: true })

class PageClient {
  constructor(target, index) {
    this.target = target
    this.index = index
    this.label = `T${index + 1}`
    this.nextId = 0
    this.pending = new Map()
    this.errors = []
  }

  async open() {
    this.socket = new WebSocket(this.target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const request = this.pending.get(message.id)
        if (!request) return
        this.pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error.message))
        else request.resolve(message.result)
        return
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const description = message.params.exceptionDetails?.exception?.description
          ?? message.params.exceptionDetails?.text
          ?? 'exception'
        if (!description.includes('chrome-extension://')) this.errors.push(description)
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        const value = message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
        if (value && !value.includes('chrome-extension://')) this.errors.push(value)
      }
    })
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    }
    return response.result.value
  }

  async waitFor(expression, label, timeout = 8000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await this.evaluate(expression)) return true
      await sleep(50)
    }
    throw new Error(`${this.label} 等待超时：${label}`)
  }

  async navigate() {
    await this.send('Page.navigate', { url: PAGE_URL })
    await this.waitFor("document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')", '应用挂载')
    await sleep(200)
  }

  async reload() {
    await this.send('Page.reload')
    await sleep(150)
    await this.waitFor("document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')", '刷新后应用挂载')
    await sleep(200)
  }

  async click(selector) {
    const clicked = await this.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true })()`)
    if (!clicked) throw new Error(`${this.label} 找不到可点击元素：${selector}`)
  }

  async fill(selector, value) {
    const filled = await this.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); return true })()`)
    if (!filled) throw new Error(`${this.label} 找不到输入框：${selector}`)
  }

  async rename(value) {
    await this.send('Page.bringToFront')
    const focused = await this.evaluate(`(() => { const input = document.querySelector('#project-name'); if (!input) return false; input.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return document.activeElement === input })()`)
    if (!focused) throw new Error(`${this.label} 找不到工程名称输入框`)
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(120)
  }

  library() {
    return this.evaluate(READ_LIBRARY_IN_PAGE)
  }

  activeId() {
    return this.evaluate(`sessionStorage.getItem(${JSON.stringify(ACTIVE_KEY)})`)
  }

  async close() {
    try { this.socket.close() } catch {}
    await closeQaPage(CDP, this.target.id)
  }
}

const url = new URL(APP_URL)
url.searchParams.set('ladderlab-qa', `stress-${process.pid}-${Date.now()}`)
const PAGE_URL = url.href

async function createPage(index) {
  const target = await createQaPage(CDP)
  const page = new PageClient(target, index)
  await page.open()
  return page
}

async function probeCrossTabLocks(pages) {
  const context = await Promise.all(pages.map((page) => page.evaluate(
    '({ hasLocks: Boolean(navigator.locks?.request), secure: isSecureContext, origin: location.origin })',
  )))
  if (context.some((item) => !item.hasLocks)) return { supported: false, context }
  const identities = await Promise.all(pages.map(async (page, index) => {
    const tag = `P${index}`
    await page.evaluate(`window.__qaPageTag = ${JSON.stringify(tag)}; true`)
    const read = await page.evaluate('({ tag: window.__qaPageTag, href: location.href, timeOrigin: performance.timeOrigin, title: document.title })')
    return { expected: tag, ...read }
  }))
  const identityOk = identities.every((item) => item.tag === item.expected)
    && new Set(identities.map((item) => item.timeOrigin)).size === pages.length

  const holdPromise = pages[1].evaluate(`navigator.locks.request(${JSON.stringify(LIBRARY_LOCK_NAME)}, { mode: 'exclusive' }, async () => {
    localStorage.setItem('__qa_hold_probe', 'held')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    localStorage.removeItem('__qa_hold_probe')
  })`)
  await sleep(120)
  const heldInOtherPage = await pages[0].evaluate("navigator.locks.query().then((state) => state.held.map((lock) => lock.name))")
  const waitForOtherPage = await pages[0].evaluate(`(async () => {
    const started = performance.now()
    await navigator.locks.request(${JSON.stringify(LIBRARY_LOCK_NAME)}, { mode: 'exclusive' }, async () => {})
    return Math.round(performance.now() - started)
  })()`)
  await holdPromise

  const overlapKey = '__qa_lock_overlap'
  // Probe writes below are inspected after all pages settle.
  await pages[0].evaluate(`localStorage.removeItem(${JSON.stringify(overlapKey)}); true`)
  const [holderTiming, waiterTiming] = await Promise.all([
    pages[0].evaluate(`(async () => {
      const startedAt = Date.now()
      await navigator.locks.request(${JSON.stringify(LIBRARY_LOCK_NAME)}, { mode: 'exclusive' }, async () => {
        localStorage.setItem(${JSON.stringify(overlapKey)}, JSON.stringify({ page: 'P0', active: true, startedAt }))
        await new Promise((resolve) => setTimeout(resolve, 420))
        const current = JSON.parse(localStorage.getItem(${JSON.stringify(overlapKey)}) ?? 'null')
        localStorage.setItem(${JSON.stringify(overlapKey)}, JSON.stringify({ ...current, active: false, endedAt: Date.now() }))
      })
      return { startedAt, endedAt: Date.now() }
    })()`),
    pages[1].evaluate(`(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      const requestedAt = Date.now()
      const grantedAt = await navigator.locks.request(${JSON.stringify(LIBRARY_LOCK_NAME)}, { mode: 'exclusive' }, async () => {
        const prior = JSON.parse(localStorage.getItem(${JSON.stringify(overlapKey)}) ?? 'null')
        localStorage.setItem(${JSON.stringify(overlapKey)}, JSON.stringify({ ...prior, overlappingPage: 'P1', requestedAt, grantedAt: Date.now(), sawActive: prior?.active === true }))
        return Date.now()
      })
      return { requestedAt, grantedAt }
    })()`),
  ])
  await pages[0].evaluate(`localStorage.removeItem(${JSON.stringify(overlapKey)}); true`)
  const overlapRecord = { holderTiming, waiterTiming }
  const lockOverlapped = waiterTiming.grantedAt < holderTiming.endedAt

  const roundsPerPage = 10
  const tasks = pages.flatMap((page, pageIndex) => Array.from({ length: roundsPerPage }, (_, roundIndex) => page.evaluate(`(async () => {
    const requestedAt = Date.now()
    return navigator.locks.request('__qa_cross_tab_probe', { mode: 'exclusive' }, async () => {
      const enteredAt = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 15))
      return { page: ${pageIndex}, round: ${roundIndex}, requestedAt, enteredAt, endedAt: Date.now() }
    })
  })()`)))
  const records = await Promise.all(tasks)
  const sortedRecords = records.slice().sort((left, right) => left.enteredAt - right.enteredAt)
  const overlappingSlices = sortedRecords.slice(1).filter((record, index) => record.enteredAt < sortedRecords[index].endedAt)
  const waits = records.map((record) => record.enteredAt - record.requestedAt)
  const expectedCounter = pages.length * roundsPerPage
  return {
    supported: true,
    context,
    identities,
    identityOk,
    heldInOtherPage,
    waitForOtherPage,
    lockOverlapped,
    overlapRecord,
    expected: expectedCounter,
    counter: records.length,
    overlappingSlices,
    maxWaitMs: Math.round(Math.max(...waits)),
    serialized: records.length === expectedCounter && overlappingSlices.length === 0,
  }
}

const rounds = []
let failures = 0
for (let round = 1; round <= ROUNDS; round += 1) {
  const pages = []
  try {
    for (let index = 0; index < TAB_COUNT; index += 1) pages.push(await createPage(index))
    await Promise.all(pages.map((page) => page.navigate()))
    await pages[0].evaluate(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('ladderlab.coach.v1', 'seen'); true`)
    await Promise.all(pages.map((page) => page.reload()))
    if (round === 1) {
      const lockProbe = await probeCrossTabLocks(pages)
      console.log(JSON.stringify({ lockProbe }, null, 2))
      if (!lockProbe.supported || !lockProbe.identityOk || lockProbe.lockOverlapped || !lockProbe.serialized) failures += 1
    }

    const names = pages.map((page, index) => `压力测试 R${round} T${index + 1}`)
    for (let index = 0; index < pages.length; index += 1) {
      await pages[index].rename(names[index])
    }
    for (const page of pages) {
      await page.click('.wb-save-button')
      await page.waitFor("!!document.querySelector('#save-project-name')", '保存框')
    }
    for (let index = 0; index < pages.length; index += 1) {
      await pages[index].fill('#save-project-name', names[index])
    }
    await sleep(80)
    const startedAt = Date.now()
    await Promise.all(pages.map((page) => page.click('.save-project-confirm')))

    const dialogsClosed = await Promise.all(pages.map(async (page) => {
      try {
        await page.waitFor("!document.querySelector('.save-project-dialog')", '保存框关闭')
        return true
      } catch {
        return false
      }
    }))
    const expectedNames = [...names].sort()
    // 保存框关闭只代表本页交互结束；跨标签页写入与 React 状态提交可能
    // 落在不同任务里，轮询到所有项目出现或超时，避免把慢标签页误判为丢数据。
    let library = null
    let storedNames = []
    const observeDeadline = Date.now() + 12_000
    while (Date.now() < observeDeadline) {
      library = await pages[0].library()
      storedNames = (library?.projects ?? []).map((project) => project.program?.name).sort()
      if (storedNames.length === expectedNames.length
        && expectedNames.every((name) => storedNames.includes(name))) break
      await sleep(150)
    }
    const allPresent = storedNames.length === expectedNames.length
      && expectedNames.every((name) => storedNames.includes(name))
    const identities = await Promise.all(pages.map((page) => page.activeId()))
    const idsByIdName = new Map((library?.projects ?? []).map((project) => [project.program?.name, project.id]))
    const identitiesOk = identities.every((id, index) => id && id === idsByIdName.get(names[index]))
    const errors = pages.flatMap((page) => page.errors.map((error) => `${page.label}: ${error}`))
    const ok = dialogsClosed.every(Boolean) && allPresent && identitiesOk && errors.length === 0
    if (!ok) failures += 1
    rounds.push({
      round,
      tabs: TAB_COUNT,
      elapsedMs: Date.now() - startedAt,
      ok,
      dialogsClosed,
      expectedNames,
      storedNames,
      identities,
      errors,
    })
    console.log(`第 ${round}/${ROUNDS} 轮：${ok ? 'PASS' : 'FAIL'}（${TAB_COUNT} 标签页，${Date.now() - startedAt}ms）`)
    if (!ok) console.log(JSON.stringify(rounds.at(-1), null, 2))
  } finally {
    await Promise.all(pages.map((page) => page.close()))
  }
}

console.log(JSON.stringify({ tabs: TAB_COUNT, rounds: ROUNDS, failures, details: rounds }, null, 2))
if (failures > 0) process.exitCode = 1
