import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

async function expectLeftGripToFollowRung(page: Page, index: number): Promise<void> {
  const rung = page.locator('.ll-rung').nth(index)
  await page.locator('.ll-rung-drag').nth(index).click()
  await expect(rung).toHaveClass(/is-whole-selected/)

  const grip = page.locator('.wb-program-resizer.is-left .wb-program-resizer-grip')
  await expect(grip.locator('svg')).toHaveCount(0)
  await expect.poll(async () => (
    await grip.evaluate((element) => {
      const style = getComputedStyle(element)
      return `${style.backgroundImage}|${style.width}`
    })
  )).toBe('none|8px')
  await expect.poll(async () => (
    await grip.evaluate((element) => {
      const style = getComputedStyle(element)
      const property = style.transitionProperty.split(',')[0].trim()
      const duration = style.transitionDuration.split(',')[0].trim()
      return `${property}|${duration}`
    })
  )).toContain('top|0.32s')

  await expect.poll(async () => {
    const [rungBox, leftBox] = await Promise.all([
      rung.boundingBox(),
      grip.boundingBox(),
    ])
    if (!rungBox || !leftBox) return Number.POSITIVE_INFINITY
    const rungCenter = rungBox.y + rungBox.height / 2
    const leftCenter = leftBox.y + leftBox.height / 2
    return Math.abs(leftCenter - rungCenter)
  }).toBeLessThanOrEqual(1)
}

async function expectRightWidthHandleAtPaperTop(page: Page): Promise<void> {
  const handle = page.locator('.wb-program-resizer.is-right .wb-program-resizer-grip')
  const frame = page.locator('.wb-program-frame')
  await expect(handle.locator('svg')).toHaveCount(1)
  await expect(handle).toHaveText('')
  await expect.poll(async () => (
    await handle.evaluate((element) => {
      const style = getComputedStyle(element)
      return `${style.width}|${style.height}`
    })
  )).toBe('24px|18px')

  await expect.poll(async () => {
    const [frameBox, handleBox] = await Promise.all([
      frame.boundingBox(),
      handle.boundingBox(),
    ])
    if (!frameBox || !handleBox) return Number.POSITIVE_INFINITY
    return Math.abs(handleBox.y - (frameBox.y + 18))
  }).toBeLessThanOrEqual(1)
}

async function expectCanvasCentered(page: Page): Promise<void> {
  await expect.poll(async () => {
    const [canvasBox, sheetBox] = await Promise.all([
      page.locator('.ll-canvas').boundingBox(),
      page.locator('.ll-program-sheet').boundingBox(),
    ])
    if (!canvasBox || !sheetBox) return Number.POSITIVE_INFINITY
    const centerDelta = Math.abs(
      canvasBox.x + canvasBox.width / 2 - (sheetBox.x + sheetBox.width / 2),
    )
    const widthDelta = Math.abs(canvasBox.width - sheetBox.width)
    return Math.max(centerDelta, widthDelta)
  }).toBeLessThanOrEqual(1)
}

test('左侧调宽把手跟随程序段，右侧横向把手固定在纸面顶部', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  await expectCanvasCentered(page)
  await expectRightWidthHandleAtPaperTop(page)
  await expectLeftGripToFollowRung(page, 1)
  await expectLeftGripToFollowRung(page, 2)

  // 单击元件后只出现绝对定位的就地气泡，不能把图纸往一侧挤偏。
  await page.locator('.ll-node[data-node-id]').first().click()
  await expect(page.locator('[data-inline-operand-editor]')).toBeVisible()
  await expectCanvasCentered(page)

  expect(errors, errors.join('\n')).toEqual([])
})
