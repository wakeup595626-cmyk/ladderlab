import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

async function findCanvasBlank(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.ll-canvas')
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const blocked = 'button, input, textarea, select, a, summary, [role="button"], '
      + '[role="menu"], [data-node-id], [data-output-id], .ll-slot, .ll-merge-chip, '
      + '.ll-node-grip, [data-drag-handle], .ll-rung-header, '
      + '[data-inline-operand-editor], .qe-panel'
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

test('单击只打开就地操作数，点留白关闭，双击才打开完整参数', async ({ page }) => {
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

  const inline = page.locator('[data-inline-operand-editor]')
  const input = inline.locator('input[data-inline-input]')
  await expect(inline).toBeVisible()
  await expect(inline).toHaveCount(1)
  await expect(input).toBeFocused()
  await expect(page.locator('#wb-context-panel')).toHaveCount(0)
  const initialTarget = await inline.evaluate((element) => ({
    rung: element.getAttribute('data-rung-id'),
    node: element.getAttribute('data-node-id'),
    path: element.getAttribute('data-node-path'),
  }))
  expect(initialTarget.rung).toBeTruthy()
  expect(initialTarget.node).toBeTruthy()

  const canvasBlank = await findCanvasBlank(page)
  expect(canvasBlank).not.toBeNull()
  await page.mouse.click(canvasBlank!.x, canvasBlank!.y)
  // 点图纸留白属于明确放弃编辑，气泡应收起。
  await expect(inline).toBeHidden()
  await expect(page.locator('.ll-node.is-selected, .ll-output.is-selected')).toHaveCount(0)

  // 重新打开后，点窗口留白同样收起气泡。
  await firstNode.click()
  await expect(inline).toBeVisible()
  await expect(inline).toHaveAttribute('data-rung-id', initialTarget.rung!)
  await expect(inline).toHaveAttribute('data-node-id', initialTarget.node!)
  const workbenchBlank = await findWorkbenchBlank(page)
  expect(workbenchBlank).not.toBeNull()
  await page.mouse.click(workbenchBlank!.x, workbenchBlank!.y)
  await expect(inline).toBeHidden()

  // 线路、段号和输出元件都是正常编辑操作，不应被当成留白。
  await firstNode.click()
  await expect(inline).toBeVisible()
  await expect(inline).toHaveAttribute('data-rung-id', initialTarget.rung!)

  // 线路上叠加着产品刻意保留的 44px “+”触控热区；直接派发线路自身的
  // click，验证点击线路时状态层的持久化契约，而不让热区截获测试事件。
  await page.locator('.ll-slot-wire').first().dispatchEvent('click')
  await expect(inline).toBeVisible()
  await expect(inline).toHaveAttribute('data-rung-id', initialTarget.rung!)

  await page.locator('.ll-rung-index').first().click()
  await expect(inline).toBeVisible()
  await expect(inline).toHaveAttribute('data-rung-id', initialTarget.rung!)

  await page.locator('[data-output-id]').first().click()
  await expect(inline).toBeVisible()
  await expect(inline).toHaveCount(1)
  await expect(inline).toHaveAttribute('data-output-id', /.+/)
  await expect(input).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(inline).toBeHidden()
  await expect(page.locator('#wb-context-panel')).toHaveCount(0)

  await firstNode.click()
  await expect(inline).toBeVisible()
  await inline.getByRole('button', { name: '关闭操作数编辑' }).click()
  await expect(inline).toBeHidden()

  await firstNode.dblclick()
  const details = page.locator('#wb-context-panel')
  await expect(details).toBeVisible()
  await expect(page.locator('[data-inline-operand-editor]')).toBeHidden()
  await details.getByRole('button', { name: '关闭属性面板' }).click()
  await expect(details).toBeHidden()

  expect(errors, errors.join('\n')).toEqual([])
})
