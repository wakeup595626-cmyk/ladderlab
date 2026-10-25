/** 自动保存回归：需要 preview:4173 与 Edge 的 CDP 端口 9222。
 *
 * 覆盖三条“用户以为已经存住”的路径：
 * 1. 编辑后立刻刷新（仍在防抖窗口内），最后一笔修改不能丢；
 * 2. 编辑后切到后台（visibilitychange hidden），同样不能丢；
 * 3. 同一份损坏数据反复加载，只应产生一个恢复副本。
 */

const CDP_HTTP = process.env.LADDERLAB_CDP ?? 'http://127.0.0.1:9222'
const APP_URL = process.env.LADDERLAB_URL ?? 'http://127.0.0.1:4173/'
const STORAGE_KEY = 'ladderlab.project.v1'
const RECOVERY_PREFIX = 'ladderlab.project.v1.recovery.'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const targets = await (await fetch(CDP_HTTP + '/json')).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('没有可调试页面：' + CDP_HTTP)

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
  "    const input = document.querySelector('.project-name')",
  '    if (!input) return false',
  "    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set",
  '    setter.call(input, name)',
  "    input.dispatchEvent(new Event('input', { bubbles: true }))",
  '    return true',
  '  },',
  '  storedName(key) {',
  '    const raw = window.localStorage.getItem(key)',
  '    if (!raw) return null',
  "    try { return JSON.parse(raw).name } catch { return 'unparseable' }",
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
  '    const key = ' + JSON.stringify(STORAGE_KEY),
  '    const raw = window.localStorage.getItem(key)',
  '    if (!raw) return false',
  '    const remote = JSON.parse(raw)',
  '    remote.name = name',
  '    const next = JSON.stringify(remote, null, 2)',
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
  await evaluate('window.localStorage.clear(); true')
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
    throw new Error('找不到工程名称输入框 .project-name；页面快照：' + JSON.stringify(snapshot) + '；错误：' + JSON.stringify(errors))
  }
}

async function storedName() {
  return evaluate('window.__llTest.storedName(' + JSON.stringify(STORAGE_KEY) + ')')
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
  fieldName: await evaluate("document.querySelector('.project-name')?.value ?? null"),
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

// 3) 多标签页冲突：保留本页时先把另一版存成恢复副本。
await renameProject('本页未保存修改')
await sleep(100)
await evaluate('window.__llTest.injectRemote("另一标签页版本")')
await sleep(500)
const keepLocalBefore = {
  storedName: await storedName(),
  bannerVisible: await evaluate("Boolean(document.querySelector('.conflict-banner'))"),
}
await evaluate("document.querySelector('.conflict-keep')?.click()")
await sleep(250)
report.keepLocalConflict = {
  before: keepLocalBefore,
  storedName: await storedName(),
  fieldName: await evaluate("document.querySelector('.project-name')?.value ?? null"),
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
  fieldName: await evaluate("document.querySelector('.project-name')?.value ?? null"),
  bannerGone: await evaluate("!document.querySelector('.conflict-banner')"),
  recoveryCount: await evaluate('window.__llTest.countKeys(' + JSON.stringify(RECOVERY_PREFIX) + ')'),
}

// 5) 同一份损坏原文反复加载，不应堆出多份恢复副本
const corruptRaw = '{"name":"坏了","rungs":[]}'
await evaluate(
  '(() => { window.localStorage.clear(); ' +
    'window.localStorage.setItem(' +
    JSON.stringify(STORAGE_KEY) +
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
  projectUntouched: (await evaluate('window.localStorage.getItem(' + JSON.stringify(STORAGE_KEY) + ')')) === corruptRaw,
}

socket.close()
console.log(JSON.stringify({ report, errors }, null, 2))

const failed =
  report.flushOnReload.storedName !== '刷新保命测试' ||
  report.flushOnReload.fieldName !== '刷新保命测试' ||
  report.flushOnHidden.storedName !== '后台保命测试' ||
  !report.keepLocalConflict.before.bannerVisible ||
  report.keepLocalConflict.before.storedName !== '另一标签页版本' ||
  report.keepLocalConflict.storedName !== '本页未保存修改' ||
  report.keepLocalConflict.fieldName !== '本页未保存修改' ||
  !report.keepLocalConflict.bannerGone ||
  report.keepLocalConflict.recoveryCount !== 1 ||
  report.adoptRemoteConflict.storedName !== '另一标签页第二版' ||
  report.adoptRemoteConflict.fieldName !== '另一标签页第二版' ||
  !report.adoptRemoteConflict.bannerGone ||
  report.adoptRemoteConflict.recoveryCount !== 2 ||
  report.recoveryBackups.count !== 1 ||
  !report.recoveryBackups.bannerVisible ||
  !report.recoveryBackups.projectUntouched ||
  errors.length > 0
if (failed) process.exitCode = 1

