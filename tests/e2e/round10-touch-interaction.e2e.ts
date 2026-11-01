import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

type Point = { x: number; y: number }

/** 用 CDP 派发真实触点；Playwright 的 touchscreen 只有 tap，覆盖不了滑动与拖放。 */
async function swipeWithTouch(page: Page, from: Point, to: Point, steps = 14): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y, id: 1 }],
    })
    for (let step = 1; step <= steps; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / steps
      const y = from.y + ((to.y - from.y) * step) / steps
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y, id: 1 }],
      })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
}

async function centerOf(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error('拿不到 ' + selector + ' 的位置')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function openInstructionDrawer(page: Page) {
  await page.locator('.mobile-tab-action').filter({ hasText: '指令' }).click()
  const drawer = page.locator('.wb-instruction-drawer-backdrop')
  await expect(drawer).toBeVisible()
  return drawer
}

test.describe('390x844 指令抽屉', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('从指令行主体上滑滚动列表，不误触发拖放', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openHome(page)
    await openInstructionDrawer(page)

    const scroller = page.locator('.sidebar-instructions')
    await expect(scroller).toBeVisible()
    await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(100)
    const before = await scroller.evaluate((el) => el.scrollTop)
    const nodesBefore = await page.locator('.ll-node').count()

    const row = page.locator('.instruction-row').first()
    const box = await row.boundingBox()
    if (!box) throw new Error('指令行不在视口内')
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await swipeWithTouch(page, start, { x: start.x, y: start.y - 220 })

    await expect.poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before)
    expect(await page.locator('.ll-node').count()).toBe(nodesBefore)
    expect(errors).toEqual([])
  })

  test('从指令行拖动握把投放到画布插槽，元件数增加', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openHome(page)
    await openInstructionDrawer(page)

    const nodesBefore = await page.locator('.ll-node').count()
    const slot = page.locator('.ll-slot').first()
    await expect(slot).toBeVisible()
    const target = await centerOf(page, '.ll-slot')
    const grip = await centerOf(page, '.instruction-grip')

    await swipeWithTouch(page, grip, target, 18)

    await expect.poll(() => page.locator('.ll-node').count()).toBeGreaterThan(nodesBefore)
    // 拖放结束后抽屉必须回到可交互状态，否则手指抬起后画布就被遮住了。
    await expect(page.locator('.wb-instruction-drawer-backdrop'))
      .not.toHaveClass(/is-dragging/)
    expect(errors).toEqual([])
  })
})

test.describe('844x390 低高度程序段菜单', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('菜单内容可滚动到底并可用真实点击创建副本', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openHome(page)
    // 空白工程只有一个占位段，复制/移动等菜单项按设计禁用；换成有内容的课程示例。
    await loadCourseExperiment(page, '02 定时器与计数器')

    const rungsBefore = await page.locator('article.ll-rung').count()
    const menu = page.locator('.ll-rung-menu').first()
    await menu.locator('summary').tap()
    const panel = menu.locator('.ll-rung-menu-panel')
    await expect(panel).toBeVisible()

    const metrics = await panel.evaluate((el) => {
      const start = el.scrollTop
      el.scrollTop = 9999
      return {
        start,
        end: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        viewportHeight: window.innerHeight,
      }
    })
    // 菜单要么完整放得下，要么必须能滚到底；被裁切且滚不动才是缺陷。
    if (metrics.scrollHeight > metrics.clientHeight) {
      expect(metrics.end).toBeGreaterThan(metrics.start)
    }
    const lastItem = menu.getByRole('menuitem').last()
    await lastItem.scrollIntoViewIfNeeded()
    const lastBox = await lastItem.boundingBox()
    expect(lastBox).not.toBeNull()
    expect(lastBox!.y).toBeGreaterThanOrEqual(0)
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(metrics.viewportHeight + 1)

    const duplicate = menu.getByRole('menuitem', { name: '创建副本' })
    await duplicate.scrollIntoViewIfNeeded()
    await duplicate.tap()
    await expect.poll(() => page.locator('article.ll-rung').count())
      .toBe(rungsBefore + 1)
    expect(errors).toEqual([])
  })
})

test.describe('390x844 就地操作数编辑器', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('关闭、更多与输入框不小于 44px，且能真实点击关闭', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openHome(page)
    // 空白工程只有插入槽，没有可点击的元件；先载入包含触点的课程示例。
    await loadCourseExperiment(page, '02 定时器与计数器')
    await page.locator('.ll-node[data-node-id]').first().tap()

    const close = page.locator('.inline-operand-close')
    await expect(close).toBeVisible()
    // 卡片有 170ms 的进入缩放；等动画结束再量，否则会把缩放中的 43.3px
    // 误判成命中区不足。这里等的是 CSS 动画本身，不靠固定 sleep。
    await page.locator('.inline-operand').evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animation) =>
        animation.finished.catch(() => undefined)))
    })
    const targets: Array<[string, string]> = [
      ['关闭', '.inline-operand-close'],
      ['更多参数', '.inline-operand-more'],
      ['操作数输入', '.inline-operand-field input'],
    ]
    const measured: Record<string, { width: number; height: number }> = {}
    for (const [label, selector] of targets) {
      const box = await page.locator(selector).first().boundingBox()
      expect(box, label + ' 应当可见').not.toBeNull()
      measured[label] = { width: box!.width, height: box!.height }
      expect(box!.height, label + ' 高度').toBeGreaterThanOrEqual(44)
    }
    console.log('就地编辑器命中尺寸 ' + JSON.stringify(measured))

    await close.tap()
    await expect(close).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
