/** 双标签页存储与项目库竞态回归。需要 preview:4173 和专用 QA Chromium CDP 9444。 */
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
const PAGE_URL = (() => {
  const url = new URL(APP_URL)
  url.searchParams.set('ladderlab-qa', `storage-${process.pid}-${Date.now()}`)
  return url.href
})()
const ACTIVE_KEY = 'ladderlab.library.v1.active'
const TAB_KEY = 'ladderlab.project.v1.tab.v2'
const MIRROR_KEY = 'ladderlab.project.v1.mirror.v2'
const RECOVERY_KEY = 'ladderlab.project.v1.recovery.'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await mkdir(new URL('../docs/qa/', import.meta.url), { recursive: true })

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

  async waitFor(expression, label, timeout = 7000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await this.evaluate(expression)) return true
      await sleep(100)
    }
    throw new Error(this.label + ' 等待超时：' + label)
  }

  async navigate() {
    await this.send('Page.navigate', { url: PAGE_URL })
    await this.waitFor("document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')", '应用挂载')
    await sleep(250)
  }

  async reload() {
    await this.send('Page.reload')
    await sleep(250)
    await this.waitFor("document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')", '刷新后应用挂载')
    await sleep(250)
  }

  async click(selector) {
    const clicked = await this.evaluate('(() => { const node = document.querySelector(' + JSON.stringify(selector) + '); if (!node) return false; node.click(); return true })()')
    if (!clicked) throw new Error(this.label + ' 找不到可点击元素：' + selector)
  }

  async fill(selector, value) {
    const filled = await this.evaluate('(() => { const input = document.querySelector(' + JSON.stringify(selector) + '); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ' + JSON.stringify(value) + '); input.dispatchEvent(new Event("input", { bubbles: true })); return true })()')
    if (!filled) throw new Error(this.label + ' 找不到输入框：' + selector)
  }

  async rename(value) {
    // 后台标签页无法可靠触发原生失焦，真实用户改名前也必然先切回该标签页。
    await this.send('Page.bringToFront')
    const focused = await this.evaluate('(() => { const input = document.querySelector("#project-name"); if (!input) return false; input.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ' + JSON.stringify(value) + '); input.dispatchEvent(new Event("input", { bubbles: true })); return document.activeElement === input })()')
    if (!focused) throw new Error(this.label + ' 找不到工程名称输入框')
    // 工程名是非受控字段，只有真实 Enter/失焦才提交；使用 CDP 可信键盘事件，
    // 避免页面失去窗口焦点时 element.blur() 不触发 React onBlur 的假阳性。
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    })
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    })
    await sleep(140)
  }

  name() {
    return this.evaluate("document.querySelector('#project-name')?.value ?? null")
  }

  library() {
    return this.evaluate(READ_LIBRARY_IN_PAGE)
  }

  activeId() {
    return this.evaluate('sessionStorage.getItem(' + JSON.stringify(ACTIVE_KEY) + ')')
  }

  sessionDraft() {
    return this.evaluate('(() => { try { return JSON.parse(sessionStorage.getItem(' + JSON.stringify(TAB_KEY) + ') ?? "null") } catch { return null } })()')
  }

  mirrorDraft() {
    return this.evaluate('(() => { try { return JSON.parse(localStorage.getItem(' + JSON.stringify(MIRROR_KEY) + ') ?? "null") } catch { return null } })()')
  }

  conflictVisible() {
    return this.evaluate("Boolean(document.querySelector('.conflict-banner'))")
  }

  /** 失败时一次性取回草稿、活动项目与冲突横幅，避免只看到一句“确认框没出现”。 */
  snapshot() {
    return this.evaluate(`(() => {
      const readDraft = (raw) => {
        try {
          const draft = JSON.parse(raw ?? 'null')
          return draft ? { name: draft.program?.name ?? null, savedAt: draft.savedAt ?? null, baseSavedAt: draft.baseSavedAt ?? null, tabId: draft.tabId ?? null } : null
        } catch { return null }
      }
      let library = []
      try {
        library = ((${READ_LIBRARY_IN_PAGE})?.projects ?? [])
          .map((project) => [project.id, project.program?.name, project.savedAt])
      } catch {}
      return {
        name: document.querySelector('#project-name')?.value ?? null,
        conflict: Boolean(document.querySelector('.conflict-banner')),
        banner: document.querySelector('.conflict-banner')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
        toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
        active: sessionStorage.getItem('${ACTIVE_KEY}'),
        session: readDraft(sessionStorage.getItem('${TAB_KEY}')),
        mirror: readDraft(localStorage.getItem('${MIRROR_KEY}')),
        library,
      }
    })()`)
  }

  /** 只供并发保存失败时留证，不改变应用逻辑。 */
  async beginConcurrentSaveProbe() {
    const label = JSON.stringify(this.label)
    return this.evaluate(`(() => {
      const label = ${label};
      window.__qaConcurrentMarker = label;
      sessionStorage.setItem('__qaConcurrentMarker', label);
      window.__qaProbe = { label, startedAt: performance.now(), writes: [], events: [], lock: [] };
      const record = (kind, detail) => window.__qaProbe.events.push({ at: performance.now(), kind, detail });
      const originalSetItem = Storage.prototype.setItem;
      if (!Storage.prototype.__qaWrapped) {
        Storage.prototype.setItem = function (key, value) {
          const result = originalSetItem.call(this, key, value);
          if (this === localStorage && String(key).startsWith('ladderlab.')) {
            try {
              let parsed = null;
              if (key === 'ladderlab.library.v1') {
                parsed = JSON.parse(value).projects?.map((item) => item.program?.name);
              } else if (String(key).startsWith('ladderlab.library.v2.project.')) {
                parsed = [JSON.parse(value).program?.name];
              }
              window.__qaProbe?.writes.push({
                at: performance.now(),
                label,
                key,
                names: parsed,
                stack: new Error().stack,
              });
            } catch {}
          }
          return result;
        };
        Storage.prototype.__qaWrapped = true;
      }
      const locks = navigator.locks;
      if (locks?.request && !locks.__qaProbeWrapped) {
        const originalRequest = locks.request.bind(locks);
        locks.request = (...args) => {
          const name = args[0];
          const callback = args[args.length - 1];
          const entry = {
            label,
            name,
            requestedAt: performance.now(),
            grantedAt: null,
            callbackStartedAt: null,
            callbackEndedAt: null,
            settledAt: null,
            error: null,
          };
          window.__qaProbe?.lock.push(entry);
          if (typeof callback === 'function') {
            args[args.length - 1] = async (...callbackArgs) => {
              entry.grantedAt = performance.now();
              entry.callbackStartedAt = performance.now();
              try {
                return await callback(...callbackArgs);
              } finally {
                entry.callbackEndedAt = performance.now();
              }
            };
          }
          return originalRequest(...args).then(
            (value) => {
              entry.settledAt = performance.now();
              return value;
            },
            (error) => {
              entry.settledAt = performance.now();
              entry.error = String(error?.stack ?? error);
              throw error;
            },
          );
        };
        locks.__qaProbeWrapped = true;
      }
      record('probe-ready', {
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      });
      return { storedMarker: sessionStorage.getItem('__qaConcurrentMarker'), locks: Boolean(navigator.locks?.request) };
    })()`)
  }

  concurrentSaveSnapshot() {
    return this.evaluate([
      '(() => {',
      'const projects = (' + READ_LIBRARY_IN_PAGE + ')?.projects ?? [];',
      'return {',
      '  dialog: Boolean(document.querySelector(".save-project-dialog")),',
      '  error: document.querySelector("#save-project-error")?.textContent?.trim() ?? null,',
      '  name: document.querySelector("#project-name")?.value ?? null,',
      '  toast: document.querySelector(".toast-message")?.textContent?.trim() ?? null,',
      '  active: sessionStorage.getItem(' + JSON.stringify(ACTIVE_KEY) + '),',
      '  marker: window.__qaConcurrentMarker ?? null,',
      '  storedMarker: sessionStorage.getItem("__qaConcurrentMarker"),',
      '  href: location.href,',
      '  readyState: document.readyState,',
      '  visibilityState: document.visibilityState,',
      '  hasFocus: document.hasFocus(),',
      '  probe: window.__qaProbe ?? null,',
      '  library: projects.map((project) => ({ name: project.program?.name, id: project.id })),',
      '};',
      '})()',
    ].join('\n'))
  }

  async openDrawer() {
    await this.click('.wb-project-button')
    await this.waitFor("!!document.querySelector('.wb-project-drawer')", '项目抽屉打开')
    await sleep(100)
  }

  async closeDrawer() {
    await this.click('.wb-drawer-close')
    await this.waitFor("!document.querySelector('.wb-project-drawer')", '项目抽屉关闭')
  }

  async openSavedProject(name) {
    await this.openDrawer()
    const clicked = await this.evaluate('(() => { const item = [...document.querySelectorAll(".wb-saved-project")].find((row) => row.querySelector(".wb-saved-project-name")?.textContent?.includes(' + JSON.stringify(name) + ')); item?.querySelector(".wb-saved-project-open")?.click(); return Boolean(item) })()')
    if (!clicked) throw new Error(this.label + ' 找不到项目：' + name)
    try {
      await this.waitFor("!!document.querySelector('.confirm-dialog')", '打开项目确认框')
    } catch {
      const state = await this.snapshot()
      throw new Error(this.label + ' 打开项目确认框失败：' + JSON.stringify(state))
    }
    await this.click('.confirm-ok')
    await this.waitFor("!document.querySelector('.wb-project-drawer')", '项目打开后抽屉关闭')
    await sleep(250)
  }

  async saveAs(name) {
    await this.click('.wb-save-button')
    await this.waitFor("!!document.querySelector('#save-project-name')", '保存对话框')
    await this.fill('#save-project-name', name)
    await this.click('.save-project-confirm')
    await this.waitFor("!document.querySelector('.save-project-dialog')", '保存完成')
    await sleep(150)
  }

  async cancelSaveDialog() {
    if (await this.evaluate("Boolean(document.querySelector('.save-project-dialog'))")) {
      await this.click('.project-import-back')
      await this.waitFor("!document.querySelector('.save-project-dialog')", '保存对话框取消')
    }
  }

  async quickSave(expectedName) {
    await this.evaluate('(() => { window.__llSaveClicks = 0; window.__llLockRequests = 0; window.__llLockSettled = 0; window.__llLastLockResult = null; window.__llSaveRejection = null; window.__llSaveErrors = []; const button = document.querySelector(".wb-save-button"); button?.addEventListener("click", () => { window.__llSaveClicks += 1 }, { once: true }); const locks = navigator.locks; if (locks?.request && !locks.__llWrapped) { const original = locks.request.bind(locks); locks.request = (...args) => { window.__llLockRequests += 1; const callback = args[args.length - 1]; if (typeof callback === "function") args[args.length - 1] = async (...callbackArgs) => { const value = await callback(...callbackArgs); window.__llLastLockResult = JSON.parse(JSON.stringify(value)); return value }; return original(...args).then((value) => { window.__llLockSettled += 1; return value }, (error) => { window.__llLockSettled += 1; window.__llSaveErrors.push(String(error?.stack ?? error)); throw error }) }; locks.__llWrapped = true } window.addEventListener("unhandledrejection", (event) => { window.__llSaveRejection = String(event.reason?.stack ?? event.reason) }, { once: true }); window.addEventListener("error", (event) => { window.__llSaveErrors.push(String(event.error?.stack ?? event.message)) }, { once: true }); return Boolean(button) })()')
    await this.click('.wb-save-button')
    await sleep(300)
    const state = await this.evaluate('({ dialog: Boolean(document.querySelector(".save-project-dialog")), error: document.querySelector("#save-project-error")?.textContent?.trim() ?? null, name: document.querySelector("#project-name")?.value ?? null, activeId: sessionStorage.getItem(' + JSON.stringify(ACTIVE_KEY) + '), library: (' + READ_LIBRARY_IN_PAGE + ')?.projects?.map((project) => project.program?.name) ?? [] })')
    if (state.dialog) {
      throw new Error(this.label + ' 快速保存意外弹出对话框：' + JSON.stringify(state))
    }
    try {
      await this.waitFor('((' + READ_LIBRARY_IN_PAGE + ')?.projects ?? []).some((project) => project.program?.name === ' + JSON.stringify(expectedName) + ')', '项目库出现新名称')
    } catch {
      const after = await this.evaluate('(async () => ({ dialog: Boolean(document.querySelector(".save-project-dialog")), error: document.querySelector("#save-project-error")?.textContent?.trim() ?? null, name: document.querySelector("#project-name")?.value ?? null, activeId: sessionStorage.getItem(' + JSON.stringify(ACTIVE_KEY) + '), toast: document.querySelector(".toast-message")?.textContent?.trim() ?? null, clicks: window.__llSaveClicks ?? null, lockRequests: window.__llLockRequests ?? null, lockSettled: window.__llLockSettled ?? null, lockResult: window.__llLastLockResult ?? null, rejection: window.__llSaveRejection ?? null, saveErrors: window.__llSaveErrors ?? [], disabled: document.querySelector(".wb-save-button")?.disabled ?? null, count: document.querySelectorAll(".wb-save-button").length, locks: await navigator.locks.query(), library: (' + READ_LIBRARY_IN_PAGE + ')?.projects?.map((project) => ({ name: project.program?.name, id: project.id, savedAt: project.savedAt })) ?? [] }))()')
      throw new Error(this.label + ' 快速保存后项目库未更新：' + JSON.stringify(after))
    }
    await sleep(180)
  }

  countRecovery() {
    return this.evaluate('(() => { let count = 0; for (let index = 0; index < localStorage.length; index += 1) { if (localStorage.key(index)?.startsWith(' + JSON.stringify(RECOVERY_KEY) + ')) count += 1 } return count })()')
  }

  recoveryProgramNames() {
    return this.evaluate('(() => { const names = []; for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); if (!key?.startsWith(' + JSON.stringify(RECOVERY_KEY) + ')) continue; try { const value = JSON.parse(localStorage.getItem(key) ?? "null"); if (typeof value?.name === "string") names.push(value.name) } catch {} } return names })()')
  }

  async close() {
    try { this.socket.close() } catch {}
    await closeQaPage(CDP, this.target.id)
  }
}

async function createPage(label) {
  const target = await createQaPage(CDP)
  const page = new PageClient(target, label)
  await page.open()
  return page
}

const checks = {}
const details = {}
const check = (name, value, detail) => {
  checks[name] = Boolean(value)
  if (detail !== undefined) details[name] = detail
}

let pageA
let pageB
try {
  pageA = await createPage('A')
  pageB = await createPage('B')
  await pageA.navigate()
  await pageA.evaluate("localStorage.clear(); sessionStorage.clear(); localStorage.setItem('ladderlab.coach.v1', 'seen'); true")
  await pageB.navigate()
  await pageA.reload()

  // 1. 同一标签页草稿互不串：localStorage 镜像可以是最后一笔，但 sessionStorage 必须各读各的。
  await pageA.rename('标签 A 未命名草稿')
  await pageB.rename('标签 B 未命名草稿')
  await sleep(650)
  await pageA.reload()
  await pageB.reload()
  const isolatedDrafts = { a: await pageA.name(), b: await pageB.name() }
  check('tabs/drafts-isolated', isolatedDrafts.a === '标签 A 未命名草稿' && isolatedDrafts.b === '标签 B 未命名草稿', isolatedDrafts)
  check('tabs/drafts-do-not-conflict', !(await pageA.conflictVisible()) && !(await pageB.conflictVisible()))

  // 2. 两个标签页同时从“新建”保存不同项目，Web Locks 下两份都必须保留。
  await pageA.click('.wb-save-button')
  await pageB.click('.wb-save-button')
  await pageA.waitFor("!!document.querySelector('#save-project-name')", 'A 保存框')
  await pageB.waitFor("!!document.querySelector('#save-project-name')", 'B 保存框')
  await pageA.fill('#save-project-name', '双标签并发项目 A')
  await pageB.fill('#save-project-name', '双标签并发项目 B')
  await sleep(100)
  await Promise.all([pageA.beginConcurrentSaveProbe(), pageB.beginConcurrentSaveProbe()])
  await Promise.all([pageA.click('.save-project-confirm'), pageB.click('.save-project-confirm')])
  try {
    await pageA.waitFor("!document.querySelector('.save-project-dialog')", 'A 并发保存完成')
    await pageB.waitFor("!document.querySelector('.save-project-dialog')", 'B 并发保存完成')
  } catch {
    const states = await Promise.all([pageA, pageB].map((page) => page.evaluate('({ dialog: Boolean(document.querySelector(".save-project-dialog")), error: document.querySelector("#save-project-error")?.textContent?.trim() ?? null, name: document.querySelector("#project-name")?.value ?? null, toast: document.querySelector(".toast-message")?.textContent?.trim() ?? null, active: sessionStorage.getItem(' + JSON.stringify(ACTIVE_KEY) + '), library: (' + READ_LIBRARY_IN_PAGE + ') })')))
    throw new Error('两份并发保存未完成：' + JSON.stringify(states))
  }
  try {
    await pageA.waitFor('((' + READ_LIBRARY_IN_PAGE + ')?.projects?.length ?? 0) === 2', '两份并发项目写入')
  } catch {
    const states = await Promise.all([pageA.concurrentSaveSnapshot(), pageB.concurrentSaveSnapshot()])
    throw new Error('两份并发项目未全部写入：' + JSON.stringify(states))
  }
  const concurrent = await pageA.library()
  const concurrentNames = concurrent.projects.map((project) => project.program.name).sort()
  details['library/concurrent-probe'] = await Promise.all([
    pageA.concurrentSaveSnapshot(),
    pageB.concurrentSaveSnapshot(),
  ])
  check(
    'library/concurrent-saves-preserved',
    concurrent.projects.length === 2
      && concurrentNames.includes('双标签并发项目 A')
      && concurrentNames.includes('双标签并发项目 B'),
    concurrentNames,
  )
  const projectA = concurrent.projects.find((project) => project.program.name === '双标签并发项目 A')
  const projectB = concurrent.projects.find((project) => project.program.name === '双标签并发项目 B')
  check(
    'library/concurrent-identities-distinct',
    Boolean(projectA && projectB && projectA.id !== projectB.id)
      && (await pageA.activeId()) === projectA.id
      && (await pageB.activeId()) === projectB.id,
    { a: await pageA.activeId(), b: await pageB.activeId() },
  )

  // 3. 两页打开同一项目；A 保存新版本后，B 的旧版本号必须被拒绝。
  await pageB.openSavedProject('双标签并发项目 A')
  check(
    'tabs/same-project-opened',
    (await pageA.activeId()) === projectA.id && (await pageB.activeId()) === projectA.id,
    { a: await pageA.activeId(), b: await pageB.activeId() },
  )
  const baseSavedAt = projectA.savedAt
  // 先让 B 在旧版本上留下真实未保存修改，再让 A 提交新版本。
  // 若 B 没有任何本地修改，它会自动跟随 A 的草稿；那种情况下再编辑并不构成旧版本。
  await pageB.rename('双标签并发项目 A · B 旧副本')
  await sleep(650)
  await pageA.rename('双标签并发项目 A · A 最新')
  await pageA.quickSave('双标签并发项目 A · A 最新')
  const afterASave = await pageA.library()
  const newerA = afterASave.projects.find((project) => project.id === projectA.id)
  check('library/a-new-version-saved', Boolean(newerA && newerA.savedAt > baseSavedAt), newerA?.savedAt)

  await sleep(550)
  await pageB.send('Page.bringToFront')
  await sleep(150)
  try {
    await pageB.waitFor("!!document.querySelector('.conflict-banner')", 'B 旧版本冲突横幅')
  } catch {
    const state = await pageB.evaluate('({ name: document.querySelector("#project-name")?.value ?? null, toast: document.querySelector(".toast-message")?.textContent?.trim() ?? null, active: sessionStorage.getItem(' + JSON.stringify(ACTIVE_KEY) + '), conflict: Boolean(document.querySelector(".conflict-banner")), sessionDraft: JSON.parse(sessionStorage.getItem(' + JSON.stringify(TAB_KEY) + ') ?? "null"), mirrorDraft: JSON.parse(localStorage.getItem(' + JSON.stringify(MIRROR_KEY) + ') ?? "null"), library: (' + READ_LIBRARY_IN_PAGE + ') })')
    throw new Error(pageB.label + ' 等待旧版本冲突横幅失败：' + JSON.stringify(state))
  }
  await pageB.click('.wb-save-button')
  try {
    await pageB.waitFor("!!document.querySelector('#save-project-error')", 'B 旧版本保存冲突提示')
  } catch {
    const state = await pageB.evaluate('({ dialog: Boolean(document.querySelector(".save-project-dialog")), error: document.querySelector("#save-project-error")?.textContent?.trim() ?? null, toast: document.querySelector(".toast-message")?.textContent?.trim() ?? null, name: document.querySelector("#project-name")?.value ?? null, active: sessionStorage.getItem(' + JSON.stringify(ACTIVE_KEY) + '), conflict: Boolean(document.querySelector(".conflict-banner")), sessionDraft: JSON.parse(sessionStorage.getItem(' + JSON.stringify(TAB_KEY) + ') ?? "null"), mirrorDraft: JSON.parse(localStorage.getItem(' + JSON.stringify(MIRROR_KEY) + ') ?? "null"), library: (' + READ_LIBRARY_IN_PAGE + ') })')
    throw new Error(pageB.label + ' 等待旧版本冲突提示失败：' + JSON.stringify(state))
  }
  const staleSave = {
    error: await pageB.evaluate("document.querySelector('#save-project-error')?.textContent?.trim() ?? null"),
    libraryName: (await pageB.library()).projects.find((project) => project.id === projectA.id)?.program.name,
  }
  check('save/stale-version-rejected', String(staleSave.error).includes('另一个标签页已经保存了更新版本') && staleSave.libraryName === '双标签并发项目 A · A 最新', staleSave)
  await pageB.cancelSaveDialog()

  // 4. 采纳最新版本后无需重新打开，同一项目即可继续编辑并保存。
  await pageB.click('.conflict-adopt')
  await pageB.waitFor("!document.querySelector('.conflict-banner')", 'B 采纳另一标签页版本')
  await sleep(250)
  await pageB.rename('双标签并发项目 A · B 修复保存')
  await pageB.quickSave('双标签并发项目 A · B 修复保存')
  const repaired = (await pageB.library()).projects.find((project) => project.id === projectA.id)
  check(
    'save/adopted-version-can-save-without-reopen',
    repaired?.program.name === '双标签并发项目 A · B 修复保存'
      && repaired.savedAt > newerA.savedAt,
    { name: repaired?.program.name, savedAt: repaired?.savedAt, previousSavedAt: newerA?.savedAt },
  )

  // A 没有本地修改，应自动跟随 B 刚保存到项目库的版本；这也是第 5 步的前置条件。
  const repairedName = '双标签并发项目 A · B 修复保存'
  await pageA.waitFor(
    'document.querySelector("#project-name")?.value === ' + JSON.stringify(repairedName),
    'A 自动跟随 B 已保存版本',
  )
  check(
    'tabs/clean-tab-follows-saved-version',
    (await pageA.name()) === repairedName
      && (await pageA.activeId()) === projectA.id
      && !(await pageA.conflictVisible()),
    { name: await pageA.name(), activeId: await pageA.activeId(), conflict: await pageA.conflictVisible() },
  )

  // 5. B 已经打开删除确认框后，A 保存新版本；B 的过期删除不得删掉新版本。
  await pageB.openDrawer()
  const deleteStarted = await pageB.evaluate('(() => { const item = [...document.querySelectorAll(".wb-saved-project")].find((row) => row.querySelector(".wb-saved-project-name")?.textContent?.includes(' + JSON.stringify(repairedName) + ')); item?.querySelector(".wb-saved-project-delete")?.click(); return Boolean(item) })()')
  await pageB.waitFor("!!document.querySelector('.confirm-dialog')", '删除确认框')
  const deleteRaceName = '双标签并发项目 A · A 删除竞态新版本'
  await pageA.send('Page.bringToFront')
  await pageA.rename(deleteRaceName)
  await pageA.quickSave(deleteRaceName)
  await pageA.waitFor(
    '(((' + READ_LIBRARY_IN_PAGE + ')?.projects) ?? []).some((project) => project.id === ' + JSON.stringify(projectA.id) + ' && project.program?.name === ' + JSON.stringify(deleteRaceName) + ')',
    'A 删除竞态新版本已保存',
  )
  await pageB.send('Page.bringToFront')
  await pageB.click('.confirm-ok')
  await pageB.waitFor("!document.querySelector('.confirm-dialog')", '删除确认完成')
  await sleep(300)
  const deleteRaceLibrary = await pageB.library()
  const survived = deleteRaceLibrary.projects.find((project) => project.id === projectA.id)
  const deleteToast = await pageB.evaluate("document.querySelector('.toast-message')?.textContent?.trim() ?? null")
  check(
    'delete/stale-version-does-not-delete-newer',
    deleteStarted && survived?.program.name === deleteRaceName
      && String(deleteToast).includes('另一个标签页已经更新'),
    { project: survived?.program.name, toast: deleteToast },
  )
  await pageB.closeDrawer()

  // 6. 两页同项目：B 有未保存修改时，A 的草稿保存必须进入冲突，采纳后刷新仍保留。
  // B 在 A 保存竞态新版本后没有本地修改，会自动同步；先确认两页身份和版本一致。
  await pageB.waitFor(
    'document.querySelector("#project-name")?.value === ' + JSON.stringify(deleteRaceName),
    'B 自动同步删除竞态新版本',
  )
  check(
    'tabs/pages-converge-before-conflict-test',
    (await pageA.name()) === deleteRaceName
      && (await pageB.name()) === deleteRaceName
      && (await pageA.activeId()) === projectA.id
      && (await pageB.activeId()) === projectA.id
      && !(await pageA.conflictVisible())
      && !(await pageB.conflictVisible()),
    {
      a: { name: await pageA.name(), activeId: await pageA.activeId(), conflict: await pageA.conflictVisible() },
      b: { name: await pageB.name(), activeId: await pageB.activeId(), conflict: await pageB.conflictVisible() },
    },
  )
  const pendingName = 'B 页未保存待采纳'
  const thirdName = 'A 页第三版'
  const beforeAdoptRecovery = await pageB.countRecovery()
  await pageB.rename(pendingName)
  await sleep(650)
  await pageB.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide')); true")
  await pageA.send('Page.bringToFront')
  await pageA.rename(thirdName)
  await pageA.quickSave(thirdName)
  await pageA.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide')); true")
  await pageB.send('Page.bringToFront')
  try {
    await pageB.waitFor("!!document.querySelector('.conflict-banner')", 'B 冲突横幅')
  } catch {
    const state = {
      a: { name: await pageA.name(), active: await pageA.activeId(), conflict: await pageA.conflictVisible(), session: (await pageA.sessionDraft())?.program?.name, mirror: (await pageA.mirrorDraft())?.program?.name },
      b: { name: await pageB.name(), active: await pageB.activeId(), conflict: await pageB.conflictVisible(), session: (await pageB.sessionDraft())?.program?.name, mirror: (await pageB.mirrorDraft())?.program?.name },
    }
    throw new Error('B 冲突横幅未出现：' + JSON.stringify(state))
  }
  const conflictState = {
    aId: await pageA.activeId(),
    bId: await pageB.activeId(),
    bName: await pageB.name(),
    text: await pageB.evaluate("document.querySelector('.conflict-banner')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null"),
  }
  check('tabs/same-project-conflict-raised', conflictState.aId === conflictState.bId && conflictState.bName === pendingName && String(conflictState.text).includes('另一个标签页'), conflictState)
  const activeBeforeAdopt = await pageB.activeId()
  await pageB.click('.conflict-adopt')
  await pageB.waitFor("!document.querySelector('.conflict-banner')", 'B 采纳后横幅消失')
  await pageB.waitFor('document.querySelector("#project-name")?.value === ' + JSON.stringify(thirdName), 'B 采纳最新内容')
  await sleep(200)
  const adopted = {
    field: await pageB.name(),
    session: (await pageB.sessionDraft())?.program?.name,
    mirror: (await pageB.mirrorDraft())?.program?.name,
    activeId: await pageB.activeId(),
    recoveryGain: (await pageB.countRecovery()) - beforeAdoptRecovery,
    recoveryNames: await pageB.recoveryProgramNames(),
  }
  check(
    'tabs/adopt-persists-and-keeps-identity',
    adopted.field === thirdName && adopted.session === thirdName
      && adopted.mirror === thirdName && adopted.activeId === activeBeforeAdopt
      && adopted.recoveryNames.includes(pendingName),
    adopted,
  )
  await pageB.reload()
  const afterAdoptReload = {
    field: await pageB.name(),
    activeId: await pageB.activeId(),
    banner: await pageB.conflictVisible(),
  }
  check(
    'tabs/adopt-survives-reload',
    afterAdoptReload.field === thirdName
      && afterAdoptReload.activeId === activeBeforeAdopt
      && !afterAdoptReload.banner,
    afterAdoptReload,
  )

  // 7. 不同项目 ID 的草稿绝不能串到当前项目。
  await pageA.openSavedProject('双标签并发项目 B')
  await pageA.rename('另一个项目的私有修改')
  await pageA.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide')); true")
  await sleep(350)
  const differentProject = {
    bName: await pageB.name(),
    aId: await pageA.activeId(),
    bId: await pageB.activeId(),
    conflict: await pageB.conflictVisible(),
  }
  check(
    'storage/different-project-ignored',
    differentProject.aId !== differentProject.bId
      && differentProject.bName === thirdName
      && !differentProject.conflict,
    differentProject,
  )

  // 8. 未命名草稿 projectId=null，也不能覆盖一个命名项目。
  await pageA.click('.wb-file-button[aria-label="新建空白工程"]')
  await pageA.waitFor("!!document.querySelector('.confirm-dialog')", 'A 新建确认')
  await pageA.click('.confirm-ok')
  await pageA.waitFor("!document.querySelector('.confirm-dialog')", 'A 新建完成')
  await pageA.rename('未命名草稿不能串稿')
  await pageA.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide')); true")
  await sleep(350)
  const unnamedDraft = {
    bName: await pageB.name(),
    aId: await pageA.activeId(),
    bId: await pageB.activeId(),
    mirrorProjectId: (await pageB.mirrorDraft())?.projectId,
    conflict: await pageB.conflictVisible(),
  }
  check(
    'storage/unnamed-draft-cannot-overwrite-named-project',
    unnamedDraft.aId === null
      && unnamedDraft.bId === activeBeforeAdopt
      && unnamedDraft.bName === thirdName
      && unnamedDraft.mirrorProjectId === null
      && !unnamedDraft.conflict,
    unnamedDraft,
  )

  const errors = [...pageA.errors.map((error) => 'A: ' + error), ...pageB.errors.map((error) => 'B: ' + error)]
  check('runtime/no-console-errors', errors.length === 0, errors)
  console.log(JSON.stringify({ checks, details, errors }, null, 2))
  if (Object.values(checks).some((value) => !value)) process.exitCode = 1
} finally {
  await pageA?.close()
  await pageB?.close()
}
