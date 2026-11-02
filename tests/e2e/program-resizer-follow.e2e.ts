import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

async function expectGripToFollowRung(
  page: Page,
  side: 'left' | 'right',
  index: number,
): Promise<void> {
  const rung = page.locator('.ll-rung').nth(index)
  await page.locator('.ll-rung-drag').nth(index).click()
  await expect(rung).toHaveClass(/is-whole-selected/)

  const grip = page.locator(`.wb-program-resizer.is-${side} .wb-program-resizer-grip`)
  await expect(grip.locator('svg')).toHaveCount(0)
  await expect(grip).toHaveText('')

  await expect.poll(async () => {
    const [rungBox, gripBox] = await Promise.all([
      rung.boundingBox(),
      grip.boundingBox(),
    ])
    if (!rungBox || !gripBox) return Number.POSITIVE_INFINITY
    const rungCenter = rungBox.y + rungBox.height / 2
    const gripCenter = gripBox.y + gripBox.height / 2
    return Math.abs(gripCenter - rungCenter)
  }).toBeLessThanOrEqual(1)
}

async function expectMinimalGrip(page: Page): Promise<void> {
  const handles = page.locator('.wb-program-resizer')
  await expect(handles).toHaveCount(2)
  await expect(page.locator('.wb-program-resizer[title]')).toHaveCount(0)
  await expect(page.locator('.wb-program-resizer-tip')).toHaveCount(0)

  const grip = page.locator('.wb-program-resizer.is-right .wb-program-resizer-grip')
  const railContent = await page.locator('.wb-program-resizer.is-right').evaluate(
    (element) => getComputedStyle(element, '::before').content,
  )
  expect(railContent).toBe('none')
  await expect.poll(async () => (
    await grip.evaluate((element) => {
      const style = getComputedStyle(element)
      return `${style.width}|${style.height}|${style.opacity}`
    })
  )).toBe('3px|44px|0')

  // 握柄压在纸面边缘，不应该有边框或背景方框。
  const chrome = await grip.evaluate((element) => {
    const style = getComputedStyle(element)
    return `${style.borderTopWidth}|${style.boxShadow}|${style.backgroundImage}`
  })
  expect(chrome).toBe('0px|none|none')
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

test('两侧调宽把手跟随程序段，且拖动与指针一一对应', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  await expectCanvasCentered(page)
  await expectMinimalGrip(page)
  await expectGripToFollowRung(page, 'left', 1)
  await expectGripToFollowRung(page, 'right', 2)

  const frame = page.locator('.wb-program-frame')
  const beforeDrag = await frame.boundingBox()
  const handle = page.locator('.wb-program-resizer.is-right')
  const handleBox = await handle.boundingBox()
  expect(beforeDrag).not.toBeNull()
  expect(handleBox).not.toBeNull()
  if (!beforeDrag || !handleBox) return

  const startX = handleBox.x + handleBox.width / 2
  const startY = handleBox.y + handleBox.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX - 120, startY, { steps: 12 })
  await page.mouse.up()

  const afterDrag = await frame.boundingBox()
  expect(afterDrag).not.toBeNull()
  if (!afterDrag) return
  const delta = beforeDrag.width - afterDrag.width
  // 1:1 跟手：拖 120px 宽度就变化 120px，不再被放大成 2 倍。
  expect(Math.abs(delta - 120)).toBeLessThanOrEqual(6)

  // 单击元件后只出现绝对定位的就地气泡，不能把图纸往一侧挤偏。
  await page.locator('.ll-node[data-node-id]').first().click()
  await expect(page.locator('[data-inline-operand-editor]')).toBeVisible()
  await expectCanvasCentered(page)

  expect(errors, errors.join('\n')).toEqual([])
})
