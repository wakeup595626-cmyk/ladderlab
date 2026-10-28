/** 自动保存回归：需要 preview:4173 与专用 QA Chromium 的 CDP 端口 9444。
 *
 * 覆盖三条“用户以为已经存住”的路径：
 * 1. 编辑后立刻刷新（仍在防抖窗口内），最后一笔修改不能丢；
 * 2. 编辑后切到后台（visibilitychange hidden），同样不能丢；
 * 3. 同一份损坏数据反复加载，只应产生一个恢复副本。
 */

import { DEFAULT_QA_APP_URL, DEFAULT_QA_CDP, selectExactPage } from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const LEGACY_STORAGE_KEY = 'ladderlab.project.v1'
const TAB_STORAGE_KEY = 'ladderlab.project.v1.tab.v2'
const MIRROR_STORAGE_KEY = 'ladderlab.project.v1.mirror.v2'
const RECOVERY_PREFIX = 'ladderlab.project.v1.recovery.'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const targets = await (await fetch(CDP_HTTP + '/json')).json()
const page = selectExactPage(targets, APP_URL, CDP_HTTP)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', rejectOpen, { once: true })
})

let nextId = 0
const pending = new Map()
const errors = []

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolveCommand, rejectCommand) => {
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  } else if (message.method === 'Page.javascriptDialogOpening') {
    void send('Page.handleJavaScriptDialog', { accept: true })
  } else if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    if (JSON.stringify(details).includes('chrome-extension://')) return
    errors.push(details?.exception?.description ?? details?.text ?? 'exception')
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
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

/** 页面内小工具：必须每次导航后重新注入。 */
const PAGE_HELPERS = [
  'window.__llTest = {',
  '  rename(name) {',
  "    const input = document.querySelector('#project-name')",
  '    if (!input) return false',
  "    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set",
  '    input.focus()',
  '    setter.call(input, name)',
  "    input.dispatchEvent(new Event('input', { bubbles: true }))",
  '    input.blur()',
  '    return true',
  '  },',
  '  draftName(key, fromSession = false) {',
  '    const storage = fromSession ? window.sessionStorage : window.localStorage',
  '    const raw = storage.getItem(key)',
  '    if (!raw) return null',
  '    try {',
  '      const data = JSON.parse(raw)',
  '      return data?.program?.name ?? data?.name ?? null',
  '    } catch { return "unparseable" }',
  '  },',
  '  storedName() {',
  '    return this.draftName(' + JSON.stringify(TAB_STORAGE_KEY) + ', true)',
  '      ?? this.draftName(' + JSON.stringify(MIRROR_STORAGE_KEY) + ')',
  '  },',
  '  tabName() { return this.draftName(' + JSON.stringify(TAB_STORAGE_KEY) + ', true) },',
  '  mirrorName() { return this.draftName(' + JSON.stringify(MIRROR_STORAGE_KEY) + ') },',
  '  activeProjectId() {',
  '    return window.sessionStorage.getItem("ladderlab.library.v1.active")',
  '  },',
  '  countKeys(prefix) {',
  '    let count = 0',
  '    for (let index = 0; index < window.localStorage.length; index += 1) {',
  '      const key = window.localStorage.key(index)',
  '      if (key && key.startsWith(prefix)) count += 1',
  '    }',
  '    return count',
  '  },',
  '  injectRemote(name) {',
  '    const key = ' + JSON.stringify(MIRROR_STORAGE_KEY),
  '    const legacyKey = ' + JSON.stringify(LEGACY_STORAGE_KEY),
  '    const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey)',
  '    if (!raw) return false',
  '    const parsed = JSON.parse(raw)',
  '    const remote = parsed?.schema === 2 && parsed.program ? parsed : {',
  '      schema: 2, tabId: "qa-remote-tab", projectId: null, baseSavedAt: null,',
  '      savedAt: Date.now(), program: parsed,',
  '    }',
  '    remote.tabId = "qa-remote-tab-" + Date.now()',
  '    remote.program.name = name',
  '    remote.savedAt = Date.now()',
  '    const next = JSON.stringify(remote)',
  '    window.localStorage.setItem(key, next)',
  '    const event = new StorageEvent("storage", { key, oldValue: raw, newValue: next, url: location.href })',
  '    window.dispatchEvent(event)',
  '    return true',
  '  },',
  '}',
].join('\n')

async function openFreshApp() {
  await send('Page.navigate', { url: APP_URL })
  await sleep(700)
  await evaluate('window.localStorage.clear(); window.sessionStorage.clear(); true')
  await send('Page.reload')
  await sleep(1200)
  await evaluate("document.querySelector('.guide-backdrop .guide-secondary')?.click()")
  await evaluate(PAGE_HELPERS)
  await sleep(200)
}

/** 用原生 setter 触发一次真实的 React onChange，模拟用户改工程名。 */
async function renameProject(name) {
  const changed = await evaluate('window.__llTest.rename(' + JSON.stringify(name) + ')')
  if (!changed) {
    const snapshot = await evaluate(
      "({ href: location.href, title: document.title, root: document.body.innerText.slice(0, 240) })",
    )
    throw new Error('找不到工程名称输入框 #project-name；页面快照：' + JSON.stringify(snapshot) + '；错误：' + JSON.stringify(errors))
  }
}

async function storedName() {
  return evaluate('window.__llTest.storedName()')
}

async function saveCurrentProject(name) {
  await evaluate("document.querySelector('.wb-save-button')?.click()")
  await sleep(280)
  const filled = await evaluate(
    '(() => {' +
      'const input = document.querySelector("#save-project-name");' +
      'if (!input) return false;' +
      'const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;' +
      'setter?.call(input, ' + JSON.stringify(name) + ');' +
      'input.dispatchEvent(new Event("input", { bubbles: true }));' +
      'return true;' +
    '})()',
  )
  if (!filled) throw new Error('保存对话框没有出现')
  await evaluate("document.querySelector('.save-project-confirm')?.click()")
  await sleep(520)
}

const report = {
  flushOnReload: null,
  flushOnHidden: null,
  keepLocalConflict: null,
  adoptRemoteConflict: null,
  recoveryBackups: null,
}

// 1) 防抖窗口内直接刷新
await openFreshApp()
await renameProject('刷新保命测试')
await send('Page.reload')
await sleep(1200)
await evaluate(PAGE_HELPERS)
report.flushOnReload = {
  storedName: await storedName(),
  fieldName: await evaluate("document.querySelector('#project-name')?.value ?? null"),
}

// 2) 防抖窗口内切到后台（visibilitychange -> hidden）
await renameProject('后台保命测试')
await evaluate(
  "(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); " +
    "Object.defineProperty(document, 'hidden', { value: true, configurable: true }); " +
    "document.dispatchEvent(new Event('visibilitychange')); return true })()",
)
await sleep(120)
report.flushOnHidden = { storedName: await storedName() }

// 后续跨标签页测试必须绑定一个真实命名项目；未命名草稿按设计不会被远端草稿覆盖。
await saveCurrentProject('多标签冲突测试')
const projectId = await evaluate('window.__llTest.activeProjectId()')
if (!projectId) throw new Error('命名项目保存后没有活动项目 ID')

// 3) 多标签页冲突：保留本页时先把另一版存成恢复副本。
await renameProject('本页未保存修改')
await sleep(100)
await evaluate('window.__llTest.injectRemote("另一标签页版本")')
await sleep(500)
const keepLocalBefore = {
  sessionName: await evaluate('window.__llTest.tabName()'),
  mirrorName: await evaluate('window.__llTest.mirrorName()'),
  bannerVisible: await evaluate("Boolean(document.querySelector('.conflict-banner'))"),
}
await evaluate("document.querySelector('.conflict-keep')?.click()")
await sleep(250)
report.keepLocalConflict = {
  before: keepLocalBefore,
  storedName: await storedName(),
  mirrorName: await evaluate('window.__llTest.mirrorName()'),
  fieldName: await evaluate("document.querySelector('#project-name')?.value ?? null"),
  bannerGone: await evaluate("!document.querySelector('.conflict-banner')"),
  recoveryCount: await evaluate('window.__llTest.countKeys(' + JSON.stringify(RECOVERY_PREFIX) + ')'),
}

// 4) 多标签页冲突：载入另一版时先把本页未保存修改存成恢复副本。
await renameProject('本页第二版修改')
await sleep(100)
await evaluate('window.__llTest.injectRemote("另一标签页第二版")')
await sleep(120)
await evaluate("document.querySelector('.conflict-adopt')?.click()")
await sleep(250)
report.adoptRemoteConflict = {
  storedName: await storedName(),
  sessionName: await evaluate('window.__llTest.tabName()'),
  mirrorName: await evaluate('window.__llTest.mirrorName()'),
  fieldName: await evaluate("document.querySelector('#project-name')?.value ?? null"),
  bannerGone: await evaluate("!document.querySelector('.conflict-banner')"),
  recoveryCount: await evaluate('window.__llTest.countKeys(' + JSON.stringify(RECOVERY_PREFIX) + ')'),
  activeProjectId: await evaluate('window.__llTest.activeProjectId()'),
}

// 5) 同一份损坏原文反复加载，不应堆出多份恢复副本
const corruptRaw = '{"name":"坏了","rungs":[]}'
await evaluate(
  '(() => { window.localStorage.clear(); window.sessionStorage.clear(); ' +
    'window.localStorage.setItem(' +
    JSON.stringify(LEGACY_STORAGE_KEY) +
    ', ' +
    JSON.stringify(corruptRaw) +
    '); return true })()',
)
for (let round = 0; round < 3; round += 1) {
  await send('Page.reload')
  await sleep(900)
}
await evaluate(PAGE_HELPERS)
report.recoveryBackups = {
  count: await evaluate('window.__llTest.countKeys(' + JSON.stringify(RECOVERY_PREFIX) + ')'),
  bannerVisible: await evaluate("Boolean(document.querySelector('.recovery-banner'))"),
  projectUntouched: (await evaluate('window.localStorage.getItem(' + JSON.stringify(LEGACY_STORAGE_KEY) + ')')) === corruptRaw,
}

socket.close()
console.log(JSON.stringify({ report, errors }, null, 2))

const failed =
  report.flushOnReload.storedName !== '刷新保命测试' ||
  report.flushOnReload.fieldName !== '刷新保命测试' ||
  report.flushOnHidden.storedName !== '后台保命测试' ||
  !report.keepLocalConflict.before.bannerVisible ||
  report.keepLocalConflict.before.sessionName === '另一标签页版本' ||
  report.keepLocalConflict.before.mirrorName !== '另一标签页版本' ||
  report.keepLocalConflict.storedName !== '本页未保存修改' ||
  report.keepLocalConflict.mirrorName !== '本页未保存修改' ||
  report.keepLocalConflict.fieldName !== '本页未保存修改' ||
  !report.keepLocalConflict.bannerGone ||
  report.keepLocalConflict.recoveryCount !== 1 ||
  report.adoptRemoteConflict.storedName !== '另一标签页第二版' ||
  report.adoptRemoteConflict.sessionName !== '另一标签页第二版' ||
  report.adoptRemoteConflict.mirrorName !== '另一标签页第二版' ||
  report.adoptRemoteConflict.fieldName !== '另一标签页第二版' ||
  !report.adoptRemoteConflict.bannerGone ||
  report.adoptRemoteConflict.recoveryCount !== 2 ||
  report.adoptRemoteConflict.activeProjectId !== projectId ||
  report.recoveryBackups.count !== 1 ||
  !report.recoveryBackups.bannerVisible ||
  !report.recoveryBackups.projectUntouched ||
  errors.length > 0
if (failed) process.exitCode = 1

