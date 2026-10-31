/**
 * 真实浏览器验收分享链接：弹窗、取消、确认导入、坏链接报错。
 *
 * 用法：先 `npm run preview`，再开一个带调试端口的浏览器
 * （例如 msedge --headless=new --remote-debugging-port=9444），然后 `npm run qa:share`。
 */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildShareHash } from './share-link.mjs'
import {
  closeQaPage,
  connectToPage,
  createQaPage,
  DEFAULT_QA_APP_URL,
  DEFAULT_QA_CDP,
  isBrowserExtensionNoise,
} from './qa-cdp.mjs'

const CDP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const BASE = (process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL).replace(/#.*$/, '')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const examplePath = process.env.LADDERLAB_QA_EXAMPLE ?? 'examples/running-light.ladderlab.json'
const program = JSON.parse(readFileSync(resolve(examplePath), 'utf8'))
const shareHash = buildShareHash(program)
const shareUrl = BASE + shareHash

const failures = []
const steps = []
const check = (ok, label, detail) => {
  if (!ok) failures.push(label + (detail === undefined ? '' : ` → ${JSON.stringify(detail)}`))
}

const target = await createQaPage(CDP, 'about:blank')
const client = await connectToPage(target)
const { send } = client
const errors = []
client.onEvent((message) => {
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    if (!isBrowserExtensionNoise(details)) {
      errors.push(details?.exception?.description ?? 'exception')
    }
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const text = message.params.args?.map((arg) => arg.value ?? arg.description).join(' ')
    if (!isBrowserExtensionNoise(text)) errors.push(text)
  }
})

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}

async function waitFor(expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(120)
  }
  throw new Error(`等待超时：${label}`)
}

const dialogState = `(() => {
  const dialog = document.querySelector('.confirm-dialog')
  if (!dialog) return null
  return {
    title: document.querySelector('#confirm-title')?.textContent?.trim() ?? '',
    description: document.querySelector('#confirm-desc')?.textContent?.trim() ?? '',
    confirm: document.querySelector('.confirm-ok')?.textContent?.trim() ?? '',
    cancel: document.querySelector('.confirm-cancel')?.textContent?.trim() ?? '',
  }
})()`

const appState = `(() => ({
  ready: !!document.querySelector('.wb-topbar'),
  projectName: document.querySelector('#project-name')?.value ?? null,
  hash: location.hash,
  toast: document.querySelector('.toast-message')?.textContent?.trim() ?? null,
}))()`

try {
  // 0. 干净起步：清掉上一次验收留下的自动保存，保证重跑结果一致。
  await send('Page.navigate', { url: BASE })
  await waitFor('!!document.querySelector(".wb-topbar")', '页面加载')
  await evaluate(`localStorage.clear(); sessionStorage.clear()`)
  await send('Page.navigate', { url: 'about:blank' })
  await send('Page.navigate', { url: BASE })
  await waitFor('!!document.querySelector(".wb-topbar")', '清空后重新加载')
  const beforeName = await evaluate(`document.querySelector('#project-name')?.value ?? null`)
  check(beforeName !== program.name, '起始工程不应已经是分享的那份', beforeName)

  // 1. 带分享链接打开：确认前保留载荷，刷新时还能再次看到同一个确认窗。
  await send('Page.navigate', { url: 'about:blank' })
  await send('Page.navigate', { url: shareUrl })
  await waitFor('!!document.querySelector(".wb-topbar")', '页面加载')
  await waitFor('!!document.querySelector(".confirm-dialog")', '分享确认弹窗')
  const first = await evaluate(dialogState)
  const afterOpen = await evaluate(appState)
  check(first.title.includes(program.name), '弹窗标题应提到工程名', first.title)
  check(first.description.includes('段梯形图'), '弹窗应说明程序段数量', first.description)
  check(first.confirm === '导入' && first.cancel === '先不导入', '按钮文案', first)
  check(afterOpen.hash === shareHash, '确认前应保留地址里的载荷', afterOpen.hash)
  steps.push({ step: '打开分享链接', dialog: first.title, hash: afterOpen.hash })

  // 需要截图时（LADDERLAB_QA_SHOT=文件路径）顺手存一张，方便贴到说明或文档里。
  if (process.env.LADDERLAB_QA_SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(resolve(process.env.LADDERLAB_QA_SHOT), Buffer.from(shot.data, 'base64'))
  }

  // 2. 取消：什么都不能变。
  await evaluate(`document.querySelector('.confirm-cancel').click()`)
  await waitFor('!document.querySelector(".confirm-dialog")', '弹窗关闭')
  const afterCancel = await evaluate(appState)
  check(afterCancel.projectName === beforeName, '取消后工程应保持原样', { beforeName, after: afterCancel.projectName })
  check(afterCancel.hash === '', '取消后才清掉地址里的载荷', afterCancel.hash)
  steps.push({ step: '点击先不导入', projectName: afterCancel.projectName })

  // 3. 再次打开并确认：工程真的进来了。
  await send('Page.navigate', { url: shareUrl })
  await waitFor('!!document.querySelector(".confirm-dialog")', '第二次弹窗')
  await evaluate(`document.querySelector('.confirm-ok').click()`)
  await waitFor('!document.querySelector(".confirm-dialog")', '导入后弹窗关闭')
  await waitFor(`document.querySelector('#project-name')?.value === ${JSON.stringify(program.name)}`, '工程名切换')
  const afterImport = await evaluate(appState)
  check(afterImport.projectName === program.name, '确认后应导入分享的工程', afterImport.projectName)
  check((afterImport.toast ?? '').includes(program.name), '导入后应有提示', afterImport.toast)
  check(afterImport.hash === '', '导入完成后应清掉地址里的载荷', afterImport.hash)
  steps.push({ step: '点击导入', projectName: afterImport.projectName, toast: afterImport.toast })

  // 导入完成后的成品画面（LADDERLAB_QA_SHOT_IMPORTED=文件路径），用来做交付截图。
  if (process.env.LADDERLAB_QA_SHOT_IMPORTED) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(resolve(process.env.LADDERLAB_QA_SHOT_IMPORTED), Buffer.from(shot.data, 'base64'))
  }

  // 4. 坏链接：报错，不弹窗，不动现有工程。
  await send('Page.navigate', { url: `${BASE}#p=1.这不是base64` })
  await waitFor('!!document.querySelector(".wb-topbar")', '坏链接页面加载')
  await waitFor('!!document.querySelector(".toast")', '坏链接报错提示')
  const bad = await evaluate(appState)
  const badDialog = await evaluate(dialogState)
  check(badDialog === null, '坏链接不应弹出导入窗', badDialog)
  check(bad.projectName === program.name, '坏链接不应改动当前工程', bad.projectName)
  check(typeof bad.toast === 'string' && bad.toast.length > 0, '坏链接应有提示', bad.toast)
  check(String(bad.hash).startsWith('#p=1.'), '坏链接应保留载荷，便于用户重新复制或修正', bad.hash)
  steps.push({ step: '打开损坏的链接', projectName: bad.projectName, toast: bad.toast })

  // 5. 反向：导出菜单里的“复制分享链接”要能拿到当前工程的地址。
  // 无头浏览器读不到系统剪贴板，所以在 writeText 上装个探针把入参接住；
  // 链接本身仍然靠后面打开它来验证，不是只看字符串。
  const probed = await evaluate(`(() => {
    window.__qaCopied = null
    const clipboard = navigator.clipboard
    if (!clipboard?.writeText) return false
    const original = clipboard.writeText.bind(clipboard)
    clipboard.writeText = async (text) => {
      window.__qaCopied = text
      try { await original(text) } catch { /* 无头环境写不进系统剪贴板不影响验收 */ }
    }
    return true
  })()`)
  check(probed, '浏览器应提供剪贴板接口', probed)
  await evaluate(`document.querySelector('.wb-export-trigger')?.click()`)
  await waitFor('!!document.querySelector("#topbar-export-menu")', '导出菜单展开')
  const shareItem = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('#topbar-export-menu [role="menuitem"]'))
    const target = items.find((item) => (item.textContent ?? '').includes('复制分享链接'))
    if (!target) return null
    target.click()
    return (target.textContent ?? '').trim()
  })()`)
  check(shareItem !== null, '导出菜单里应有「复制分享链接」', shareItem)
  await waitFor(
    `(document.querySelector('.toast-message')?.textContent ?? '').includes('已复制')`,
    '复制成功提示',
  )
  const copied = await evaluate('window.__qaCopied')
  check(typeof copied === 'string' && copied.startsWith(`${BASE}#p=1.`), '剪贴板里应是一条分享链接', copied?.slice(0, 64))

  if (typeof copied === 'string' && copied.startsWith(BASE)) {
    await send('Page.navigate', { url: copied })
    await waitFor('!!document.querySelector(".confirm-dialog")', '复制出的链接弹出导入窗')
    const copiedDialog = await evaluate(dialogState)
    check(copiedDialog.title.includes(program.name), '复制出的链接应指向当前工程', copiedDialog.title)
    steps.push({
      step: '导出菜单复制分享链接',
      linkLength: copied.length,
      dialog: copiedDialog.title,
    })
  }

  check(errors.length === 0, '控制台不应有异常', errors.slice(0, 3))
} finally {
  await closeQaPage(CDP, target.id)
  client.close()
}

const report = {
  ok: failures.length === 0,
  shareUrlLength: shareUrl.length,
  steps,
  failures,
  consoleErrors: errors.slice(0, 5),
}
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(1)
