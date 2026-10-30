import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_QA_APP_URL,
  DEFAULT_QA_CDP,
  READ_LIBRARY_IN_PAGE,
  selectExactPage,
} from './qa-cdp.mjs'

const CDP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const URL_UNDER_TEST = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
await mkdir(resolve('docs/qa'), { recursive: true })

const targets = await (await fetch(CDP + '/json')).json()
const target = selectExactPage(targets, URL_UNDER_TEST, CDP)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((open, fail) => {
  socket.addEventListener('open', open, { once: true })
  socket.addEventListener('error', fail, { once: true })
})

let nextId = 0
const pending = new Map()
const consoleErrors = []
function send(method, params = {}) {
  const id = ++nextId
  return new Promise((ok, no) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      no(new Error(`CDP 请求超时（12000ms）：${method}`))
    }, 12_000)
    pending.set(id, { ok, no, timer })
    try {
      socket.send(JSON.stringify({ id, method, params }))
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      no(error)
    }
  })
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.no(new Error(message.error.message))
    else request.ok(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? 'exception')
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args?.map((item) => item.value ?? item.description).join(' '))
  }
})

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
}

async function waitForApp() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate(`document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')`)) return
    await sleep(200)
  }
  throw new Error('App did not mount')
}

async function reload(clear = false) {
  if (clear) {
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(250)
    await send('Storage.clearDataForOrigin', {
      origin: new URL(URL_UNDER_TEST).origin,
      storageTypes: 'local_storage,session_storage',
    })
  }
  await send('Page.navigate', { url: URL_UNDER_TEST })
  await waitForApp()
  await sleep(300)
}

async function screenshot(path) {
  await send('Page.bringToFront')
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

async function click(selector) {
  return evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    if (!node) return false
    node.click()
    return true
  })()`)
}

async function fill(selector, value) {
  return evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

async function renameProject(value) {
  const changed = await evaluate(`(() => {
    const input = document.querySelector('#project-name')
    if (!input) return false
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return document.activeElement === input
  })()`)
  if (!changed) return false
  // 工程名输入框是非受控字段，只在真实 Enter/失焦时提交。用 CDP 发送可信
  // 键盘事件，走与用户完全相同的提交路径，避免脚本直接 blur 时事件丢失。
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  })
  await sleep(120)
  return evaluate(`(() => {
    const input = document.querySelector('#project-name')
    return {
      focused: document.activeElement === input,
      value: input?.value ?? null,
    }
  })()`)
}

const checks = {}
const details = {}
const check = (name, value, note) => {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
}

async function openProjectDrawer() {
  await click('.wb-project-button')
  await sleep(260)
  return evaluate(`!!document.querySelector('.wb-project-drawer')`)
}

async function closeDrawer() {
  await click('.wb-drawer-close')
  await sleep(220)
}

async function submitSave(name) {
  await click('.wb-save-button')
  await sleep(260)
  const ready = await fill('#save-project-name', name)
  await sleep(80)
  await click('.save-project-confirm')
  await sleep(350)
  return ready
}

await send('Page.enable')
await send('Runtime.enable')
await setViewport(1440, 900, false)
await reload(true)

const initial = await evaluate(`({
  save: !!document.querySelector('.wb-save-button'),
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
})`)
check('desktop/save-button-visible', initial.save)
check('desktop/no-overflow', !initial.overflow)

check('desktop/project-drawer-opens', await openProjectDrawer())
const drawerActions = await evaluate(`[...document.querySelectorAll('.wb-project-drawer button')]
  .map((button) => button.textContent?.replace(/\\s+/g, ' ').trim() ?? '')`)
check(
  'desktop/drawer-has-no-duplicate-file-actions',
  !drawerActions.some((text) => /新建空白工程|导入工程|导出工程|完整程序 PNG|纯梯形图 PNG/.test(text)),
  drawerActions,
)
check(
  'desktop/drawer-has-empty-library-state',
  await evaluate(`document.querySelector('.wb-project-empty')?.textContent?.includes('还没有命名项目') === true`),
)
await screenshot('docs/qa/desktop-project-drawer-empty.png')
await closeDrawer()

await click('.wb-save-button')
await sleep(260)
const saveDialog = await evaluate(`({
  open: !!document.querySelector('.save-project-dialog'),
  focused: document.activeElement?.id === 'save-project-name',
  title: document.querySelector('#save-project-title')?.textContent?.trim() ?? null,
  button: document.querySelector('.save-project-confirm')?.textContent?.trim() ?? null,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
})`)
check('desktop/save-dialog-opens', saveDialog.open && saveDialog.focused, saveDialog)
check('desktop/save-dialog-copy', saveDialog.title === '保存工程' && String(saveDialog.button).includes('保存到项目库'), saveDialog)
await screenshot('docs/qa/desktop-project-save-dialog.png')

await fill('#save-project-name', '电机启保停实验')
await sleep(100)
await click('.save-project-confirm')
await sleep(500)
const firstSave = await evaluate(`(() => {
  const library = ${READ_LIBRARY_IN_PAGE}
  return {
    dialogOpen: !!document.querySelector('.save-project-dialog'),
    projectName: document.querySelector('#project-name')?.value ?? null,
    projectNames: library?.projects?.map((project) => project.program.name) ?? [],
    active: sessionStorage.getItem('ladderlab.library.v1.active'),
    toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
  }
})()`)
check(
  'desktop/named-project-saves',
  !firstSave.dialogOpen && firstSave.projectName === '电机启保停实验'
    && firstSave.projectNames.includes('电机启保停实验') && Boolean(firstSave.active),
  firstSave,
)

await reload(false)
const restored = await evaluate(`({
  projectName: document.querySelector('#project-name')?.value ?? null,
  active: sessionStorage.getItem('ladderlab.library.v1.active'),
})`)
check('desktop/named-project-restores-after-reload', restored.projectName === '电机启保停实验' && Boolean(restored.active), restored)

await openProjectDrawer()
const savedDrawer = await evaluate(`({
  items: [...document.querySelectorAll('.wb-saved-project-name')].map((item) => item.textContent?.replace(/\\s+/g, ' ').trim()),
  current: document.querySelectorAll('.wb-saved-project.is-current').length,
  note: document.querySelector('.wb-saved-project-note')?.textContent?.trim() ?? null,
})`)
check(
  'desktop/saved-project-listed-and-marked-current',
  savedDrawer.items.some((name) => name?.includes('电机启保停实验')) && savedDrawer.current === 1,
  savedDrawer,
)
await screenshot('docs/qa/desktop-project-drawer-filled.png')
await closeDrawer()

const firstRename = await renameProject('电机启保停实验·改名')
await sleep(100)
await click('.wb-save-button')
await sleep(300)
const renamed = await evaluate(`(() => {
  const library = ${READ_LIBRARY_IN_PAGE}
  return {
    projectName: document.querySelector('#project-name')?.value ?? null,
    projectNames: library.projects.map((project) => project.program.name),
    count: library.projects.length,
    dialogOpen: !!document.querySelector('.save-project-dialog'),
    dialogError: document.querySelector('#save-project-error')?.textContent?.trim() ?? null,
    toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
    active: sessionStorage.getItem('ladderlab.library.v1.active'),
    conflict: document.querySelector('.wb-conflict-banner')?.textContent?.trim() ?? null,
    focused: document.activeElement?.id ?? null,
  }
})()`)
renamed.rename = firstRename
check(
  'desktop/named-project-saves-quickly-in-place',
  renamed.projectName === '电机启保停实验·改名' && renamed.count === 1
    && renamed.projectNames.includes('电机启保停实验·改名'),
  renamed,
)

await click('.wb-file-button[aria-label="新建空白工程"]')
await sleep(260)
const newProjectPrompt = await evaluate(`({
  open: !!document.querySelector('#new-project-name'),
  defaultName: document.querySelector('#new-project-name')?.value ?? null,
})`)
check(
  'desktop/new-project-dialog-defaults',
  newProjectPrompt.open && newProjectPrompt.defaultName === '未命名工程',
  newProjectPrompt,
)
await fill('#new-project-name', '质检新建工程')
await sleep(100)
await click('.project-import-confirm')
await sleep(900)
const newProjectState = await evaluate(`({
  name: document.querySelector('#project-name')?.value ?? null,
  active: sessionStorage.getItem('ladderlab.library.v1.active'),
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
})`)
check(
  'desktop/new-project-available',
  newProjectState.name === '质检新建工程'
    && !newProjectState.active
    && String(newProjectState.toast ?? '').includes('质检新建工程'),
  newProjectState,
)
await click('.wb-save-button')
await sleep(280)
const newProjectDialog = await evaluate(`({
  open: !!document.querySelector('.save-project-dialog'),
  suggestedName: document.querySelector('#save-project-name')?.value ?? null,
})`)
check(
  'desktop/new-project-save-dialog-uses-blank-name',
  newProjectDialog.open && newProjectDialog.suggestedName === '质检新建工程',
  newProjectDialog,
)
await click('.project-import-back')
await sleep(220)
await submitSave('交通灯顺序控制')
const secondSave = await evaluate(`(() => {
  const library = ${READ_LIBRARY_IN_PAGE}
  return {
    names: library.projects.map((project) => project.program.name),
    active: sessionStorage.getItem('ladderlab.library.v1.active'),
  }
})()`)
check('desktop/second-project-saves', secondSave.names.length === 2 && secondSave.names.includes('交通灯顺序控制'), secondSave)

await renameProject('电机启保停实验·改名')
await sleep(100)
await click('.wb-save-button')
await sleep(320)
const conflict = await evaluate(`({
  open: !!document.querySelector('.save-project-dialog'),
  error: document.querySelector('#save-project-error')?.textContent?.trim() ?? null,
  names: (${READ_LIBRARY_IN_PAGE})?.projects?.map((project) => project.program.name) ?? [],
})`)
check('desktop/duplicate-name-is-explained', conflict.open && String(conflict.error).includes('同名项目'), conflict)
await fill('#save-project-name', '照明控制实验')
await sleep(80)
await click('.save-project-confirm')
await sleep(420)
const resolved = await evaluate(`(${READ_LIBRARY_IN_PAGE})?.projects?.map((project) => project.program.name) ?? []`)
check(
  'desktop/conflict-can-be-resolved',
  resolved.length === 2 && resolved.includes('照明控制实验'),
  resolved,
)

await openProjectDrawer()
const openedFirst = await evaluate(`(() => {
  const item = [...document.querySelectorAll('.wb-saved-project-open')]
    .find((button) => button.textContent?.includes('电机启保停实验·改名'))
  item?.click()
  return !!item
})()`)
await sleep(300)
await click('.confirm-ok')
await sleep(520)
const reopened = await evaluate(`({
  projectName: document.querySelector('#project-name')?.value ?? null,
  drawerOpen: !!document.querySelector('.wb-project-drawer'),
  active: sessionStorage.getItem('ladderlab.library.v1.active'),
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
})`)
check(
  'desktop/saved-project-reopens-with-name',
  openedFirst && reopened.projectName === '电机启保停实验·改名' && !reopened.drawerOpen && Boolean(reopened.active),
  reopened,
)

const activeBeforeShortcut = await evaluate(`sessionStorage.getItem('ladderlab.library.v1.active')`)
await send('Input.dispatchKeyEvent', {
  type: 'rawKeyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2,
})
await send('Input.dispatchKeyEvent', {
  type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2,
})
await sleep(420)
const shortcut = await evaluate(`({
  dialogOpen: !!document.querySelector('.save-project-dialog'),
  active: sessionStorage.getItem('ladderlab.library.v1.active'),
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
})`)
check(
  'desktop/ctrl-s-saves-current-project',
  !shortcut.dialogOpen && shortcut.active === activeBeforeShortcut,
  shortcut,
)

await setViewport(390, 844, true)
await reload(false)
const mobile390 = await evaluate(`({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  saveVisible: Boolean(document.querySelector('.wb-save-button')?.getClientRects().length),
  tabs: [...document.querySelectorAll('.wb-tabbar .mobile-tab-action')]
    .map((button) => button.textContent?.replace(/\\s+/g, ' ').trim() ?? ''),
})`)
check('mobile390/no-overflow', !mobile390.overflow, mobile390)
check('mobile390/save-visible', mobile390.saveVisible, mobile390)
check(
  'mobile390/four-primary-tabs',
  mobile390.tabs.length === 4 && mobile390.tabs.some((text) => text.includes('项目')),
  mobile390.tabs,
)
const mobileProjectClicked = await evaluate(`(() => {
  const button = [...document.querySelectorAll('.wb-tabbar .mobile-tab-action')]
    .find((item) => item.textContent?.includes('项目'))
  button?.click()
  return Boolean(button)
})()`)
await sleep(320)
const mobileDrawer390 = await evaluate(`(() => {
  const drawer = document.querySelector('.wb-project-drawer')
  const rect = drawer?.getBoundingClientRect()
  return {
    open: Boolean(drawer),
    width: rect?.width ?? 0,
    viewport: window.innerWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    hasNamedProject: [...document.querySelectorAll('.wb-saved-project-open')]
      .some((button) => button.textContent?.includes('电机启保停实验·改名')),
  }
})()`)
check(
  'mobile390/project-drawer-fits',
  mobileProjectClicked && mobileDrawer390.open && mobileDrawer390.width <= 390
    && mobileDrawer390.width > 300 && !mobileDrawer390.overflow,
  mobileDrawer390,
)
check('mobile390/named-project-readable', mobileDrawer390.hasNamedProject, mobileDrawer390)
await screenshot('docs/qa/mobile-project-drawer.png')

await setViewport(360, 800, true)
await reload(false)
const mobile360 = await evaluate(`({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  saveVisible: Boolean(document.querySelector('.wb-save-button')?.getClientRects().length),
})`)
check('mobile360/no-overflow', !mobile360.overflow, mobile360)
check('mobile360/save-visible', mobile360.saveVisible, mobile360)
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.wb-tabbar .mobile-tab-action')]
    .find((item) => item.textContent?.includes('项目'))
  button?.click()
})()`)
await sleep(320)
const drawer360 = await evaluate(`(() => {
  const rect = document.querySelector('.wb-project-drawer')?.getBoundingClientRect()
  return {
    open: Boolean(rect),
    width: rect?.width ?? 0,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }
})()`)
check(
  'mobile360/project-drawer-fits',
  drawer360.open && drawer360.width <= 360 && drawer360.width > 300 && !drawer360.overflow,
  drawer360,
)
await screenshot('docs/qa/mobile-360-project-drawer.png')

socket.close()
console.log(JSON.stringify({ checks, details, consoleErrors }, null, 2))
if (Object.values(checks).some((value) => !value) || consoleErrors.length > 0) process.exitCode = 1
