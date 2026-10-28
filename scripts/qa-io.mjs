/** 工程导入 / 导出与 PNG 验收：需要 preview 服务和 Edge CDP。 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_QA_APP_URL, DEFAULT_QA_CDP, selectExactPage } from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const downloadDir = resolve('docs/qa/io')
const complexFixturePath = resolve('scripts/fixtures/qa-complex.json')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const isBlankRung = (rung) => rung?.nodes?.length === 0
  && rung?.output?.kind === 'COIL'
  && !String(rung?.output?.tag ?? '').trim()
  && !String(rung?.label ?? '').trim()
const contentRungCount = (program) => program.rungs.filter((rung) => !isBlankRung(rung)).length

await mkdir(downloadDir, { recursive: true })
for (const name of await readdir(downloadDir)) {
  if (/\.(json|png)$/i.test(name)) await rm(resolve(downloadDir, name))
}

const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
const target = selectExactPage(targets, APP_URL, CDP_HTTP)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((open, fail) => {
  socket.addEventListener('open', open, { once: true })
  socket.addEventListener('error', fail, { once: true })
})

let nextId = 0
const pending = new Map()
const errors = []

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((ok, no) => {
    pending.set(id, { ok, no })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.no(new Error(message.error.message))
    else request.ok(message.result)
    return
  }
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
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function waitFor(check, timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(120)
  }
  return false
}

async function waitForApp() {
  const ready = await waitFor(() => evaluate(
    `document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')`,
  ))
  if (!ready) throw new Error(`等待页面就绪超时：${APP_URL}`)
}

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
  await send('Emulation.setEmulatedMedia', {
    features: mobile
      ? [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }]
      : [{ name: 'pointer', value: 'fine' }, { name: 'any-pointer', value: 'fine' }],
  })
}

async function reloadFresh() {
  await evaluate(`localStorage.clear(); location.reload()`).catch(() => {})
  await sleep(500)
  await waitForApp()
  await sleep(400)
}

async function loadDemo() {
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('.wb-coach-demo')
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!clicked) {
    await evaluate(`document.querySelector('.wb-more .icon-button')?.click()`)
    await sleep(200)
    await evaluate(`(() => {
      const item = [...document.querySelectorAll('.wb-more-menu button')]
        .find((button) => button.textContent?.includes('三步上手'))
      item?.click()
    })()`)
    await sleep(250)
    await evaluate(`document.querySelector('.guide-primary')?.click()`)
  }
  await sleep(800)
}

async function waitForDownload(extension, previous = []) {
  let found = null
  await waitFor(async () => {
    const names = await readdir(downloadDir)
    const match = names.find((name) => name.endsWith(extension)
      && !name.endsWith('.crdownload') && !previous.includes(name))
    if (!match) return false
    found = resolve(downloadDir, match)
    return true
  }, 30000)
  if (!found) throw new Error(`等待 ${extension} 下载超时`)
  return found
}

async function screenshot(path) {
  await evaluate(
    `document.querySelectorAll('plasmo-csui, #dx-sibebar-container').forEach((node) => node.remove())`,
  ).catch(() => {})
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(resolve(path), Buffer.from(shot.data, 'base64'))
}

async function openFileActions(mobile = false) {
  const selector = mobile ? '.wb-file-compact' : '.wb-export-trigger'
  const opened = await evaluate(`(() => {
    const trigger = document.querySelector(${JSON.stringify(selector)})
    if (!trigger) return false
    trigger.click()
    return true
  })()`)
  if (!opened) throw new Error(`找不到文件操作入口：${selector}`)
  const menuSelector = mobile ? '.wb-file-compact-menu' : '.wb-export-menu'
  if (!await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(menuSelector)})`))) {
    throw new Error(`文件菜单没有打开：${menuSelector}`)
  }
  await sleep(180)
}

async function clickFileAction(label, mobile = false) {
  if (!mobile && (label === '新建' || label === '导入')) {
    const clicked = await evaluate(`(() => {
      const item = [...document.querySelectorAll('.wb-file-actions-desktop button')]
        .find((button) => button.textContent?.trim() === ${JSON.stringify(label)})
      if (!item) return false
      item.click()
      return true
    })()`)
    if (!clicked) throw new Error(`找不到顶栏按钮：${label}`)
    await sleep(180)
    return
  }

  await openFileActions(mobile)
  const menuSelector = mobile ? '.wb-file-compact-menu' : '.wb-export-menu'
  const clicked = await evaluate(`(() => {
    const item = [...document.querySelectorAll(${JSON.stringify(menuSelector)} + ' button')]
      .find((button) => button.textContent?.includes(${JSON.stringify(label)}))
    if (!item) return false
    item.click()
    return true
  })()`)
  if (!clicked) {
    const labels = await evaluate(`[...document.querySelectorAll(${JSON.stringify(menuSelector)} + ' button')]
      .map((button) => button.textContent?.trim())`)
    throw new Error(`找不到文件菜单项：${label}；${JSON.stringify(labels)}`)
  }
  await sleep(180)
}

async function uploadImportFile(path) {
  const documentNode = await send('DOM.getDocument', { depth: -1, pierce: true })
  const fileNode = await send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: '.project-import-dialog input[type="file"]',
  })
  if (!fileNode.nodeId) throw new Error('导入弹窗里没有文件输入框')
  await send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [path] })
  if (!await waitFor(() => evaluate(`!!document.querySelector('.project-import-preview')`))) {
    const message = await evaluate(`document.querySelector('.project-import-error')?.textContent ?? ''`)
    throw new Error(`工程文件没有生成导入预览：${message}`)
  }
}

await send('Page.enable')
await send('Runtime.enable')
try {
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true,
  })
} catch {
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
}

const checks = {}
const details = {}

await setViewport(1440, 900, false)
await reloadFresh()
await loadDemo()

const before = await evaluate(`(() => ({
  name: document.querySelector('#project-name')?.value,
  rungs: document.querySelectorAll('.ll-rung').length,
  labels: [...document.querySelectorAll('.ll-rung-index')].map((item) => item.textContent),
  tags: document.querySelectorAll('.wb-tag-row').length,
  addresses: [...document.querySelectorAll('.ll-node-address, .ll-output-address, .ll-box-external-value')].map((item) => item.textContent),
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
}))()`)

await openFileActions(false)
const exportUi = await evaluate(`(() => {
  const menu = document.querySelector('.wb-export-menu')
  const rect = menu?.getBoundingClientRect()
  return {
    actions: [...document.querySelectorAll('.wb-file-actions-desktop button')]
      .map((button) => button.textContent?.replace(/\\s+/g, ' ').trim()),
    menuItems: [...document.querySelectorAll('.wb-export-menu button')]
      .map((button) => button.textContent?.replace(/\\s+/g, ' ').trim()),
    menuInsideViewport: !!rect
      && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})()`)
await screenshot('docs/qa/io-topbar-export-desktop.png')
checks['topbar/new-import-export-visible'] = ['新建', '导入', '导出']
  .every((label) => exportUi.actions.some((action) => action?.startsWith(label)))
checks['topbar/export-menu-exposes-three-formats'] = exportUi.menuItems.length === 3
  && exportUi.menuItems.some((label) => label?.includes('工程文件'))
  && exportUi.menuItems.some((label) => label?.includes('完整程序 PNG'))
  && exportUi.menuItems.some((label) => label?.includes('纯梯形图 PNG'))
checks['topbar/export-menu-fits'] = exportUi.menuInsideViewport && !exportUi.pageOverflow
details['topbar/export-ui'] = exportUi
await evaluate(`(() => {
  const item = [...document.querySelectorAll('.wb-export-menu button')]
    .find((button) => button.textContent?.includes('工程文件'))
  item?.click()
})()`)
await sleep(180)
const projectPath = await waitForDownload('.ladderlab.json')
const exportedRaw = await readFile(projectPath, 'utf8')
const exported = JSON.parse(exportedRaw)
checks['export/project-json'] = exported.schema === 1 && exported.rungs.length === before.rungs
details['export/project-json'] = {
  path: projectPath,
  name: exported.name,
  rungs: exported.rungs.length,
  tags: exported.tags.length,
  bytes: Buffer.byteLength(exportedRaw),
}

// 先改掉工程名，确认导入文件会真正替换当前工程。
await evaluate(`(() => {
  const input = document.querySelector('#project-name')
  if (!input) return false
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '导入前临时工程')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', bubbles: true
  }))
  return true
})()`)
await waitFor(() => evaluate(`document.querySelector('#project-name')?.value === '导入前临时工程'`))

await clickFileAction('导入')
const dialogOpen = await evaluate(`!!document.querySelector('.project-import-dialog')`)
await uploadImportFile(projectPath)
const preview = await evaluate(`(() => ({
  metrics: [...document.querySelectorAll('.project-import-metrics dd')].map((item) => item.textContent),
  name: document.querySelector('.project-import-summary strong')?.textContent,
  error: document.querySelector('.project-import-error')?.textContent ?? '',
  overflow: (() => {
    const node = document.querySelector('.project-import-dialog')
    if (!node) return true
    const rect = node.getBoundingClientRect()
    return node.scrollWidth > node.clientWidth + 1 || rect.left < 0 || rect.right > innerWidth
  })()
}))()`)
await screenshot('docs/qa/io-import-desktop.png')
await evaluate(`document.querySelector('.project-import-confirm')?.click()`)
await waitFor(() => evaluate(`!document.querySelector('.project-import-dialog')`))
await sleep(700)

const after = await evaluate(`(() => ({
  name: document.querySelector('#project-name')?.value,
  rungs: document.querySelectorAll('.ll-rung').length,
  labels: [...document.querySelectorAll('.ll-rung-index')].map((item) => item.textContent),
  saved: localStorage.getItem('ladderlab.project.v1.mirror.v2')
    ?? localStorage.getItem('ladderlab.project.v1')
}))()`)
const savedDraft = after.saved ? JSON.parse(after.saved) : null
const saved = savedDraft?.program ?? savedDraft
checks['import/dialog-opens'] = dialogOpen
checks['import/preview-matches'] = preview.name === exported.name
  && Number(preview.metrics[0]) === contentRungCount(exported)
  && Number(preview.metrics[1]) === exported.tags.length
checks['import/no-dialog-overflow'] = !preview.overflow && !preview.error
checks['import/replaces-current-project'] = after.name === exported.name
checks['import/roundtrip-content'] = Boolean(saved)
  && saved.name === exported.name
  && saved.rungs.length === exported.rungs.length
  && JSON.stringify(saved.rungs) === JSON.stringify(exported.rungs)
details['import/roundtrip-content'] = {
  preview: preview.metrics,
  previewName: preview.name,
  importedName: after.name,
  rungs: after.rungs,
  labels: after.labels,
  sameRungs: saved ? JSON.stringify(saved.rungs) === JSON.stringify(exported.rungs) : false,
}

async function inspectPng(path) {
  const base64 = await readFile(path, { encoding: 'base64' })
  return evaluate(`(async () => {
    const image = new Image()
    image.src = 'data:image/png;base64,${base64}'
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const points = [[0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1]]
    const corners = points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data])
    return { width: image.width, height: image.height, corners }
  })()`)
}

const beforeComplete = await readdir(downloadDir)
await clickFileAction('完整程序 PNG')
const completePng = await waitForDownload('.png', beforeComplete)
const completeImage = await inspectPng(completePng)

await sleep(700)
const beforePlain = await readdir(downloadDir)
await clickFileAction('纯梯形图 PNG')
const plainPng = await waitForDownload('.png', beforePlain)
const plainImage = await inspectPng(plainPng)

const isWhite = (rgba) => rgba.slice(0, 3).every((value) => value === 255) && rgba[3] === 255
checks['png/complete-white-background'] = completeImage.corners.every(isWhite)
checks['png/plain-white-background'] = plainImage.corners.every(isWhite)
checks['png/both-generated'] = completeImage.width > 800 && plainImage.width > 800
details['png/complete'] = { path: completePng, ...completeImage }
details['png/plain'] = { path: plainPng, ...plainImage }

await clickFileAction('导入')
await uploadImportFile(complexFixturePath)
const complexPreview = await evaluate(`(() => ({
  name: document.querySelector('.project-import-summary strong')?.textContent,
  metrics: [...document.querySelectorAll('.project-import-metrics dd')].map((item) => item.textContent),
  error: document.querySelector('.project-import-error')?.textContent ?? '',
}))()`)
await evaluate(`document.querySelector('.project-import-confirm')?.click()`)
await waitFor(() => evaluate(`!document.querySelector('.project-import-dialog')`))
await sleep(900)
const complexProgram = await evaluate(`(() => ({
  name: document.querySelector('#project-name')?.value,
  rungs: document.querySelectorAll('.ll-rung:not(.is-placeholder)').length,
  labels: [...document.querySelectorAll('.ll-rung:not(.is-placeholder) .ll-rung-index')]
    .map((item) => item.textContent),
  placeholders: document.querySelectorAll('.ll-rung.is-placeholder').length,
  addresses: [...document.querySelectorAll('.ll-node-address, .ll-output-address, .ll-box-external-value')].map((item) => item.textContent),
  hasMove: document.body.innerText.includes('MOVE'),
}))()`)
checks['complex/import-preview'] = complexPreview.name === '复杂程序 · 多段导出验收'
  && Number(complexPreview.metrics[0]) === 3
  && !complexPreview.error
checks['complex/three-labelled-rungs'] = complexProgram.rungs === 3
  && complexProgram.placeholders === 1
  && JSON.stringify(complexProgram.labels) === JSON.stringify(['程序段 1', '程序段 2', '程序段 3'])
checks['complex/move-and-addresses-rendered'] = complexProgram.hasMove
  && complexProgram.addresses.includes('%I0.0')
  && complexProgram.addresses.includes('%MW16')
details['complex/program'] = complexProgram

const beforeComplexComplete = await readdir(downloadDir)
await clickFileAction('完整程序 PNG')
const complexCompletePng = await waitForDownload('.png', beforeComplexComplete)
const complexCompleteImage = await inspectPng(complexCompletePng)

await sleep(700)
const beforeComplexPlain = await readdir(downloadDir)
await clickFileAction('纯梯形图 PNG')
const complexPlainPng = await waitForDownload('.png', beforeComplexPlain)
const complexPlainImage = await inspectPng(complexPlainPng)

checks['complex/complete-png-white-background'] = complexCompleteImage.corners.every(isWhite)
checks['complex/plain-png-white-background'] = complexPlainImage.corners.every(isWhite)
checks['complex/complete-image-has-program-heading'] = complexCompleteImage.height > complexPlainImage.height
details['complex/complete-png'] = { path: complexCompletePng, ...complexCompleteImage }
details['complex/plain-png'] = { path: complexPlainPng, ...complexPlainImage }

await openFileActions(false)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
await sleep(180)
const escapeState = await evaluate(`(() => ({
  closed: !document.querySelector('.wb-export-menu'),
  focusReturned: document.activeElement?.classList.contains('wb-export-trigger'),
}))()`)
checks['keyboard/escape-closes-export-menu'] = escapeState.closed && escapeState.focusReturned
details['keyboard/export-menu'] = escapeState

const responsiveTopbar = []
for (const width of [1180, 900, 861, 860, 720, 480, 430, 400, 390, 360, 320]) {
  await setViewport(width, 900, false)
  await sleep(120)
  responsiveTopbar.push(await evaluate(`(() => {
    const desktop = document.querySelector('.wb-file-actions-desktop')
    const compact = document.querySelector('.wb-file-compact')
    const controls = [
      ...document.querySelectorAll('.wb-file-actions-desktop, .wb-file-compact, .wb-run-toggle, .wb-more .icon-button'),
    ]
    const visible = controls.filter((node) => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && rect.width > 0
    })
    return {
      width: innerWidth,
      desktopActions: getComputedStyle(desktop).display !== 'none',
      compactActions: getComputedStyle(compact).display !== 'none',
      controlsInsideViewport: visible.every((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth
      }),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })()`))
}
checks['responsive/file-actions-fit'] = responsiveTopbar.every((state) => (
  state.controlsInsideViewport
  && !state.pageOverflow
  && (state.width > 860 ? state.desktopActions : state.compactActions)
))
details['responsive/topbar'] = responsiveTopbar

await setViewport(390, 844, true)
await sleep(400)
await openFileActions(true)
const mobileFileUi = await evaluate(`(() => {
  const menu = document.querySelector('.wb-file-compact-menu')
  const rect = menu?.getBoundingClientRect()
  return {
    labels: [...document.querySelectorAll('.wb-file-compact-menu button')]
      .map((button) => button.textContent?.replace(/\\s+/g, ' ').trim()),
    menu: rect ? {
      left: Math.round(rect.left), right: Math.round(rect.right),
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
    } : null,
    controls: Object.fromEntries(['.wb-project-button', '.wb-file-compact', '.wb-save-button', '.wb-run-toggle', '.wb-more .icon-button', '.wb-topbar-actions']
      .map((selector) => {
        const node = document.querySelector(selector)
        const box = node?.getBoundingClientRect()
        return [selector, box ? {
          left: Math.round(box.left), right: Math.round(box.right),
          top: Math.round(box.top), bottom: Math.round(box.bottom),
          width: Math.round(box.width), display: node ? getComputedStyle(node).display : null,
        } : null]
      })),
    controlsInsideViewport: ['.wb-file-compact', '.wb-run-toggle', '.wb-more .icon-button']
      .every((selector) => {
        const node = document.querySelector(selector)
        if (!node) return false
        const box = node.getBoundingClientRect()
        return box.width > 0 && box.left >= 0 && box.right <= innerWidth
      }),
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})()`)
await screenshot('docs/qa/io-topbar-file-mobile.png')
checks['mobile/file-menu-exposes-all-actions'] = mobileFileUi.labels.length === 6
  && mobileFileUi.labels.some((label) => label?.includes('新建空白工程'))
  && mobileFileUi.labels.some((label) => label?.includes('导入工程文件'))
  && mobileFileUi.labels.some((label) => label?.includes('完整程序 PNG'))
  && mobileFileUi.labels.some((label) => label?.includes('纯梯形图 PNG'))
checks['mobile/topbar-and-menu-fit'] = mobileFileUi.controlsInsideViewport
  && !mobileFileUi.pageOverflow
  && !!mobileFileUi.menu
  && mobileFileUi.menu.left >= 0
  && mobileFileUi.menu.right <= 390
  && mobileFileUi.menu.top >= 0
  && mobileFileUi.menu.bottom <= 844
details['mobile/file-ui'] = mobileFileUi
await evaluate(`(() => {
  const item = [...document.querySelectorAll('.wb-file-compact-menu button')]
    .find((button) => button.textContent?.includes('导入工程文件'))
  item?.click()
})()`)
await sleep(220)
const mobileDialog = await evaluate(`(() => {
  const node = document.querySelector('.project-import-dialog')
  if (!node) return { open: false }
  const rect = node.getBoundingClientRect()
  return {
    open: true,
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    overflowX: node.scrollWidth > node.clientWidth + 1,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})()`)
await screenshot('docs/qa/io-import-mobile.png')
checks['mobile/import-dialog-fits'] = mobileDialog.open
  && mobileDialog.left >= 0
  && mobileDialog.right <= 390
  && mobileDialog.top >= 0
  && mobileDialog.bottom <= 844
  && !mobileDialog.overflowX
  && !mobileDialog.pageOverflow
details['mobile/import-dialog'] = mobileDialog

socket.close()
console.log(JSON.stringify({ checks, details, before, errors }, null, 2))
if (Object.values(checks).some((value) => !value) || errors.length > 0) process.exitCode = 1
