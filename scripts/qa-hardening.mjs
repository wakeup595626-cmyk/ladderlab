/**
 * 发布前加固回归：原型名变量、最大并联深度和“运行”按钮的真实行为。
 *
 * 依赖一个带 CDP 的 Chromium 页面：
 *   npm run preview
 *   msedge --headless=new --remote-debugging-port=9444
 *   node scripts/qa-hardening.mjs
 *
 * 程序会在新文档创建前注入，避免被测页面在 pagehide 时把旧工程写回草稿。
 */
import { DEFAULT_QA_APP_URL, DEFAULT_QA_CDP } from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const TAB_KEY = 'ladderlab.project.v1.tab.v2'
const MIRROR_KEY = 'ladderlab.project.v1.mirror.v2'
const LEGACY_KEY = 'ladderlab.project.v1'
const ACTIVE_LIBRARY_KEY = 'ladderlab.library.v1.active'
const LIBRARY_KEY = 'ladderlab.library.v1'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms)
    }),
  ])
}

class PageClient {
  constructor(target, label) {
    this.target = target
    this.label = label
    this.nextId = 0
    this.pending = new Map()
    this.errors = []
  }

  async open() {
    this.socket = new WebSocket(this.target.webSocketDebuggerUrl)
    await withTimeout(new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    }), 5000, 'WebSocket open')
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
        const details = message.params.exceptionDetails
        if (JSON.stringify(details).includes('chrome-extension://')) return
        this.errors.push(details?.exception?.description ?? details?.text ?? 'exception')
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        const text = message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
        if (text && !text.includes('chrome-extension://')) this.errors.push(text)
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

  send(method, params = {}, timeout = 8000) {
    const id = ++this.nextId
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
    return withTimeout(promise, timeout, method).finally(() => this.pending.delete(id))
  }

  async evaluate(expression, timeout = 5000) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeout)
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    }
    return response.result.value
  }

  async waitFor(expression, label, timeout = 6000) {
    const started = Date.now()
    let lastError
    while (Date.now() - started < timeout) {
      try {
        if (await this.evaluate(expression, Math.min(1500, timeout))) return
      } catch (error) {
        lastError = error
      }
      await sleep(60)
    }
    throw new Error(`${this.label} 等待超时：${label}${lastError ? ` / ${lastError.message}` : ''}`)
  }

  async click(selector) {
    const clicked = await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node) return false
      node.click()
      return true
    })()`)
    if (!clicked) throw new Error(`${this.label} 找不到可点击元素：${selector}`)
  }

  async injectAndOpen(program, slug) {
    const envelope = {
      schema: 2,
      tabId: `hardening-${slug}-${Date.now()}`,
      projectId: null,
      baseSavedAt: null,
      savedAt: Date.now(),
      program,
    }
    const raw = JSON.stringify(envelope)
    const source = `(() => {
      try {
        sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, ${JSON.stringify(raw)})
        sessionStorage.removeItem(${JSON.stringify(ACTIVE_LIBRARY_KEY)})
        localStorage.removeItem(${JSON.stringify(MIRROR_KEY)})
        localStorage.removeItem(${JSON.stringify(LEGACY_KEY)})
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
          const key = localStorage.key(index)
          if (key?.startsWith('ladderlab.library.v2.')) localStorage.removeItem(key)
        }
        localStorage.removeItem(${JSON.stringify(LIBRARY_KEY)})
        localStorage.setItem('ladderlab.coach.v1', 'seen')
      } catch (error) {
        window.__hardeningStorageError = String(error)
      }
    })()`
    const installed = await this.send('Page.addScriptToEvaluateOnNewDocument', { source })
    const started = Date.now()
    try {
      await this.send('Page.navigate', {
        url: `${APP_URL}?qa-hardening=${encodeURIComponent(slug)}&t=${Date.now()}`,
      })
      await this.waitFor("document.readyState === 'complete' && !!document.querySelector('.wb-topbar')", '应用挂载', 10000)
      return { elapsedMs: Date.now() - started }
    } finally {
      await this.send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: installed.identifier,
      }).catch(() => {})
    }
  }

  close() {
    try { this.socket?.close() } catch {}
  }
}

async function createPage(label) {
  const response = await withTimeout(
    fetch(`${CDP_HTTP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }),
    5000,
    '新建标签页',
  )
  if (!response.ok) throw new Error(`无法创建新标签页：HTTP ${response.status}`)
  const page = new PageClient(await response.json(), label)
  await page.open()
  return page
}

function tag(id, name, kind, initial, address) {
  return { id, name, address, kind, initial, comment: '' }
}

function contact(id, tagName, kind = 'NO') {
  return { type: 'contact', id, kind, tag: tagName }
}

function coil(id, tagName, kind = 'COIL') {
  return { id, kind, tag: tagName }
}

function program(name, tags, rungs) {
  return { schema: 1, name, profile: 'v21', tags, rungs }
}

function prototypeProgram() {
  return program('原型名变量端到端', [
    tag('proto', '__proto__', 'BOOL', false, '%M0.0'),
    tag('ctor', 'constructor', 'BOOL', false, '%M0.1'),
    tag('tostring', 'toString', 'BOOL', false, '%M0.2'),
    tag('a', 'OUT_PROTO', 'BOOL', false, '%Q0.0'),
    tag('b', 'OUT_CTOR', 'BOOL', false, '%Q0.1'),
    tag('c', 'OUT_TOSTRING', 'BOOL', false, '%Q0.2'),
  ], [
    { id: 'r-proto', label: 'proto', nodes: [contact('c-proto', '__proto__')], output: coil('o-proto', 'OUT_PROTO') },
    { id: 'r-ctor', label: 'ctor', nodes: [contact('c-ctor', 'constructor')], output: coil('o-ctor', 'OUT_CTOR') },
    { id: 'r-tostring', label: 'tostring', nodes: [contact('c-tostring', 'toString')], output: coil('o-tostring', 'OUT_TOSTRING') },
  ])
}

function prototypeIntProgram() {
  return program('原型名 INT 比较', [
    tag('proto-int', '__proto__', 'INT', 5, '%MW0'),
    tag('ctor-int', 'constructor', 'INT', 7, '%MW2'),
    tag('tostring-int', 'toString', 'INT', 9, '%MW4'),
    tag('a', 'INT_PROTO_OK', 'BOOL', false, '%Q0.0'),
    tag('b', 'INT_CTOR_OK', 'BOOL', false, '%Q0.1'),
    tag('c', 'INT_TOSTRING_OK', 'BOOL', false, '%Q0.2'),
  ], [
    {
      id: 'r-int-proto',
      label: 'int-proto',
      nodes: [{ type: 'contact', id: 'c-int-proto', kind: 'CMP', tag: '__proto__', compare: { op: '==', value: 5 } }],
      output: coil('o-int-proto', 'INT_PROTO_OK'),
    },
    {
      id: 'r-int-ctor',
      label: 'int-ctor',
      nodes: [{ type: 'contact', id: 'c-int-ctor', kind: 'CMP', tag: 'constructor', compare: { op: '==', value: 7 } }],
      output: coil('o-int-ctor', 'INT_CTOR_OK'),
    },
    {
      id: 'r-int-tostring',
      label: 'int-tostring',
      nodes: [{ type: 'contact', id: 'c-int-tostring', kind: 'CMP', tag: 'toString', compare: { op: '==', value: 9 } }],
      output: coil('o-int-tostring', 'INT_TOSTRING_OK'),
    },
  ])
}

function deepParallelProgram(depth, name) {
  let chain = [contact('leaf', 'M')]
  for (let index = depth; index >= 1; index -= 1) {
    chain = [{
      type: 'parallel',
      id: `par-${index}`,
      branches: [chain, [contact(`sibling-${index}`, 'M')]],
    }]
  }
  return program(name, [
    tag('m', 'M', 'BOOL', false, '%M0.0'),
    tag('y', 'Y', 'BOOL', false, '%Q0.0'),
  ], [{ id: 'deep-rung', label: 'deep', nodes: chain, output: coil('deep-out', 'Y') }])
}

function compileErrorProgram() {
  return program('编译错误运行按钮', [
    tag('ok', 'OK', 'BOOL', false, '%M0.0'),
    tag('out', 'OUT', 'BOOL', false, '%Q0.0'),
  ], [
    { id: 'bad-rung', label: 'bad', nodes: [contact('missing-contact', 'NOT_DECLARED')], output: coil('bad-out', 'OUT') },
  ])
}

async function openTagMonitor(page) {
  if (!(await page.evaluate("Boolean(document.querySelector('.inspector'))"))) {
    const clicked = await page.evaluate(`(() => {
      const button = document.querySelector('[data-inspector-entry="tags"]')
      button?.click()
      return Boolean(button)
    })()`)
    if (!clicked) throw new Error('找不到变量表入口')
    await page.waitFor("!!document.querySelector('.inspector')", '属性面板展开')
  }
  await page.click('#inspector-tab-tags')
  await page.waitFor("!!document.querySelector('.tags-panel .tag-card')", '变量卡片显示')
  // 变量表默认按程序段折叠，只挂载展开组的卡片；验收原型名变量时切到平铺视图。
  await page.evaluate("(() => { const button = [...document.querySelectorAll('.tags-toolbar button')].find((item) => item.textContent.trim() === '全部'); button?.click(); return Boolean(button) })()")
  await page.waitFor("document.querySelector('.tag-list')?.getAttribute('data-view') === 'list'", '变量表平铺显示')
}

async function monitorRows(page) {
  return page.evaluate(`(() => [...document.querySelectorAll('.tag-card')].map((row) => ({
    name: row.querySelector('.tag-name-input')?.value ?? null,
    bool: row.querySelector('.live-value')?.textContent?.trim() ?? null,
    int: row.querySelector('.runtime-input')?.value ?? null,
    pressed: row.querySelector('.live-value')?.getAttribute('aria-pressed') ?? null,
  })))()`)
}

async function toggleBool(page, name) {
  const toggled = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('.tag-card')].find((item) => item.querySelector('.tag-name-input')?.value === ${JSON.stringify(name)})
    const button = row?.querySelector('.live-value')
    button?.click()
    return Boolean(button)
  })()`)
  if (!toggled) throw new Error(`变量表里找不到 BOOL 变量 ${name}`)
  await page.waitFor(`(() => {
    const row = [...document.querySelectorAll('.tag-card')].find((item) => item.querySelector('.tag-name-input')?.value === ${JSON.stringify(name)})
    return row?.querySelector('.live-value')?.getAttribute('aria-pressed') === 'true'
  })()`, `${name} 切换为 TRUE`)
}

async function ensureRunning(page) {
  if (!(await page.evaluate("document.querySelector('.wb-run-toggle')?.classList.contains('is-running')"))) {
    await page.click('.wb-run-toggle')
    await page.waitFor("document.querySelector('.wb-run-toggle')?.classList.contains('is-running')", '仿真运行')
  }
  await sleep(450)
}

const checks = {}
const details = {}
const check = (name, value, note) => {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
}

let page
try {
  page = await createPage('hardening')

  const depth32 = deepParallelProgram(32, '深度 32 层合法工程')
  const depth32Open = await page.injectAndOpen(depth32, 'depth-32')
  await page.waitFor("document.querySelector('#project-name')?.value === '深度 32 层合法工程'", '32 层工程显示', 5000)
  const depth32Render = await page.evaluate(`(() => ({
    name: document.querySelector('#project-name')?.value ?? null,
    recovery: Boolean(document.querySelector('.recovery-banner')),
    contacts: document.querySelectorAll('.ll-contact').length,
    parallels: document.querySelectorAll('.ll-parallel').length,
    branches: document.querySelectorAll('[data-parallel-branch-side="right"]').length,
    width: document.querySelector('.ll-rung')?.getBoundingClientRect().width ?? 0,
  }))()`)
  check('deep/32-valid-mounts', depth32Render.name === depth32.name && !depth32Render.recovery, {
    ...depth32Open,
    ...depth32Render,
  })
  check('deep/32-valid-within-3s', depth32Open.elapsedMs < 3000, { elapsedMs: depth32Open.elapsedMs })
  // 32 层“并联套并联”是等价的大 OR，渲染层会主动摊平成 1 组 33 条支路。
  check(
    'deep/32-renders-full-tree',
    depth32Render.contacts === 33 && depth32Render.parallels === 1 && depth32Render.branches === 33,
    depth32Render,
  )

  const depth33 = deepParallelProgram(33, '深度 33 层非法工程')
  const depth33Open = await page.injectAndOpen(depth33, 'depth-33')
  await page.waitFor("!!document.querySelector('.recovery-banner')", '33 层恢复提示', 6000)
  const depth33State = await page.evaluate(`(() => ({
    name: document.querySelector('#project-name')?.value ?? null,
    recovery: Boolean(document.querySelector('.recovery-banner')),
    title: document.querySelector('#recovery-title')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    detail: document.querySelector('.recovery-detail')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    body: document.body.innerText.slice(0, 500),
  }))()`)
  // 存储层统一给出可恢复提示；具体“超过 32 层”由 io/compile 单测直接覆盖。
  check('deep/33-rejected', depth33State.recovery && Boolean(depth33State.detail), { ...depth33Open, ...depth33State })

  const protoBool = prototypeProgram()
  const protoBoolOpen = await page.injectAndOpen(protoBool, 'proto-bool')
  await page.waitFor(`document.querySelector('#project-name')?.value === ${JSON.stringify(protoBool.name)}`, 'BOOL 原型名工程显示')
  await openTagMonitor(page)
  const boolBefore = await monitorRows(page)
  await toggleBool(page, '__proto__')
  await toggleBool(page, 'constructor')
  await toggleBool(page, 'toString')
  await ensureRunning(page)
  const boolAfter = await monitorRows(page)
  const boolPower = await page.evaluate("document.querySelectorAll('.ll-power-text').length")
  const boolOutputs = Object.fromEntries(boolAfter.map((row) => [row.name, row.bool]))
  check('proto/bool-values-toggle', boolOutputs.__proto__ === 'TRUE' && boolOutputs.constructor === 'TRUE' && boolOutputs.toString === 'TRUE', {
    open: protoBoolOpen,
    before: boolBefore,
    after: boolAfter,
    powerTexts: boolPower,
  })
  check('proto/bool-coils-power', boolOutputs.OUT_PROTO === 'TRUE' && boolOutputs.OUT_CTOR === 'TRUE' && boolOutputs.OUT_TOSTRING === 'TRUE', boolOutputs)
  const runtimeObjects = await page.evaluate(`(() => ({
    objectPolluted: Object.prototype.polluted,
    freshPolluted: ({}).polluted,
    objectTag: Object.prototype.toString.call({}),
  }))()`)
  check('proto/bool-runtime-objects-clean', runtimeObjects.objectPolluted === undefined
    && runtimeObjects.freshPolluted === undefined
    && runtimeObjects.objectTag === '[object Object]', runtimeObjects)

  const protoInt = prototypeIntProgram()
  const protoIntOpen = await page.injectAndOpen(protoInt, 'proto-int')
  await page.waitFor(`document.querySelector('#project-name')?.value === ${JSON.stringify(protoInt.name)}`, 'INT 原型名工程显示')
  await openTagMonitor(page)
  const intBefore = await monitorRows(page)
  await ensureRunning(page)
  const intAfter = await monitorRows(page)
  const intOutputs = Object.fromEntries(intAfter.map((row) => [row.name, row.bool]))
  check('proto/int-initial-values', intBefore.some((row) => row.name === '__proto__' && row.int === '5')
    && intBefore.some((row) => row.name === 'constructor' && row.int === '7')
    && intBefore.some((row) => row.name === 'toString' && row.int === '9'), { open: protoIntOpen, before: intBefore })
  check('proto/int-compare-coils', intOutputs.INT_PROTO_OK === 'TRUE' && intOutputs.INT_CTOR_OK === 'TRUE' && intOutputs.INT_TOSTRING_OK === 'TRUE', intOutputs)

  const runnable = program('运行按钮正常路径', [
    tag('start', 'START', 'BOOL', true, '%M0.0'),
    tag('lamp', 'LAMP', 'BOOL', false, '%Q0.0'),
  ], [
    { id: 'run-rung', label: 'run', nodes: [contact('run-contact', 'START')], output: coil('run-out', 'LAMP') },
  ])
  await page.injectAndOpen(runnable, 'run-ok')
  await page.waitFor(`document.querySelector('#project-name')?.value === ${JSON.stringify(runnable.name)}`, '正常运行工程显示')
  const idleState = await page.evaluate(`(() => ({
    label: document.querySelector('.wb-run-toggle')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    pressed: document.querySelector('.wb-run-toggle')?.getAttribute('aria-pressed') ?? null,
    running: document.querySelector('.wb-run-toggle')?.classList.contains('is-running') ?? false,
    clock: document.querySelector('.run-clock')?.textContent?.trim() ?? null,
  }))()`)
  await page.click('.wb-run-toggle')
  await page.waitFor("document.querySelector('.wb-run-toggle')?.classList.contains('is-running')", '正常运行启动')
  const runStarted = await page.evaluate(`(() => ({
    label: document.querySelector('.wb-run-toggle')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    pressed: document.querySelector('.wb-run-toggle')?.getAttribute('aria-pressed') ?? null,
    running: document.querySelector('.wb-run-toggle')?.classList.contains('is-running') ?? false,
    clock: document.querySelector('.run-clock')?.textContent?.trim() ?? null,
    status: document.querySelector('.run-state')?.textContent?.trim() ?? null,
    lamp: [...document.querySelectorAll('.ll-power-text')].some((node) => node.textContent?.includes('TRUE')),
  }))()`)
  await sleep(700)
  const runAdvanced = await page.evaluate("document.querySelector('.run-clock')?.textContent?.trim() ?? null")
  await openTagMonitor(page)
  await page.waitFor(`(() => {
    const row = [...document.querySelectorAll('.tag-card')].find((item) => item.querySelector('.tag-name-input')?.value === 'LAMP')
    return row?.querySelector('.live-value')?.textContent?.trim() === 'TRUE'
  })()`, 'LAMP 输出得电', 4000)
  const runRows = await monitorRows(page)
  await page.click('.wb-run-toggle')
  await page.waitFor("!document.querySelector('.wb-run-toggle')?.classList.contains('is-running')", '正常暂停')
  const pausedState = await page.evaluate(`(() => ({
    label: document.querySelector('.wb-run-toggle')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    pressed: document.querySelector('.wb-run-toggle')?.getAttribute('aria-pressed') ?? null,
    clock: document.querySelector('.run-clock')?.textContent?.trim() ?? null,
    status: document.querySelector('.run-state')?.textContent?.trim() ?? null,
  }))()`)
  check('run/idle-state', idleState.label === '运行' && idleState.pressed === 'false' && !idleState.running && idleState.clock === null, idleState)
  check('run/starts-and-scans', runStarted.label === '暂停' && runStarted.pressed === 'true' && runStarted.running && runStarted.status === '仿真运行中', runStarted)
  check('run/scan-clock-advances', /已扫描\s*\d+\.\d\s*s/.test(runStarted.clock ?? '') && runAdvanced !== runStarted.clock, { started: runStarted.clock, after700ms: runAdvanced })
  check('run/output-powers', runRows.some((row) => row.name === 'LAMP' && row.bool === 'TRUE'), { ...runStarted, rows: runRows })
  check('run/pauses', pausedState.label === '运行' && pausedState.pressed === 'false' && pausedState.clock === null && pausedState.status === '仿真暂停', pausedState)

  const broken = compileErrorProgram()
  await page.injectAndOpen(broken, 'run-error')
  await page.waitFor(`document.querySelector('#project-name')?.value === ${JSON.stringify(broken.name)}`, '错误工程显示')
  await page.waitFor("document.querySelector('.wb-run-toggle')?.classList.contains('is-blocked')", '错误状态按钮')
  const blockedBefore = await page.evaluate(`(() => ({
    label: document.querySelector('.wb-run-toggle')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    aria: document.querySelector('.wb-run-toggle')?.getAttribute('aria-label') ?? null,
    running: document.querySelector('.wb-run-toggle')?.classList.contains('is-running') ?? false,
    clock: document.querySelector('.run-clock')?.textContent?.trim() ?? null,
  }))()`)
  await page.click('.wb-run-toggle')
  await page.waitFor("document.querySelector('#inspector-tab-diagnostics')?.getAttribute('aria-selected') === 'true'", '错误打开诊断', 4000)
  const blockedAfter = await page.evaluate(`(() => ({
    selected: document.querySelector('#inspector-tab-diagnostics')?.getAttribute('aria-selected') ?? null,
    diagnostics: Boolean(document.querySelector('.diagnostics-panel')),
    running: document.querySelector('.wb-run-toggle')?.classList.contains('is-running') ?? false,
    clock: document.querySelector('.run-clock')?.textContent?.trim() ?? null,
    errorText: document.querySelector('.diagnostics-panel')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 240) ?? null,
  }))()`)
  check('run/error-label-explains-block', blockedBefore.label?.includes('无法运行') && blockedBefore.aria?.includes('错误') && !blockedBefore.running, blockedBefore)
  check('run/error-click-opens-diagnostics', blockedAfter.selected === 'true' && blockedAfter.diagnostics && !blockedAfter.running && blockedAfter.clock === null, blockedAfter)

  check('runtime/no-console-errors', page.errors.length === 0, page.errors)
  console.log(JSON.stringify({ checks, details, errors: page.errors }, null, 2))
  if (Object.values(checks).some((value) => !value) || page.errors.length > 0) process.exitCode = 1
} catch (error) {
  console.error('HARDENING_QA_FAILED=' + (error?.stack ?? error))
  if (page) console.error('CONSOLE_ERRORS=' + JSON.stringify(page.errors, null, 2))
  process.exitCode = 1
} finally {
  page?.close()
}
