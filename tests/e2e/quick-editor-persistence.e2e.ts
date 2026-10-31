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

async function findWorkbenchBlank(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector('.wb-program-pane')
    if (!pane) return null
    const rect = pane.getBoundingClientRect()
    for (let y = Math.max(0, rect.top) + 8; y < Math.min(innerHeight, rect.bottom) - 8; y += 8) {
      for (let x = Math.max(0, rect.left) + 4; x < Math.min(innerWidth, rect.right) - 4; x += 8) {
        if (document.elementFromPoint(x, y) === pane) return { x, y }
      }
    }
    return null
  })
}

test('参数框只在点元件、关闭或 Esc 时结束', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const navBox = await page.locator('.rung-nav-rail').boundingBox()
  const sheetBox = await page.locator('.ll-program-sheet').boundingBox()
  expect(navBox).not.toBeNull()
  expect(sheetBox).not.toBeNull()
  expect(navBox!.x).toBeLessThan(sheetBox!.x)
  expect(Math.abs(navBox!.x + navBox!.width - sheetBox!.x)).toBeLessThanOrEqual(1)

  const firstNode = page.locator('.ll-node[data-node-id]').first()
  await firstNode.click()

  const panel = page.locator('.qe-panel')
  await expect(panel).toBeVisible()
  const initialLabel = await panel.getAttribute('aria-label')
  expect(initialLabel).toMatch(/^编辑/)

  const canvasBlank = await findCanvasBlank(page)
  expect(canvasBlank).not.toBeNull()
  await page.mouse.click(canvasBlank!.x, canvasBlank!.y)
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', initialLabel!)

  const workbenchBlank = await findWorkbenchBlank(page)
  expect(workbenchBlank).not.toBeNull()
  await page.mouse.click(workbenchBlank!.x, workbenchBlank!.y)
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', initialLabel!)

  await page.locator('[data-output-id]').first().click()
  await expect(panel).toBeVisible()
  expect(await panel.getAttribute('aria-label')).not.toBe(initialLabel)

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  await firstNode.click()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '关闭参数编辑' }).click()
  await expect(panel).toBeHidden()

  expect(errors, errors.join('\n')).toEqual([])
})
