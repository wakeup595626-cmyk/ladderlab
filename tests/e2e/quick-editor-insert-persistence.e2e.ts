import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

function inlineEditor(page: Page) {
  return page.locator('[data-inline-operand-editor]')
}

function inlineInput(page: Page) {
  return page.locator('[data-inline-operand-editor] input[data-inline-input]')
}

async function openFirstSlotMenu(page: Page): Promise<void> {
  const slot = page.locator('.ll-rung').first().locator('.ll-slot').first()
  await slot.hover()
  const hit = slot.locator('.ll-slot-plus-hit')
  const hitBox = await hit.boundingBox()
  expect(hitBox).not.toBeNull()
  await page.mouse.click(hitBox!.x + hitBox!.width / 2, hitBox!.y + hitBox!.height / 2)
  await expect(page.getByRole('menu')).toBeVisible()
}

async function insertFirstSlot(page: Page, name: RegExp): Promise<void> {
  await openFirstSlotMenu(page)
  await page.getByRole('menu').getByRole('menuitem', { name }).click()
}

test('画布加号插入后自动进入就地编辑，Esc 只收起插入菜单', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const firstNode = page.locator('.ll-node[data-node-id]').first()
  await firstNode.click()
  const inline = inlineEditor(page)
  const input = inlineInput(page)
  const originalNodeId = await inline.getAttribute('data-node-id')
  await expect(inline).toBeVisible()
  await expect(input).toBeFocused()
  await expect(page.locator('#wb-context-panel')).toHaveCount(0)

  await openFirstSlotMenu(page)
  await expect(inline).toBeVisible()
  await expect(inline).toHaveAttribute('data-node-id', originalNodeId!)

  // 先验证 Esc 只关插入菜单；就地编辑继续保持，不切回整块参数面板。
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(inline).toBeVisible()
  await expect(input).toBeFocused()

  await insertFirstSlot(page, /常开触点/)
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(page.locator('#wb-context-panel')).toHaveCount(0)
  await expect(inline).toBeVisible()
  await expect(inline).toHaveCount(1)
  await expect(input).toBeFocused()
  await expect(inline).toHaveAttribute('data-node-id', /.+/)
  expect(await inline.getAttribute('data-node-id')).not.toBe(originalNodeId)

  await inline.getByRole('button', { name: '关闭操作数编辑' }).click()
  await expect(inline).toBeHidden()

  expect(errors, errors.join('\n')).toEqual([])
})

test('收藏指令插入后只打开就地编辑，并聚焦新操作数', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  await page.locator('.ll-node[data-node-id]').first().click()
  await openFirstSlotMenu(page)
  await page.keyboard.press('Escape')

  const favorite = page
    .locator('.wb-instruction-strip')
    .getByRole('button', { name: /^常开触点，点击插入到程序段 1/ })
  await favorite.click()

  const inline = inlineEditor(page)
  await expect(inline).toBeVisible()
  await expect(inline).toHaveCount(1)
  await expect(inlineInput(page)).toBeFocused()
  await expect(page.locator('#wb-context-panel')).toHaveCount(0)

  expect(errors, errors.join('\n')).toEqual([])
})

test('连续两次从画布加号插入，每次都聚焦新元件的操作数', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')
  await page.locator('.ll-node[data-node-id]').first().click()

  const inline = inlineEditor(page)
  const input = inlineInput(page)

  await insertFirstSlot(page, /常开触点/)
  await expect(inline).toBeVisible()
  const firstInserted = await inline.getAttribute('data-node-id')
  await expect(input).toBeFocused()
  // 新插入的触点会拿到自动分配的位置地址（输入区或输出区），而不是空串。
  await expect(input).toHaveValue(/^%[IQM]\d+\.\d$/)

  await insertFirstSlot(page, /常闭触点/)
  await expect(inline).toHaveCount(1)
  await expect(inline).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(/^%[IQM]\d+\.\d$/)
  expect(await inline.getAttribute('data-node-id')).not.toBe(firstInserted)

  expect(errors, errors.join('\n')).toEqual([])
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 700 },
  { width: 1024, height: 768 },
  { width: 1440, height: 560 },
]) {
  test(`完整参数在 ${viewport.width}×${viewport.height} 时可打开、可关闭且不超出视口`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.setViewportSize(viewport)

    await openHome(page)
    await loadCourseExperiment(page, '02 定时器与计数器')
    await page.locator('.ll-node[data-node-id]').first().dblclick()

    const panel = page.locator('#wb-context-panel')
    await expect(panel).toBeVisible()
    // 双击走的是“完整参数”入口，就地气泡应当让位给右侧属性面板。
    await expect(page.locator('[data-inline-operand-editor]')).toBeHidden()

    if (viewport.width > 1024) {
      const panelBox = await panel.boundingBox()
      expect(panelBox).not.toBeNull()
      expect(panelBox!.x).toBeGreaterThanOrEqual(0)
      expect(panelBox!.y).toBeGreaterThanOrEqual(0)
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width + 0.5)
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height + 0.5)
    }

    await panel.getByRole('button', { name: '关闭属性面板' }).click()
    await expect(panel).toBeHidden()
    expect(errors, errors.join('\n')).toEqual([])
  })
}

test('切换单击目标时就地编辑跟随元件并重新聚焦，不出现第二个输入框', async ({ page }) => {
  const errors = trackPageErrors(page)
  await page.setViewportSize({ width: 1180, height: 700 })

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const inline = inlineEditor(page)
  const input = inlineInput(page)
  await page.locator('.ll-rung').nth(1).locator('[data-output-id]').click()
  await expect(inline).toBeVisible()
  await expect(inline).toHaveAttribute('data-output-id', /.+/)
  await expect(input).toBeFocused()
  const outputTarget = await inline.getAttribute('data-output-id')

  await page.locator('.ll-node[data-node-id]').first().click()
  await expect(inline).toHaveCount(1)
  await expect(inline).toHaveAttribute('data-node-id', /.+/)
  await expect(inline).not.toHaveAttribute('data-output-id', outputTarget!)
  await expect(input).toBeFocused()
  await expect(page.locator('#wb-context-panel')).toHaveCount(0)

  expect(errors, errors.join('\n')).toEqual([])
})

