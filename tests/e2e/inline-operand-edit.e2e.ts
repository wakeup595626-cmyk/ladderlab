import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

function inlineEditor(page: Page) {
  return page.locator('[data-inline-operand-editor]')
}

function inlineInput(page: Page) {
  return inlineEditor(page).locator('input[data-inline-input]')
}

function inlineAddress(page: Page) {
  return inlineEditor(page).locator('input[data-inline-address]')
}

async function openFirstContact(page: Page) {
  const contact = page.locator('.ll-node[data-node-id]').first()
  await contact.click()
  const inline = inlineEditor(page)
  await expect(inline).toBeVisible()
  await expect.poll(() => inline.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  await expect(inlineInput(page)).toBeFocused()
  return contact
}

async function expectCanvasCentered(page: Page): Promise<void> {
  await expect.poll(async () => {
    const [canvasBox, sheetBox] = await Promise.all([
      page.locator('.ll-canvas').boundingBox(),
      page.locator('.ll-program-sheet').boundingBox(),
    ])
    if (!canvasBox || !sheetBox) return Number.POSITIVE_INFINITY
    return Math.max(
      Math.abs(canvasBox.x + canvasBox.width / 2 - (sheetBox.x + sheetBox.width / 2)),
      Math.abs(canvasBox.width - sheetBox.width),
    )
  }).toBeLessThanOrEqual(1)
}

test('单击元件只打开就地操作数，完整参数保持关闭且画布不偏移', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const contact = await openFirstContact(page)
  await expect(inlineEditor(page)).toHaveCount(1)
  await expect(page.locator('#wb-context-panel')).toHaveCount(0)
  await expectCanvasCentered(page)

  const inlineBox = await inlineEditor(page).boundingBox()
  expect(inlineBox).not.toBeNull()
  expect(inlineBox!.x).toBeGreaterThanOrEqual(0)
  expect(inlineBox!.y).toBeGreaterThanOrEqual(0)
  expect(inlineBox!.x + inlineBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  expect(inlineBox!.y + inlineBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height)

  await page.keyboard.press('Escape')
  await expect(inlineEditor(page)).toBeHidden()
  await expect.poll(() => contact.evaluate((element) => document.activeElement === element)).toBe(true)
  await expect(page.locator('#wb-context-panel')).toHaveCount(0)

  expect(errors, errors.join('\n')).toEqual([])
})

test('就地气泡同时显示操作数与地址，不显示常驻说明文字', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  await openFirstContact(page)
  const inline = inlineEditor(page)
  await expect(inline.getByText('操作数', { exact: true })).toBeVisible()
  await expect(inline.getByText('地址', { exact: true })).toBeVisible()
  await expect(inlineInput(page)).toHaveValue(/\S+/)
  await expect(inlineAddress(page)).toHaveValue(/^%[IQM]/)
  await expect(inline.getByRole('button', { name: '更多参数' })).toBeVisible()
  await expect(inline).not.toContainText('Enter')
  await expect(inline).not.toContainText('Esc')
  await expect(inline).not.toContainText('保存时自动规范化')
  await expect(inline).not.toContainText('回车后规范为')

  expect(errors, errors.join('\n')).toEqual([])
})

test('操作数与地址可分别修改，回车后各自保留', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const contact = await openFirstContact(page)
  const nodeId = await contact.getAttribute('data-node-id')
  expect(nodeId).toBeTruthy()
  const originalAddress = await inlineAddress(page).inputValue()

  await inlineInput(page).fill('RunLamp')
  await inlineInput(page).press('Enter')
  await expect(inlineEditor(page)).toBeHidden()

  await contact.click()
  await expect(inlineInput(page)).toHaveValue('RunLamp')
  await expect(inlineAddress(page)).toHaveValue(originalAddress)

  await inlineAddress(page).fill('m99.6')
  await inlineAddress(page).press('Enter')
  await expect(inlineEditor(page)).toBeHidden()
  await expect(page.locator(`.ll-node[data-node-id="${nodeId}"]`))
    .toHaveAttribute('data-operand', '%M99.6')

  await contact.click()
  await expect(inlineInput(page)).toHaveValue('RunLamp')
  await expect(inlineAddress(page)).toHaveValue('%M99.6')

  expect(errors, errors.join('\n')).toEqual([])
})

test('地址栏自动规范为百分号大写且回车提交后刷新仍保留', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const contact = await openFirstContact(page)
  const nodeId = await contact.getAttribute('data-node-id')
  expect(nodeId).toBeTruthy()

  const examples = [
    { input: 'm99.7', expected: '%M99.7' },
    { input: '%M99.7', expected: '%M99.7' },
    { input: 'q98.6', expected: '%Q98.6' },
    { input: '%i97.5', expected: '%I97.5' },
  ]

  for (const example of examples) {
    const input = inlineAddress(page)
    await input.fill(example.input)
    await input.press('Enter')
    await expect(inlineEditor(page)).toBeHidden()
    await expect(page.locator(`.ll-node[data-node-id="${nodeId}"]`))
      .toHaveAttribute('data-operand', example.expected)
    await contact.click()
    await expect(inlineInput(page)).toBeFocused()
  }

  await page.keyboard.press('Escape')
  await expect(inlineEditor(page)).toBeHidden()
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.locator('.ll-program-sheet')).toBeVisible()
  await expect(page.locator(`.ll-node[data-node-id="${nodeId}"]`))
    .toHaveAttribute('data-operand', '%I97.5')

  expect(errors, errors.join('\n')).toEqual([])
})

test('非法 BOOL 地址保持编辑态、聚焦并显示可读错误', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const contact = await openFirstContact(page)
  const originalOperand = await contact.getAttribute('data-operand')
  const input = inlineAddress(page)
  await input.fill('%MW10')
  await input.press('Enter')

  const inline = inlineEditor(page)
  await expect(inline).toBeVisible()
  await expect(inline).toHaveAttribute('data-inline-state', 'invalid')
  await expect(inline.getByRole('alert')).toContainText('BOOL')
  await expect(input).toBeFocused()
  await expect(contact).toHaveAttribute('data-operand', originalOperand!)

  await page.keyboard.press('Escape')
  await expect(inline).toBeHidden()
  expect(errors, errors.join('\n')).toEqual([])
})

test('双击元件或用「更多参数」打开完整属性，单击始终只开就地气泡', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const contact = page.locator('.ll-node[data-node-id]').first()
  const details = page.locator('#wb-context-panel')

  // 单击只弹就地气泡：右侧属性面板必须保持关闭，画布仍居中。
  await openFirstContact(page)
  await expect(details).toHaveCount(0)
  await expectCanvasCentered(page)
  await page.keyboard.press('Escape')
  await expect(inlineEditor(page)).toBeHidden()

  // 双击是「完整参数」的显式入口。
  await contact.dblclick()
  await expect(inlineEditor(page)).toBeHidden()
  await expect(details).toBeVisible()
  await expect(details.getByRole('tab', { name: '属性' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()

  // 气泡里的「更多参数」是同一入口。
  await contact.click()
  await inlineEditor(page).getByRole('button', { name: '更多参数' }).click()
  await expect(inlineEditor(page)).toBeHidden()
  await expect(details).toBeVisible()
  await expect(details.getByRole('tab', { name: '属性' })).toHaveAttribute('aria-selected', 'true')

  expect(errors, errors.join('\n')).toEqual([])
})

test('拖到自选位置后就地编辑器在重新打开时回到记录位置', async ({ page }) => {
  const errors = trackPageErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const contact = await openFirstContact(page)
  const inline = inlineEditor(page)
  const before = await inline.boundingBox()
  const header = inline.locator('.inline-operand-head')
  const headerBox = await header.boundingBox()
  expect(before).not.toBeNull()
  expect(headerBox).not.toBeNull()

  const startX = headerBox!.x + Math.min(45, headerBox!.width / 2)
  const startY = headerBox!.y + headerBox!.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 150, startY + 70, { steps: 8 })
  await page.mouse.up()
  await expect(inline).toHaveClass(/is-pinned/)
  const moved = await inline.boundingBox()
  expect(moved).not.toBeNull()
  expect(Math.abs(moved!.x - before!.x) + Math.abs(moved!.y - before!.y)).toBeGreaterThan(40)

  await inline.getByRole('button', { name: '关闭操作数编辑' }).click()
  await expect(inline).toBeHidden()
  await contact.click()
  await expect(inline).toBeVisible()
  await expect.poll(async () => {
    const reopened = await inline.boundingBox()
    if (!reopened) return Number.POSITIVE_INFINITY
    return Math.max(Math.abs(reopened.x - moved!.x), Math.abs(reopened.y - moved!.y))
  }).toBeLessThanOrEqual(2)

  expect(errors, errors.join('\n')).toEqual([])
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1840, height: 1034 },
  { width: 390, height: 844 },
]) {
  test(`就地操作数在 ${viewport.width}×${viewport.height} 视口内不裁切`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.setViewportSize(viewport)
    await openHome(page)
    await loadCourseExperiment(page, '02 定时器与计数器')

    await openFirstContact(page)
    const inline = inlineEditor(page)
    const box = await inline.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5)
    await expect(page.locator('#wb-context-panel')).toHaveCount(0)
    await expectCanvasCentered(page)

    expect(errors, errors.join('\n')).toEqual([])
  })
}

