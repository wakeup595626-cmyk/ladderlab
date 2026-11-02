import { expect, test } from '@playwright/test'
import { loadCourseExperiment, trackPageErrors } from './support'

test('纸面外侧滑块可直接拖动滚动程序块', async ({ page }) => {
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
  const frameBox = await page.locator('.wb-program-frame').boundingBox()
  const scrollbarBox = await scrollbar.boundingBox()
  expect(frameBox).not.toBeNull()
  expect(scrollbarBox).not.toBeNull()
  // The rail lives in the pink gutter, not on top of the paper edge.
  expect(scrollbarBox!.x).toBeGreaterThanOrEqual(frameBox!.x + frameBox!.width)

  const initialThumbBox = await thumb.boundingBox()
  expect(initialThumbBox).not.toBeNull()
  // A real grab target, not a 4px hairline.
  expect(initialThumbBox!.width).toBeGreaterThanOrEqual(10)
  const chrome = await thumb.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      border: style.borderTopWidth,
      outline: style.outlineStyle,
      shadow: style.boxShadow,
    }
  })
  expect(chrome.border).toBe('0px')
  expect(chrome.outline).toBe('none')
  expect(chrome.shadow).toBe('none')
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

  // The coach strip moved the whole workbench upward. Never drag with the
  // pre-dismissal coordinates, or the pointer lands on the old rail position.
  const thumbBox = await thumb.boundingBox()
  expect(thumbBox).not.toBeNull()
  const startX = thumbBox!.x + thumbBox!.width / 2
  const startY = thumbBox!.y + thumbBox!.height / 2

  // A plain click on the pill must not move the document at all.
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(async () => (
    await pane.evaluate((element) => element.scrollTop)
  )).toBe(0)
  // A pointer click must not focus the rail: the old focus outline was the
  // box students saw around the thumb after selecting a rung.
  expect(await scrollbar.evaluate((element) => document.activeElement === element)).toBe(false)
  const clickedChrome = await thumb.evaluate((element) => {
    const style = getComputedStyle(element)
    return { outline: style.outlineStyle, shadow: style.boxShadow }
  })
  expect(clickedChrome.outline).toBe('none')
  expect(clickedChrome.shadow).toBe('none')

  // Clicking the empty rail is inert too; it used to page the whole document.
  const trackBox = await scrollbar.boundingBox()
  expect(trackBox).not.toBeNull()
  await page.mouse.click(
    trackBox!.x + trackBox!.width / 2,
    Math.min(trackBox!.y + trackBox!.height - 2, thumbBox!.y + thumbBox!.height + 40),
  )
  await expect.poll(async () => (
    await pane.evaluate((element) => element.scrollTop)
  )).toBe(0)

  // Dragging is geared down: 150px of pointer travel should scroll a few
  // hundred pixels, not fling the reader through the whole program.
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY + 150, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => (
    await pane.evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(250)
  expect(await pane.evaluate((element) => element.scrollTop)).toBeLessThan(1200)

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
