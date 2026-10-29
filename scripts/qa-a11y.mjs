#!/usr/bin/env node
/**
 * 手机视口无障碍验收（本机 Edge + Playwright，无需手工开 CDP 端口）。
 *
 * 用法：先起预览服务，再跑脚本。
 *   npm run preview -- --host 127.0.0.1 --port 4211 --strictPort
 *   node scripts/qa-a11y.mjs
 * 可用环境变量改写地址：LADDERLAB_A11Y_URL=http://127.0.0.1:4173/ node scripts/qa-a11y.mjs
 *
 * 覆盖：横向溢出、顶栏 Tab 顺序与焦点可见性、导出菜单键盘操作与 Esc 关闭、
 * 无名称按钮、触屏命中尺寸、文字对比度、axe-core、reduced-motion、底部安全区。
 * stdout 只输出一个 JSON 对象，便于存档对比；人读摘要走 stderr。
 * 任何一项 status=fail 时 process.exitCode = 1；status=warn 只提示不拦构建。
 */
import { createRequire } from 'node:module'
import { chromium } from '@playwright/test'

const requireFrom = createRequire(import.meta.url)
const AXE_PATH = requireFrom.resolve('axe-core/axe.min.js')

const APP_URL = process.env.LADDERLAB_A11Y_URL ?? 'http://127.0.0.1:4211/'
const MOBILE_VIEWPORT = { width: 390, height: 844 }
const DESKTOP_VIEWPORT = { width: 1280, height: 900 }
/** iPhone 12/13/14 的 CSS 宽度。390 的 scrollWidth 允许 1px 的边框取整误差。 */
const HORIZONTAL_SLACK = 1
const TOUCH_FLOOR = 44
const WAIT_AFTER_LOAD = 1200

const checks = []

function pass(id, title, detail, data) {
  checks.push({ id, title, status: 'pass', detail, ...(data === undefined ? {} : { data }) })
}

function fail(id, title, detail, data) {
  checks.push({ id, title, status: 'fail', detail, ...(data === undefined ? {} : { data }) })
}

function warn(id, title, detail, data) {
  checks.push({ id, title, status: 'warn', detail, ...(data === undefined ? {} : { data }) })
}

function settle(id, ok, title, detail, data) {
  if (ok) pass(id, title, detail, data)
  else fail(id, title, detail, data)
}

async function openPage(browser, viewport, { mobile = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    reducedMotion,
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)))
  await page.goto(APP_URL, { waitUntil: 'load' })
  await page.waitForSelector('.wb-topbar', { timeout: 20000 })
  await page.waitForTimeout(WAIT_AFTER_LOAD)
  return { context, page, pageErrors }
}

/* ------------------------------------------------------------------ 溢出 */

async function checkHorizontalOverflow(page) {
  const measured = await page.evaluate(() => {
    const doc = document.documentElement
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        offenders.push({
          selector: `${el.tagName.toLowerCase()}.${String(el.className ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        })
      }
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: offenders.slice(0, 8),
    }
  })
  const limit = measured.clientWidth + HORIZONTAL_SLACK
  settle(
    'horizontal-overflow',
    measured.scrollWidth <= limit,
    '手机视口无横向溢出',
    `documentElement.scrollWidth=${measured.scrollWidth}，上限=${limit}（clientWidth ${measured.clientWidth} + ${HORIZONTAL_SLACK}px 取整余量）`,
    measured,
  )
  return measured
}

/* ------------------------------------------------------------- Tab 与焦点 */

const readActive = () => {
  const el = document.activeElement
  if (!el || el === document.body) return { tag: 'BODY', signature: 'BODY' }
  const style = getComputedStyle(el)
  const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
  const outlineVisible = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
  const shadowVisible = style.boxShadow !== 'none' && style.boxShadow.trim() !== ''
  return {
    tag: el.tagName.toLowerCase(),
    className: String(el.className ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join('.'),
    label,
    signature: `${el.tagName}|${String(el.className ?? '')}|${label}`,
    outline: `${style.outlineStyle} ${style.outlineWidth}`,
    boxShadow: style.boxShadow.slice(0, 40),
    ringVisible: outlineVisible || shadowVisible,
  }
}

async function checkTopbarTabOrder(page) {
  const expected = await page.evaluate(() => {
    const topbar = document.querySelector('.wb-topbar')
    if (!topbar) return []
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    return [...topbar.querySelectorAll(selector)]
      .filter((el) => {
        if (el.disabled) return false
        const rect = el.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return false
        const style = getComputedStyle(el)
        return style.display !== 'none' && style.visibility !== 'hidden'
      })
      .map((el) =>
        `${el.tagName}|${String(el.className ?? '')}|${(el.getAttribute('aria-label') || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 32)}`,
      )
  })

  await page.evaluate(() => document.body.focus?.())
  const visits = []
  const seen = new Set()
  const MAX_PRESSES = expected.length + 12
  for (let i = 0; i < MAX_PRESSES; i += 1) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(70)
    const active = await page.evaluate(readActive)
    visits.push(active)
    if (active.signature === 'BODY') continue
    if (seen.has(active.signature) && !expected.includes(active.signature)) break
    seen.add(active.signature)
    if (expected.every((sig) => seen.has(sig))) break
  }

  const reachable = expected.filter((sig) => seen.has(sig))
  const missing = expected.filter((sig) => !seen.has(sig))
  settle(
    'topbar-tab-order',
    expected.length > 0 && missing.length === 0,
    '顶栏控件可按 Tab 依次到达',
    `顶栏可聚焦控件 ${expected.length} 个，Tab 覆盖 ${reachable.length} 个` +
      (missing.length ? `；未到达：${missing.map((sig) => sig.split('|')[2] || sig.split('|')[1]).join('、')}` : ''),
    { expectedCount: expected.length, missing },
  )

  const noRing = visits.filter((visit) => visit.tag !== 'BODY' && visit.ringVisible !== true)
  const firstNoRing = noRing[0]
  settle(
    'focus-ring-visible',
    noRing.length === 0,
    '键盘焦点有明显视觉指示',
    noRing.length === 0
      ? `Tab 经过的 ${visits.filter((v) => v.tag !== 'BODY').length} 个停靠点全部有 outline 或 box-shadow`
      : `${noRing.length} 个停靠点没有 outline/box-shadow，首个是 <${firstNoRing.tag}> ${firstNoRing.label || firstNoRing.className}`,
    { inspected: visits.filter((v) => v.tag !== 'BODY').length, offenders: noRing.slice(0, 6) },
  )

  return visits
}

/* ------------------------------------------------------------ 导出菜单键盘 */

async function checkExportMenuKeyboard(page) {
  const trigger = '.wb-export-trigger'
  const menu = '#topbar-export-menu'
  const hasTrigger = await page.locator(trigger).count()
  if (!hasTrigger) {
    fail('export-menu', '导出菜单键盘操作', `在 ${page.viewportSize().width}px 视口找不到 ${trigger}`)
    return
  }

  await page.focus(trigger)
  await page.keyboard.press('Enter')
  const opened = await page
    .waitForSelector(menu, { timeout: 3000 })
    .then(() => true)
    .catch(() => false)
  const firstItem = await page.evaluate((sel) => {
    const active = document.activeElement
    return {
      insideMenu: !!active?.closest(sel),
      role: active?.getAttribute('role'),
      label: (active?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
    }
  }, menu)
  settle(
    'export-menu-open',
    opened && firstItem.insideMenu,
    '导出菜单可用键盘打开并自动聚焦第一项',
    opened
      ? `Enter 打开菜单，焦点落在「${firstItem.label}」（role=${firstItem.role}）`
      : 'Enter 未打开菜单',
    firstItem,
  )

  if (opened) {
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(150)
    const second = await page.evaluate((sel) => {
      const active = document.activeElement
      return { insideMenu: !!active?.closest(sel), label: (active?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) }
    }, menu)
    await page.keyboard.press('End')
    await page.waitForTimeout(150)
    const last = await page.evaluate((sel) => {
      const active = document.activeElement
      const items = [...document.querySelectorAll(`${sel} [role="menuitem"]`)]
      return {
        insideMenu: !!active?.closest(sel),
        label: (active?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
        isLast: items[items.length - 1] === active,
      }
    }, menu)
    settle(
      'export-menu-arrows',
      second.insideMenu && last.insideMenu && last.isLast,
      '导出菜单支持方向键与 End 键',
      `ArrowDown → 「${second.label}」，End → 「${last.label}」（是否末项：${last.isLast}）`,
      { second, last },
    )

    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    const closed = await page.evaluate(
      ({ menuSel, triggerSel }) => {
        const active = document.activeElement
        return {
          menuGone: !document.querySelector(menuSel),
          expanded: document.querySelector(triggerSel)?.getAttribute('aria-expanded'),
          focusRestored: !!active?.closest(triggerSel),
        }
      },
      { menuSel: menu, triggerSel: trigger },
    )
    settle(
      'export-menu-escape',
      closed.menuGone && closed.focusRestored,
      'Esc 关闭导出菜单并把焦点还给触发按钮',
      `菜单已移除=${closed.menuGone}，aria-expanded=${closed.expanded}，焦点回到触发按钮=${closed.focusRestored}`,
      closed,
    )
  } else {
    await page.keyboard.press('Escape')
  }
}

/* ------------------------------------------------------------ 无名称按钮 */

async function checkUnnamedButtons(page) {
  const report = await page.evaluate(() => {
    const EXCLUDED = 'display:none / visibility:hidden / 0 面积 / opacity:0 / 位于 [aria-hidden="true"] 子树'
    const rendered = (el) => {
      if (el.closest('[aria-hidden="true"]')) return false
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return false
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      return true
    }
    const nameOf = (el) => {
      const aria = el.getAttribute('aria-label')
      if (aria && aria.trim()) return aria.trim()
      const labelledBy = el.getAttribute('aria-labelledby')
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (text) return text
      }
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
      if (text) return text
      return (el.getAttribute('title') ?? '').trim()
    }
    const all = [...document.querySelectorAll('button')]
    const unnamed = []
    let inspected = 0
    for (const el of all) {
      if (!rendered(el)) continue
      inspected += 1
      if (!nameOf(el)) {
        unnamed.push({
          selector: `button.${String(el.className ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.') || '(no class)'}`,
          parent: el.parentElement?.className ? `.${String(el.parentElement.className).split(/\s+/)[0]}` : el.parentElement?.tagName,
          html: el.outerHTML.slice(0, 90),
        })
      }
    }
    return { total: all.length, inspected, unnamed, EXCLUDED }
  })

  settle(
    'buttons-have-names',
    report.unnamed.length === 0,
    '每个可见按钮都有可读名称',
    `DOM 内 button ${report.total} 个，可见可交互 ${report.inspected} 个，无名称 ${report.unnamed.length} 个。` +
      `排除规则：${report.EXCLUDED}`,
    report,
  )
  return report
}

/* -------------------------------------------------------------- 命中尺寸 */

async function checkTouchTargets(page) {
  const small = await page.evaluate((floor) => {
    const out = []
    const selector = 'button, [role="button"], a[href], input:not([type="hidden"]), select, summary'
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest('[aria-hidden="true"]')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue
      if (rect.width >= floor && rect.height >= floor) continue
      out.push({
        label: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22),
        className: String(el.className ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .join('.'),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
    return out
  }, TOUCH_FLOOR)

  if (small.length === 0) {
    pass('touch-targets', '可见触控目标都不小于 44px', `全部可交互元素 ≥ ${TOUCH_FLOOR}×${TOUCH_FLOOR}`)
  } else {
    warn(
      'touch-targets',
      `${small.length} 个触控目标小于 ${TOUCH_FLOOR}px`,
      `最小：${small
        .slice()
        .sort((a, b) => a.height - b.height)
        .slice(0, 4)
        .map((item) => `${item.label || item.className} ${item.width}×${item.height}`)
        .join('，')}`,
      small,
    )
  }
  return small
}

/* ---------------------------------------------------------------- 对比度 */

async function checkContrast(page) {
  const report = await page.evaluate(() => {
    const channel = (value) => {
      const v = value / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    const parse = (value) => {
      const match = /rgba?\(([^)]+)\)/.exec(value ?? '')
      if (!match) return null
      const parts = match[1].split(',').map((part) => Number.parseFloat(part))
      return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 }
    }
    const ratio = (a, b) => {
      const l1 = luminance(a)
      const l2 = luminance(b)
      const high = Math.max(l1, l2)
      const low = Math.min(l1, l2)
      return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100
    }
    /** 逐级向上找第一个不透明背景；遇到图片/渐变则判定为脚本不可验证，交给人工看。 */
    const backgroundOf = (el) => {
      let node = el
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node)
        if (style.backgroundImage && style.backgroundImage !== 'none') return null
        const parsed = parse(style.backgroundColor)
        if (parsed && parsed.alpha > 0.5) return parsed.rgb
        node = node.parentElement
      }
      return [255, 255, 255]
    }

    const samples = []
    const seen = new Set()
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[aria-hidden="true"]')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 4 || rect.height < 4) continue
      const ownText = [...el.childNodes].some(
        (node) => node.nodeType === 3 && node.textContent.trim().length > 1,
      )
      if (!ownText) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      const foreground = parse(style.color)
      if (!foreground) continue
      const key = `${style.color}|${style.fontSize}|${style.fontWeight}`
      if (seen.has(key)) continue
      seen.add(key)
      const background = backgroundOf(el)
      if (!background) continue
      const size = Number.parseFloat(style.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
      const value = ratio(foreground.rgb, background)
      samples.push({
        selector: `${el.tagName.toLowerCase()}.${String(el.className ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')}`.replace(/\.$/, ''),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 16),
        color: style.color,
        fontSize: Math.round(size * 10) / 10,
        fontWeight: style.fontWeight,
        ratio: value,
        threshold: large ? 3 : 4.5,
      })
    }
    samples.sort((a, b) => a.ratio - b.ratio)
    return {
      inspected: samples.length,
      below: samples.filter((item) => item.ratio < item.threshold),
      lowest: samples.slice(0, 6),
    }
  })

  settle(
    'contrast',
    report.below.length === 0,
    '可见文字对比度达到 WCAG AA',
    report.below.length === 0
      ? `实测 ${report.inspected} 组前景/背景组合，最低 ${report.lowest[0]?.ratio ?? '—'}:1（${report.lowest[0]?.selector ?? '—'}，要求 ${report.lowest[0]?.threshold ?? 4.5}:1）`
      : `${report.below.length} 组低于阈值，最低 ${report.below[0].ratio}:1（${report.below[0].selector}）`,
    { inspected: report.inspected, lowest: report.lowest, below: report.below.slice(0, 8) },
  )
  return report
}

/* ------------------------------------------------------------------- axe */

async function checkAxe(page, label) {
  await page.addScriptTag({ path: AXE_PATH })
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    })
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => ({
        target: node.target.join(' '),
        summary: (node.failureSummary ?? '').split('\n').filter(Boolean).slice(0, 2).join(' / '),
      })),
      nodeCount: violation.nodes.length,
    }))
  })
  const blocking = violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  settle(
    `axe-${label}`,
    blocking.length === 0,
    `axe-core ${label} 无 serious/critical 违规`,
    violations.length === 0
      ? '零违规'
      : `${violations.length} 条违规：${violations.map((v) => `${v.id}(${v.impact}×${v.nodeCount})`).join('、')}`,
    { violations, blocking: blocking.map((v) => v.id) },
  )
  return violations
}

/* --------------------------------------------------------- reduced motion */

async function checkReducedMotion(page) {
  const offenders = await page.evaluate(() => {
    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el)
      const durations = style.transitionDuration.split(',').map((value) => Number.parseFloat(value) || 0)
      const longest = Math.max(0, ...durations)
      const properties = style.transitionProperty
      if (longest <= 0.05 || properties === 'none') continue
      const key = `${style.transitionDuration}|${properties}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        selector: `${el.tagName.toLowerCase()}.${String(el.className ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')}`.replace(/\.$/, ''),
        duration: style.transitionDuration,
        property: properties.slice(0, 48),
      })
    }
    out.sort((a, b) => Number.parseFloat(b.duration) - Number.parseFloat(a.duration))
    return out
  })
  settle(
    'reduced-motion',
    offenders.length === 0,
    '开启「减少动态效果」后不再播放过渡',
    offenders.length === 0
      ? '所有元素 transition-duration ≤ 50ms'
      : `${offenders.length} 组元素仍在过渡，最长 ${offenders[0].duration}（${offenders[0].selector}）`,
    offenders.slice(0, 8),
  )
  return offenders
}

/* ------------------------------------------------------------- 底部安全区 */

async function checkBottomSafety(page) {
  const report = await page.evaluate(() => {
    const pick = (selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return {
        selector,
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        paddingBottom: style.paddingBottom,
        viewportHeight: window.innerHeight,
      }
    }
    const bars = ['.wb-tabbar', '.status-bar', '.support-badge'].map(pick).filter(Boolean)
    return {
      bars,
      overflowing: bars.filter((bar) => bar.bottom > bar.viewportHeight + 1).map((bar) => bar.selector),
    }
  })
  settle(
    'bottom-safe-area',
    report.overflowing.length === 0 && report.bars.length > 0,
    '底部固定栏完整落在视口内',
    report.bars.length === 0
      ? '页面上没有找到底部固定栏'
      : report.bars.map((bar) => `${bar.selector} bottom=${bar.bottom}/${bar.viewportHeight} padding-bottom=${bar.paddingBottom}`).join('；'),
    report,
  )
  return report
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const startedAt = new Date().toISOString()
  const errors = []
  const details = {}
  try {
    const mobile = await openPage(browser, MOBILE_VIEWPORT, { mobile: true })
    errors.push(...mobile.pageErrors)
    details.overflow = await checkHorizontalOverflow(mobile.page)
    details.tabOrder = await checkTopbarTabOrder(mobile.page)
    details.unnamedButtons = await checkUnnamedButtons(mobile.page)
    details.touchTargets = await checkTouchTargets(mobile.page)
    details.contrast = await checkContrast(mobile.page)
    details.axeMobile = await checkAxe(mobile.page, 'mobile')
    details.bottomSafety = await checkBottomSafety(mobile.page)
    await mobile.context.close()

    const desktop = await openPage(browser, DESKTOP_VIEWPORT)
    errors.push(...desktop.pageErrors)
    await checkExportMenuKeyboard(desktop.page)
    details.axeDesktop = await checkAxe(desktop.page, 'desktop')
    await desktop.context.close()

    const reduced = await openPage(browser, MOBILE_VIEWPORT, { mobile: true, reducedMotion: 'reduce' })
    errors.push(...reduced.pageErrors)
    details.reducedMotion = await checkReducedMotion(reduced.page)
    await reduced.context.close()
  } finally {
    await browser.close()
  }

  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1
      return acc
    },
    { pass: 0, fail: 0, warn: 0 },
  )
  const output = {
    url: APP_URL,
    browser: 'msedge (channel, headless)',
    startedAt,
    finishedAt: new Date().toISOString(),
    viewports: { mobile: MOBILE_VIEWPORT, desktop: DESKTOP_VIEWPORT },
    summary,
    checks,
    pageErrors: errors,
  }

  if (errors.length > 0) output.summary.fail += 1
  console.log(JSON.stringify(output, null, 2))
  console.error(
    `\n[q-a11y] ${summary.pass} 通过 / ${summary.fail} 失败 / ${summary.warn} 提示` +
      (errors.length ? ` / ${errors.length} 个页面异常` : ''),
  )
  for (const check of checks) {
    if (check.status === 'pass') continue
    console.error(`  ${check.status === 'fail' ? '✗' : '!'} ${check.id}: ${check.detail}`)
  }
  if (summary.fail > 0 || errors.length > 0) process.exitCode = 1
}

await main()
