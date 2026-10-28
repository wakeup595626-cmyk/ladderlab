/**
 * 无障碍与焦点管理验收：axe-core + 真实键盘/焦点行为。
 *
 * 用法：先 `npm run preview`（默认 4173），并启动专用于验收的 Chromium（9444），
 * 然后 `npm run qa:accessibility`。脚本按 320/360/390/720/1280 五个宽度跑，
 * 覆盖编辑器、移动变量面板、项目抽屉、顶栏菜单与按键焦点归还。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_QA_APP_URL, DEFAULT_QA_CDP, selectExactPage } from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
const target = selectExactPage(targets, APP_URL, CDP_HTTP)

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
    consoleErrors.push(details?.exception?.description ?? details?.text ?? 'exception')
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '))
  }
})

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
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

async function waitForApp(timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = await evaluate(
      `document.readyState !== 'loading' && !!document.querySelector('.wb-topbar')`,
    ).catch(() => false)
    if (ready) return true
    await sleep(200)
  }
  throw new Error(`等待页面就绪超时：${APP_URL}`)
}

async function reload() {
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(280)
  await send('Storage.clearDataForOrigin', {
    origin: new URL(APP_URL).origin,
    storageTypes: 'local_storage',
  })
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  await sleep(420)
}

async function pressEscape() {
  const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(320)
}

async function pressEnter() {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(320)
}

async function pressTab(backwards = false) {
  const modifiers = backwards ? 8 : 0
  const base = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(90)
}

/** 真实鼠标点击：会像用户一样把焦点落在按钮上，再触发 click。 */
async function clickElement(selector, text = null) {
  const point = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((item) => ${text === null ? 'true' : `item.textContent?.trim() === ${JSON.stringify(text)}`});
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`)
  if (!point) throw new Error(`点击目标不存在：${selector}`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await sleep(420)
}

const checks = {}
const details = {}
const check = (name, value, note) => {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
}

const axeSource = await readFile(resolve('node_modules/axe-core/axe.min.js'), 'utf8')

/** 在页面里跑 axe；只把结论带回 Node，避免整棵 DOM 回传。 */
async function runAxe(label, contextSelector = null) {
  await evaluate(axeSource)
  const result = await evaluate(`(async () => {
    const context = ${contextSelector ? `document.querySelector(${JSON.stringify(contextSelector)})` : 'document'};
    if (!context) return { missing: true, violations: [] };
    const report = await window.axe.run(context, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return {
      violations: report.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        help: item.help,
        nodes: item.nodes.slice(0, 4).map((node) => ({
          target: node.target,
          summary: String(node.failureSummary || '').slice(0, 300),
        })),
      })),
      passes: report.passes.length,
    };
  })()`)
  const violations = result.missing ? [{ id: 'missing-context', impact: 'critical', help: 'context not found', nodes: [] }] : result.violations
  const serious = violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')
  check(`axe/${label}/clean`, violations.length === 0, {
    violations: violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes })),
    passes: result.passes,
  })
  check(`axe/${label}/no-serious`, serious.length === 0, serious.map((item) => item.id))
}

/** 计算实际文本对比度：向上找第一个不透明背景，再套 WCAG 相对亮度公式。 */
const contrastProbe = `(() => {
  const parse = (value) => {
    const match = String(value).match(/rgba?\\(([^)]+)\\)/);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number.parseFloat(part));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const clock = document.querySelector('.run-clock');
  if (!clock) return { found: false };
  const style = getComputedStyle(clock);
  const fg = parse(style.color);
  let node = clock;
  let bg = null;
  while (node && node !== document.documentElement) {
    const candidate = parse(getComputedStyle(node).backgroundColor);
    if (candidate && candidate.a > 0.99) { bg = candidate; break; }
    node = node.parentElement;
  }
  if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
  if (!fg) return { found: true, error: '无法解析文字颜色' };
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return { found: true, ratio: Math.round(ratio * 100) / 100, fontSize: style.fontSize, color: style.color, background: style.backgroundColor };
})()`

let viewports = [
  { width: 1280, height: 900, mobile: false },
  { width: 720, height: 900, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 360, height: 780, mobile: true },
  { width: 320, height: 720, mobile: true },
]
if (process.env.LADDERLAB_WIDTH) {
  viewports = viewports.filter((item) => String(item.width) === process.env.LADDERLAB_WIDTH)
}

for (const viewport of viewports) {
  const label = `w${viewport.width}`
  await setViewport(viewport.width, viewport.height, viewport.mobile)
  await reload()

  await runAxe(`${label}/editor`)

  const layout = await evaluate(`(() => {
    const doc = document.documentElement;
    const topbar = document.querySelector('.wb-topbar');
    const name = document.querySelector('#project-name');
    return {
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      topbarHeight: topbar ? Math.round(topbar.getBoundingClientRect().height) : 0,
      nameWidth: name ? Math.round(name.getBoundingClientRect().width) : 0,
      viewport: [innerWidth, innerHeight],
    };
  })()`)
  check(`${label}/no-horizontal-overflow`, !layout.horizontalOverflow, layout)
  if (viewport.width <= 520) {
    check(`${label}/name-readable`, layout.nameWidth >= 110, layout.nameWidth)
  }

  if (viewport.width >= 1025) {
    // 导入弹层包含折叠区。真实 Tab 与 Shift+Tab 都必须被限制在弹层内，
    // 不能落入背后编辑器，也不能进入折叠区中不可见的控件。
    await clickElement('.wb-file-button[aria-label="导入工程文件"]')
    const importOpened = await evaluate(`(() => ({
      dialog: Boolean(document.querySelector('.project-import-dialog')),
      activeInside: Boolean(document.activeElement?.closest('.project-import-dialog')),
      activeText: document.activeElement?.textContent?.trim().slice(0, 30) ?? '',
    }))()`)
    const focusTrace = []
    for (let index = 0; index < 6; index += 1) {
      await pressTab(false)
      focusTrace.push(await evaluate(`(() => ({
        inside: Boolean(document.activeElement?.closest('.project-import-dialog')),
        tag: document.activeElement?.tagName ?? null,
        text: document.activeElement?.textContent?.trim().slice(0, 30) ?? '',
      }))()`))
    }
    for (let index = 0; index < 4; index += 1) {
      await pressTab(true)
      focusTrace.push(await evaluate(`(() => ({
        inside: Boolean(document.activeElement?.closest('.project-import-dialog')),
        tag: document.activeElement?.tagName ?? null,
        text: document.activeElement?.textContent?.trim().slice(0, 30) ?? '',
      }))()`))
    }
    check(`${label}/import-dialog-initial-focus`, importOpened.dialog && importOpened.activeInside, importOpened)
    check(
      `${label}/import-dialog-focus-trap`,
      focusTrace.every((item) => item.inside),
      focusTrace,
    )
    await runAxe(`${label}/import-dialog`, '.project-import-dialog')
    await pressEscape()
    const importClosed = await evaluate(`(() => ({
      closed: !document.querySelector('.project-import-dialog'),
      focusReturned: document.activeElement?.getAttribute('aria-label') === '导入工程文件',
    }))()`)
    check(`${label}/import-dialog-esc-focus`, importClosed.closed && importClosed.focusReturned, importClosed)

    const clickResult = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.wb-doc-action')];
      const target = buttons.find((button) => button.textContent?.trim() === '变量表');
      if (target) target.click();
      return { labels: buttons.map((button) => button.textContent?.trim()), clicked: Boolean(target) };
    })()`)
    if (process.env.LADDERLAB_DEBUG) console.log('debug doc click', clickResult)
    await sleep(420)
    const panelSemantics = await evaluate(`(() => {
      const panel = document.querySelector('#wb-context-panel');
      return {
        exists: !!panel,
        role: panel?.getAttribute('role') ?? null,
        ariaModal: panel?.getAttribute('aria-modal') ?? null,
      };
    })()`)
    check(`${label}/docked-panel-not-dialog`, panelSemantics.exists
      && panelSemantics.role === null && panelSemantics.ariaModal === null, panelSemantics)

    const rungHeader = await evaluate(`(() => {
      const header = document.querySelector('.ll-rung-header');
      if (!header) return { found: false };
      return {
        found: true,
        role: header.getAttribute('role'),
        ariaSelected: header.getAttribute('aria-selected'),
        ariaPressed: header.getAttribute('aria-pressed'),
      };
    })()`)
    check(`${label}/rung-header-semantics`, rungHeader.found
      && rungHeader.role === null && rungHeader.ariaSelected === null && rungHeader.ariaPressed === null, rungHeader)

    // 顶栏运行后测量扫描时钟的真实颜色对比度。
    await evaluate(`document.querySelector('.wb-run-toggle')?.click()`)
    await sleep(700)
    const contrast = await evaluate(contrastProbe)
    check(`${label}/run-clock-contrast`, contrast.found && contrast.ratio >= 4.5, contrast)
    await evaluate(`document.querySelector('.wb-run-toggle')?.click()`)
    await sleep(200)

    // 桌面参数框不是模态框，关闭时必须把焦点还给触发它的画布元件。
    // 用启保停示例里的并联选择层验证 SVG 节点也能正确恢复键盘焦点。
    const demoStarted = await evaluate(`(() => {
      const button = document.querySelector('.wb-coach-demo');
      if (!button) return false;
      button.click();
      return true;
    })()`)
    await sleep(800)
    await pressEscape()
    const parallelFocused = await evaluate(`(() => {
      const target = document.querySelector('.ll-parallel-select');
      if (!target) return { found: false, focused: false };
      target.focus({ preventScroll: true });
      return { found: true, focused: document.activeElement === target };
    })()`)
    check(`${label}/parallel-focus-ready`, demoStarted && parallelFocused.found && parallelFocused.focused, parallelFocused)
    await pressEnter()
    const quickEditorOpened = await evaluate(`(() => ({
      open: Boolean(document.querySelector('.qe-panel')),
      role: document.querySelector('.qe-panel')?.getAttribute('role') ?? null,
    }))()`)
    check(`${label}/quick-editor-keyboard-open`, quickEditorOpened.open && quickEditorOpened.role === 'group', quickEditorOpened)
    await pressEscape()
    const quickEditorClosed = await evaluate(`(() => ({
      closed: !document.querySelector('.qe-panel'),
      focusReturned: document.activeElement?.classList.contains('ll-parallel-select') ?? false,
      activeClass: document.activeElement?.getAttribute('class') ?? '',
    }))()`)
    check(
      `${label}/quick-editor-esc-focus`,
      quickEditorClosed.closed && quickEditorClosed.focusReturned,
      quickEditorClosed,
    )
  }

  if (viewport.width <= 720) {
    // 移动变量面板
    await clickElement('.wb-tabbar .mobile-tab-action', '变量')
    await sleep(220)
    const panelOpen = await evaluate(`(() => {
      const panel = document.querySelector('#wb-context-panel');
      return { exists: !!panel, role: panel?.getAttribute('role') ?? null, modal: panel?.getAttribute('aria-modal') ?? null };
    })()`)
    check(`${label}/mobile-panel-dialog`, panelOpen.exists && panelOpen.role === 'dialog' && panelOpen.modal === 'true', panelOpen)
    await runAxe(`${label}/mobile-panel`, '#wb-context-panel')
    await pressEscape()
    const focusBack = await evaluate(`(() => {
      const active = document.activeElement;
      return { text: active?.textContent?.trim().slice(0, 20) ?? '', cls: active?.className ?? '' };
    })()`)
    check(`${label}/mobile-panel-esc-focus`, String(focusBack.text).includes('变量'), focusBack)

    // 项目抽屉：手机上没有单独的“项目”按钮，入口在“文件”菜单；
    // 初始焦点必须在关闭按钮，Esc 关闭并归还到“文件”。
    await clickElement('.wb-file-compact')
    await sleep(160)
    const drawerEntry = await evaluate(`(() => {
      const item = [...document.querySelectorAll('#topbar-file-menu [role="menuitem"]')]
        .find((button) => button.textContent?.includes('项目、变量表'));
      if (item) item.click();
      return Boolean(item);
    })()`)
    check(`${label}/drawer-entry`, drawerEntry)
    await sleep(480)
    const drawer = await evaluate(`(() => {
      const dialog = document.querySelector('.wb-project-drawer');
      return {
        exists: !!dialog,
        role: dialog?.getAttribute('role') ?? null,
        modal: dialog?.getAttribute('aria-modal') ?? null,
        focusClose: document.activeElement?.classList.contains('wb-drawer-close') ?? false,
      };
    })()`)
    check(`${label}/drawer-dialog`, drawer.exists && drawer.role === 'dialog' && drawer.modal === 'true', drawer)
    check(`${label}/drawer-initial-focus`, drawer.focusClose, drawer)
    await runAxe(`${label}/drawer`, '.wb-project-drawer')
    await pressEscape()
    const drawerGone = await evaluate(`(() => ({
      closed: !document.querySelector('.wb-project-drawer'),
      focusProject: document.activeElement?.classList.contains('wb-file-compact') ?? false,
    }))()`)
    check(`${label}/drawer-esc-closes`, drawerGone.closed, drawerGone)
    check(`${label}/drawer-esc-focus`, drawerGone.focusProject, drawerGone)
  }

  // 菜单必须完整落入视口，否则手机上点不到最后一项。
  const openMenu = async (selector, menuSelector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`)
    await sleep(320)
    const bounds = await evaluate(`(() => {
      const menu = document.querySelector(${JSON.stringify(menuSelector)});
      if (!menu) return { exists: false };
      const rect = menu.getBoundingClientRect();
      return {
        exists: true,
        left: Math.round(rect.left), top: Math.round(rect.top),
        right: Math.round(rect.right), bottom: Math.round(rect.bottom),
        inViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        items: menu.querySelectorAll('[role^="menuitem"]').length,
      };
    })()`)
    check(`${label}/${menuSelector.includes('file') ? 'file' : 'more'}-menu`, bounds.exists && bounds.inViewport && bounds.items > 0, bounds)
    await pressEscape()
  }

  if (viewport.width <= 520) await openMenu('.wb-file-compact', '#topbar-file-menu')
  else await openMenu('.wb-export-trigger', '#topbar-export-menu')
  await openMenu('.wb-more > button', '#topbar-more-menu')
}

check('runtime/no-console-errors', consoleErrors.length === 0, consoleErrors.slice(0, 5))

const failed = Object.entries(checks).filter(([, value]) => !value)
console.log(JSON.stringify({ passed: Object.keys(checks).length - failed.length, failed: failed.map(([name]) => name), checks, details }, null, 2))
if (failed.length > 0) {
  console.error(`\n无障碍验收失败：${failed.map(([name]) => name).join(', ')}`)
  process.exitCode = 1
} else {
  console.log('\n无障碍验收全部通过。')
}

socket.close()
