import { expect, test } from '@playwright/test'
import { loadCourseExperiment, trackPageErrors } from './support'

test('纸面右缘滑块可直接拖动滚动程序块', async ({ page }) => {
  const errors = trackPageErrors(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '梯形实验室' })).toBeVisible()
  await loadCourseExperiment(page, '03 十字路口交通灯')

  const pane = page.locator('#wb-main')
  await expect.poll(async () => (
    await pane.evaluate((element) => element.scrollHeight - element.clientHeight)
  )).toBeGreaterThan(160)
  await pane.evaluate((element) => { element.scrollTop = 0 })

  const scrollbar = page.getByRole('scrollbar', { name: '滚动程序块', exact: true })
  const thumb = scrollbar.locator('.program-scrollbar-thumb')
  await expect(scrollbar).toBeVisible()
  await expect(thumb).toBeVisible()
  await expect(scrollbar).not.toHaveAttribute('title')
  expect((await thumb.boundingBox())!.width).toBeLessThanOrEqual(4.5)
  expect(await scrollbar.evaluate((element) => (
    getComputedStyle(element, '::before').content
  ))).toBe('none')

  // 关闭快速上手会让整个工作区上移。滚动条必须跟着纸面走，不能留下旧 top。
  const dismissCoach = page.getByRole('button', { name: '关闭快速上手' })
  if (await dismissCoach.isVisible().catch(() => false)) await dismissCoach.click()
  await expect.poll(async () => {
    const paneBox = await pane.boundingBox()
    const scrollbarBox = await scrollbar.boundingBox()
    if (!paneBox || !scrollbarBox) return Number.POSITIVE_INFINITY
    return Math.abs(scrollbarBox.y - (paneBox.y + 14))
  }).toBeLessThanOrEqual(2)
  // The coach strip also changes the pane's height. Wait for both edges to
  // settle before measuring; checking only top used to catch a mid-layout frame.
  await expect.poll(async () => {
    const paneBox = await pane.boundingBox()
    const scrollbarBox = await scrollbar.boundingBox()
    if (!paneBox || !scrollbarBox) return Number.NEGATIVE_INFINITY
    return paneBox.y + paneBox.height - (scrollbarBox.y + scrollbarBox.height)
  }).toBeGreaterThanOrEqual(13)
  const settledScrollbarBox = await scrollbar.boundingBox()
  const settledPaneBox = await pane.boundingBox()
  expect(settledScrollbarBox!.y + settledScrollbarBox!.height).toBeLessThanOrEqual(
    settledPaneBox!.y + settledPaneBox!.height - 13,
  )

  const thumbBox = await thumb.boundingBox()
  expect(thumbBox).not.toBeNull()
  const startX = thumbBox!.x + thumbBox!.width / 2
  const startY = thumbBox!.y + thumbBox!.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY + 150, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => (
    await pane.evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(100)

  // Clicking the empty rail pages once instead of teleporting the thumb to the
  // pointer. This is the part that previously felt far too sensitive.
  await pane.evaluate((element) => { element.scrollTop = 0 })
  const refreshedThumbBox = await thumb.boundingBox()
  const trackBox = await scrollbar.boundingBox()
  expect(refreshedThumbBox).not.toBeNull()
  expect(trackBox).not.toBeNull()
  const pageTopBefore = await pane.evaluate((element) => element.scrollTop)
  const viewportHeight = await pane.evaluate((element) => element.clientHeight)
  await page.mouse.click(
    trackBox!.x + trackBox!.width / 2,
    Math.min(
      trackBox!.y + trackBox!.height - 2,
      refreshedThumbBox!.y + refreshedThumbBox!.height + 20,
    ),
  )
  await expect.poll(async () => (
    await pane.evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(pageTopBefore + viewportHeight * 0.5)
  expect(await pane.evaluate((element) => element.scrollTop)).toBeLessThan(
    viewportHeight * 0.95,
  )

  await scrollbar.focus()
  await page.keyboard.press('End')
  await expect.poll(async () => (
    await pane.evaluate((element) => (
      element.scrollHeight - element.clientHeight - element.scrollTop
    ))
  )).toBeLessThanOrEqual(1)

  await page.keyboard.press('Home')
  await expect.poll(async () => (
    await pane.evaluate((element) => element.scrollTop)
  )).toBe(0)

  expect(errors, errors.join('\n')).toEqual([])
})
