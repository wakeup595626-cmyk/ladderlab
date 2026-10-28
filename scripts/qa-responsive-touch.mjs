/**
 * 响应式与真实触控验收。
 *
 * 用法：先 `npm run preview`（默认 4173），并启动专用 QA Chromium（9444），
 * 然后 `npm run qa:touch`。脚本覆盖 320/360/390/480/520/720/1280 七个宽度，
 * 用 CDP 的真实 Input.dispatchTouchEvent 点选导线和插入点，而不是直接调用 click。
 */
import {
  closeQaPage,
  connectToPage,
  createQaPage,
  DEFAULT_QA_APP_URL,
  DEFAULT_QA_CDP,
} from './qa-cdp.mjs'

const CDP_HTTP = process.env.LADDERLAB_CDP ?? DEFAULT_QA_CDP
const APP_URL = process.env.LADDERLAB_URL ?? DEFAULT_QA_APP_URL
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// 自己创建标签页，避免和其他审查任务争用同一个页面：外部关闭标签页会让
// 本脚本的 top-level await 永远不返回，最终表现为 aborted。
const target = await createQaPage(CDP_HTTP)
const client = await connectToPage(target)
const { send } = client
const consoleErrors = []

client.onEvent((message) => {
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
  const origin = new URL(APP_URL).origin
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(280)
  await send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'local_storage',
  })
  // sessionStorage 不会随 localStorage 一起清掉；不处理它会把上一个用例的
  // 工程、运行状态和属性面板带进下一位宽度的验收，造成假失败或假通过。
  await send('DOMStorage.enable').catch(() => {})
  await send('DOMStorage.clear', {
    storageId: { securityOrigin: origin, isLocalStorage: false },
  }).catch(() => {})
  await send('DOMStorage.clear', {
    storageId: { securityOrigin: origin, isLocalStorage: true },
  }).catch(() => {})
  await send('Page.navigate', { url: APP_URL })
  await waitForApp()
  await sleep(420)
}

async function loadDemo() {
  const loaded = await evaluate(`(() => {
    const button = document.querySelector('.wb-coach-demo')
    if (!button) return false
    button.click()
    return true
  })()`)
  await sleep(800)
  // “载入启保停示例”会把变量表一起打开（正是新手需要的下一步提示）。
  // 手机上它是整屏对话框，会盖住顶栏和图纸；触控验收先像用户一样关掉它。
  await evaluate(`document.querySelector('.wb-context-scrim')?.click()`)
  await sleep(320)
  return loaded
}

/** 真实触摸：触摸开始与结束之间不做移动，浏览器会像用户轻点一样补发 click。 */
async function tap(x, y) {
  const point = { x, y, radiusX: 5, radiusY: 5, force: 1, id: 1 }
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await sleep(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(460)
}

const checks = {}
const details = {}
const check = (name, value, note) => {
  checks[name] = Boolean(value)
  if (note !== undefined) details[name] = note
}

let viewports = [
  { width: 1280, height: 900, mobile: false },
  { width: 720, height: 900, mobile: true },
  { width: 520, height: 900, mobile: true },
  { width: 480, height: 900, mobile: true },
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
  const demoLoaded = await loadDemo()
  check(`${label}/demo-loads`, demoLoaded)

  // 1) 顶栏：所有可见操作都必须完整落在顶栏和视口内，并被真实命中。
  // 不能先过滤视口外元素：那会把“按钮被挤出屏幕”误判成通过。
  const topbar = await evaluate(`(() => {
    const doc = document.documentElement;
    const bar = document.querySelector('.wb-topbar');
    const name = document.querySelector('#project-name');
    const barRect = bar?.getBoundingClientRect();
    const actions = [...document.querySelectorAll('.wb-topbar button, .wb-topbar summary, .wb-topbar input')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.visibility !== 'hidden' && style.display !== 'none';
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          tag: element.tagName,
          label: (element.getAttribute('aria-label') || element.textContent || element.value || '').trim().slice(0, 32),
          cls: typeof element.className === 'string' ? element.className : '',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          inViewport: rect.left >= -1 && rect.top >= -1
            && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
          insideBar: !!barRect && rect.left >= barRect.left - 1 && rect.top >= barRect.top - 1
            && rect.right <= barRect.right + 1 && rect.bottom <= barRect.bottom + 1,
          clickable: !!hit && (hit === element || element.contains(hit)),
        };
      });
    const moreButton = document.querySelector('.wb-more .icon-button');
    const moreRect = moreButton?.getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      barOverflow: !!bar && bar.scrollWidth > bar.clientWidth + 1,
      nameWidth: name ? Math.round(name.getBoundingClientRect().width) : 0,
      barHeight: barRect ? Math.round(barRect.height) : 0,
      actions,
      unclickable: actions.filter((item) => !item.clickable),
      outside: actions.filter((item) => !item.inViewport || !item.insideBar),
      more: moreRect ? {
        width: Math.round(moreRect.width * 10) / 10,
        height: Math.round(moreRect.height * 10) / 10,
      } : null,
    };
  })()`)
  check(`${label}/no-horizontal-overflow`, !topbar.horizontalOverflow, topbar)
  check(`${label}/topbar-no-internal-overflow`, !topbar.barOverflow, topbar)
  check(`${label}/topbar-hit-targets`, topbar.actions.length >= 6
    && topbar.unclickable.length === 0 && topbar.outside.length === 0, topbar)
  check(`${label}/topbar-height`, topbar.barHeight >= 44, topbar.barHeight)
  if (viewport.width <= 520) check(`${label}/project-name-readable`, topbar.nameWidth >= 120, topbar.nameWidth)
  if (viewport.width <= 720) check(`${label}/more-touch-44`, !!topbar.more
    && topbar.more.width >= 43.5 && topbar.more.height >= 43.5, topbar.more)

  // 桌面宽度也检查收藏条：星标和横向滚动按钮同样是独立操作，不能靠
  // 卡片整体高度“看起来够大”掩盖实际 25×36 的小命中区。
  if (!viewport.mobile) {
    const instructionTargets = await evaluate(`(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const measure = (selector) => [...document.querySelectorAll(selector)]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: typeof element.className === 'string' ? element.className : '',
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
          };
        });
      return {
        stars: measure('.wb-instruction-star'),
        scroll: measure('.wb-instruction-scroll'),
        toolsHeight: document.querySelector('.wb-instruction-tools')?.getBoundingClientRect().height ?? 0,
      };
    })()`)
    check(`${label}/favorite-stars-44`, instructionTargets.stars.length >= 1
      && instructionTargets.stars.every((item) => item.width >= 43.5 && item.height >= 43.5),
    instructionTargets)
    check(`${label}/favorite-scroll-44`, instructionTargets.scroll.length === 0
      || instructionTargets.scroll.every((item) => item.width >= 43.5 && item.height >= 43.5),
    instructionTargets)
  }

  if (!viewport.mobile) continue

  // 2) 线路热区：手机上至少要 44×44 CSS 像素。
  const hitArea = await evaluate(`(() => {
    const rung = document.querySelector('.ll-rung')
    const slot = rung?.querySelector('.ll-slot[data-chain=""][data-index="1"]')
    const hit = slot?.querySelector('.ll-slot-wide-hit')
    if (!hit) return { found: false }
    const rect = hit.getBoundingClientRect()
    const wire = slot.querySelector('.ll-slot-wire')
    return {
      found: true,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
      pointerEvents: getComputedStyle(wire).pointerEvents,
      slotWidth: Math.round(slot.getBoundingClientRect().width * 10) / 10,
    }
  })()`)
  check(`${label}/wire-hit-44`, hitArea.found && hitArea.width >= 43.5 && hitArea.height >= 43.5, hitArea)

  const rungTools = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.ll-rung-tools .ll-tool')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: (element.textContent || '').trim().slice(0, 24),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      });
    return { items };
  })()`)
  check(`${label}/rung-tools-44`, rungTools.items.length >= 1
    && rungTools.items.every((item) => item.height >= 43.5), rungTools)

  // 3) 点导线只选线，不插入节点、不弹菜单。
  await evaluate(`document.querySelector('.ll-rung .ll-slot[data-chain=""][data-index="1"] .ll-slot-wire')
    ?.scrollIntoView({ block: 'center', inline: 'center' })`)
  await sleep(380)
  const beforeTap = await evaluate(`({ nodes: document.querySelectorAll('.ll-node[data-node-id]').length })`)
  const wirePoint = await evaluate(`(() => {
    const slot = document.querySelector('.ll-rung .ll-slot[data-chain=""][data-index="1"]')
    const hit = slot?.querySelector('.ll-slot-wide-hit')
    if (!hit) return null
    const rect = hit.getBoundingClientRect()
    const x = rect.left + 6
    const y = rect.top + rect.height / 2
    const hitElement = document.elementFromPoint(x, y)
    return {
      x, y,
      inViewport: x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight,
      topTag: hitElement?.tagName ?? null,
      topClass: typeof hitElement?.className === 'string' ? hitElement.className : '',
      insideWire: !!hitElement?.closest('.ll-slot-wire'),
    }
  })()`)
  check(`${label}/wire-point-visible`, wirePoint?.inViewport && wirePoint?.insideWire, wirePoint)
  if (wirePoint?.inViewport && wirePoint?.insideWire) await tap(wirePoint.x, wirePoint.y)
  const afterWireTap = await evaluate(`(() => ({
    nodes: document.querySelectorAll('.ll-node[data-node-id]').length,
    wireSelected: document.querySelectorAll('.ll-slot.is-wire-selected').length,
    selectedIndex: document.querySelector('.ll-slot.is-wire-selected')?.dataset.index ?? null,
    chip: document.querySelector('.ll-selected-chip')?.textContent?.trim() ?? null,
    menuOpen: !!document.querySelector('.ll-slot-menu[role="menu"]'),
  }))()`)
  check(`${label}/touch-wire-selects-only`, afterWireTap.nodes === beforeTap.nodes
    && afterWireTap.wireSelected === 1
    && String(afterWireTap.chip).includes('已选线路')
    && !afterWireTap.menuOpen, afterWireTap)

  // 4) 另一个插入点的 44px 热区：触摸左缘应只选中该线路，不落到 + 上。
  await reload()
  await loadDemo()
  await evaluate(`document.querySelector('.ll-rung .ll-slot[data-chain=""][data-index="2"] .ll-slot-wire')
    ?.scrollIntoView({ block: 'center', inline: 'center' })`)
  await sleep(380)
  const nearestPoint = await evaluate(`(() => {
    const slots = [...document.querySelectorAll('.ll-rung .ll-slot[data-chain=""]')]
    const first = slots.find((slot) => slot.dataset.index === '1')
    const second = slots.find((slot) => slot.dataset.index === '2')
    if (!first || !second) return null
    const firstHit = first.querySelector('.ll-slot-wide-hit').getBoundingClientRect()
    const secondHit = second.querySelector('.ll-slot-wide-hit').getBoundingClientRect()
    const secondCenter = secondHit.left + secondHit.width / 2
    const x = secondHit.left + Math.min(8, secondHit.width / 4)
    const y = secondHit.top + secondHit.height / 2
    const hitElement = document.elementFromPoint(x, y)
    return {
      x, y,
      firstRect: [firstHit.left, firstHit.top, firstHit.right, firstHit.bottom],
      secondRect: [secondHit.left, secondHit.top, secondHit.right, secondHit.bottom],
      firstCenter: Math.round((firstHit.left + firstHit.width / 2) * 10) / 10,
      secondCenter: Math.round(secondCenter * 10) / 10,
      centerGap: Math.round((secondCenter - (firstHit.left + firstHit.width / 2)) * 10) / 10,
      hitClass: typeof hitElement?.className === 'string' ? hitElement.className : '',
      hitLabel: hitElement?.closest('.ll-slot-wire, .ll-slot-plus')?.getAttribute('aria-label') ?? null,
      hitSlotIndex: hitElement?.closest('.ll-slot')?.dataset.index ?? null,
      insideSlot: !!hitElement?.closest('.ll-slot'),
      insideWire: !!hitElement?.closest('.ll-slot-wire'),
    }
  })()`)
  check(`${label}/second-slot-point-valid`, !!nearestPoint
    && nearestPoint.insideWire && nearestPoint.centerGap > 0, nearestPoint)
  if (nearestPoint?.insideWire) await tap(nearestPoint.x, nearestPoint.y)
  const nearestResult = await evaluate(`(() => ({
    selectedIndex: document.querySelector('.ll-slot.is-wire-selected')?.dataset.index ?? null,
    wireSelected: document.querySelectorAll('.ll-slot.is-wire-selected').length,
    menuOpen: !!document.querySelector('.ll-slot-menu[role="menu"]'),
  }))()`)
  check(`${label}/touch-second-slot`, nearestResult.wireSelected === 1
    && nearestResult.selectedIndex === '2' && !nearestResult.menuOpen, nearestResult)

  // 5) 触摸 +：先点线选中槽位，再点同槽位显影的 44px +。
  if ([
    390, 480, 520, 720,
  ].includes(viewport.width)) {
    // 上一步已经用真实触摸选中了 2 号槽；所有粗指针宽度都只在选中后
    // 显影同槽位的 +，顺带验证“先选线、再插入”的触屏路径。
    const selectedIndex = await evaluate(
      `document.querySelector('.ll-rung .ll-slot.is-wire-selected')?.dataset.index ?? null`,
    )
    check(`${label}/plus-prerequisite`, selectedIndex === '2')
    const plusPoint = await evaluate(`(() => {
      const slot = document.querySelector('.ll-rung .ll-slot.is-wire-selected')
        ?? document.querySelector('.ll-rung .ll-slot[data-chain=""][data-index="2"]')
      const plus = slot?.querySelector('.ll-slot-plus')
      if (!plus) return null
      const rect = plus.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const hitElement = document.elementFromPoint(x, y)
      return {
        x, y,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        opacity: getComputedStyle(plus).opacity,
        pointerEvents: getComputedStyle(plus).pointerEvents,
        insidePlus: !!hitElement?.closest('.ll-slot-plus'),
        topClass: typeof hitElement?.className === 'string' ? hitElement.className : '',
      }
    })()`)
    check(`${label}/plus-hit-target`, plusPoint?.insidePlus && plusPoint.width >= 43.5 && plusPoint.height >= 43.5, plusPoint)
    if (plusPoint?.insidePlus) await tap(plusPoint.x, plusPoint.y)
    const plusMenu = await evaluate(`(() => {
      const menu = document.querySelector('.ll-slot-menu[role="menu"]')
      if (!menu) return { open: false }
      const rect = menu.getBoundingClientRect()
      return {
        open: true,
        items: menu.querySelectorAll('.ll-slot-menu-item[role="menuitem"]').length,
        fits: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)],
      }
    })()`)
    check(`${label}/touch-plus-opens-menu`, plusMenu.open && plusMenu.items >= 6 && plusMenu.fits, plusMenu)
    if (plusMenu.open) {
      const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      await sleep(260)
    }
  }
}

check('runtime/no-console-errors', consoleErrors.length === 0, consoleErrors.slice(0, 5))

const failed = Object.entries(checks).filter(([, value]) => !value)
console.log(JSON.stringify({ passed: Object.keys(checks).length - failed.length, failed: failed.map(([name]) => name), checks, details }, null, 2))
if (failed.length > 0) {
  console.error(`\n响应式与触控验收失败：${failed.map(([name]) => name).join(', ')}`)
  process.exitCode = 1
} else {
  console.log('\n响应式与触控验收全部通过。')
}

client.close()
await closeQaPage(CDP_HTTP, target.id)
