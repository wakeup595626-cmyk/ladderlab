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

  // 关闭快速上手会让整个工作区上移。滚动条必须跟着纸面走，不能留下旧 top。
  const dismissCoach = page.getByRole('button', { name: '关闭快速上手' })
  if (await dismissCoach.isVisible().catch(() => false)) await dismissCoach.click()
  await expect.poll(async () => {
    const paneBox = await pane.boundingBox()
    const scrollbarBox = await scrollbar.boundingBox()
    if (!paneBox || !scrollbarBox) return Number.POSITIVE_INFINITY
    return Math.abs(scrollbarBox.y - (paneBox.y + 14))
  }).toBeLessThanOrEqual(2)
  const paneBox = await pane.boundingBox()
  const scrollbarBox = await scrollbar.boundingBox()
  expect(scrollbarBox!.y + scrollbarBox!.height).toBeLessThanOrEqual(
    paneBox!.y + paneBox!.height + 1,
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
