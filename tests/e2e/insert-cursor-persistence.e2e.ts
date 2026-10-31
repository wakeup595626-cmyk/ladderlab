import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

async function findCanvasBlank(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.ll-canvas')
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const blocked = 'button, input, textarea, select, a, summary, [role="button"], '
      + '[role="menu"], [data-node-id], [data-output-id], .ll-slot, .ll-merge-chip, '
      + '.ll-node-grip, [data-drag-handle], .ll-rung-header'
    for (let y = Math.max(0, rect.top) + 12; y < Math.min(innerHeight, rect.bottom) - 12; y += 10) {
      for (let x = Math.max(0, rect.left) + 12; x < Math.min(innerWidth, rect.right) - 12; x += 10) {
        const hit = document.elementFromPoint(x, y)
        if (hit?.closest('.ll-canvas') && !hit.closest(blocked)) return { x, y }
      }
    }
    return null
  })
}

test('插入落点常驻到点击画布空白', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const insertSelect = page
    .locator('.wb-instruction-strip')
    .getByRole('combobox', { name: '选择收藏指令插入到哪个程序段' })
  await expect(insertSelect).toBeVisible()
  await insertSelect.selectOption({ label: '程序段 2' })

  const markedSlots = page.locator('.ll-slot.is-favorite-target')
  const cursorHalos = page.locator('.ll-insert-cursor-halo')
  await expect(markedSlots).toHaveCount(1)
  await expect(cursorHalos).toHaveCount(1)
  await expect(insertSelect.locator('option:checked')).toHaveText('程序段 2')

  // 旧实现会在 2.2 秒后自动熄灭；落点现在必须继续留在图纸上。
  await page.waitForTimeout(2600)
  await expect(markedSlots).toHaveCount(1)
  await expect(cursorHalos).toHaveCount(1)

  const pane = page.locator('.wb-program-pane')
  const paneBox = await pane.boundingBox()
  expect(paneBox).not.toBeNull()
  await page.mouse.move(paneBox!.x + paneBox!.width / 2, paneBox!.y + 160)
  await page.mouse.wheel(0, 180)
  await expect(markedSlots).toHaveCount(1)
  await expect(cursorHalos).toHaveCount(1)

  // 顶栏和画布元件都只是普通编辑操作，不能打断已经选好的插入位置。
  await page.locator('.wb-brand').click()
  await expect(markedSlots).toHaveCount(1)

  await page.locator('.ll-node[data-node-id]').first().click()
  await expect(markedSlots).toHaveCount(1)
  await expect(cursorHalos).toHaveCount(1)

  const blank = await findCanvasBlank(page)
  expect(blank).not.toBeNull()
  await page.mouse.click(blank!.x, blank!.y)
  await expect(markedSlots).toHaveCount(0)
  await expect(cursorHalos).toHaveCount(0)

  expect(errors, errors.join('\n')).toEqual([])
})

test('图纸加号选中的落点同样常驻到点击空白', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const slot = page.locator('.ll-rung').first().locator('.ll-slot').first()
  await slot.hover()
  const hit = slot.locator('.ll-slot-plus-hit')
  const hitBox = await hit.boundingBox()
  expect(hitBox).not.toBeNull()
  await page.mouse.click(hitBox!.x + hitBox!.width / 2, hitBox!.y + hitBox!.height / 2)
  await page.keyboard.press('Escape')

  const markedSlots = page.locator('.ll-slot.is-favorite-target')
  const cursorHalos = page.locator('.ll-insert-cursor-halo')
  await expect(markedSlots).toHaveCount(1)
  await expect(cursorHalos).toHaveCount(1)

  const pane = page.locator('.wb-program-pane')
  const paneBox = await pane.boundingBox()
  expect(paneBox).not.toBeNull()
  await page.mouse.move(paneBox!.x + paneBox!.width / 2, paneBox!.y + 160)
  await page.mouse.wheel(0, 120)
  await page.locator('.rung-nav').getByRole('button', { name: '下一程序段' }).click()
  await expect(markedSlots).toHaveCount(1)
  await expect(cursorHalos).toHaveCount(1)

  const blank = await findCanvasBlank(page)
  expect(blank).not.toBeNull()
  await page.mouse.click(blank!.x, blank!.y)
  await expect(markedSlots).toHaveCount(0)
  await expect(cursorHalos).toHaveCount(0)

  expect(errors, errors.join('\n')).toEqual([])
})
