import { expect, test } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

test('画布加号插入时保留右侧参数面板，并补全当前段上下文', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  await page.locator('.ll-node[data-node-id]').first().click()
  const panel = page.locator('.qe-panel')
  await expect(panel).toBeVisible()
  const selectedLabel = await panel.getAttribute('aria-label')
  expect(selectedLabel).toMatch(/^编辑/)
  await expect(panel.getByRole('region', { name: '当前程序段概览' })).toBeVisible()
  await expect(panel.getByText('本段运行读数')).toBeVisible()
  await panel.evaluate((element) => {
    (element as HTMLElement & { __qePersistProbe?: string }).__qePersistProbe = 'same-node'
  })

  const slot = page.locator('.ll-rung').first().locator('.ll-slot').first()
  await slot.hover()
  const hit = slot.locator('.ll-slot-plus-hit')
  const hitBox = await hit.boundingBox()
  expect(hitBox).not.toBeNull()
  await page.mouse.click(hitBox!.x + hitBox!.width / 2, hitBox!.y + hitBox!.height / 2)

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', selectedLabel!)

  // 先验证 Esc 只关插入菜单；参数面板必须继续停在原来的对象上。
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', selectedLabel!)
  await expect.poll(() => page.evaluate(
    () => document.activeElement?.getAttribute('aria-label'),
  )).toContain('程序段 1')

  await slot.hover()
  const nextHitBox = await hit.boundingBox()
  expect(nextHitBox).not.toBeNull()
  await page.mouse.click(nextHitBox!.x + nextHitBox!.width / 2, nextHitBox!.y + nextHitBox!.height / 2)
  await menu.getByRole('menuitem', { name: /常开触点/ }).click()

  // 插入成功后参数面板原节点继续挂载，只切换编辑对象。
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', /^编辑常开触点/)
  await expect(panel.getByRole('region', { name: '当前程序段概览' })).toBeVisible()
  expect(await panel.evaluate((element) => (
    element as HTMLElement & { __qePersistProbe?: string }
  ).__qePersistProbe)).toBe('same-node')

  // 只有面板自己的关闭按钮才收起它。
  await panel.getByRole('button', { name: '关闭参数编辑' }).click()
  await expect(panel).toBeHidden()

  expect(errors, errors.join('\n')).toEqual([])
})

test('收藏指令插入后继续停在参数面板，并聚焦新操作数', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  await page.locator('.ll-node[data-node-id]').first().click()
  const panel = page.locator('.qe-panel.is-dock')
  await expect(panel).toBeVisible()

  const slot = page.locator('.ll-rung').first().locator('.ll-slot').first()
  await slot.hover()
  const hit = slot.locator('.ll-slot-plus-hit')
  const hitBox = await hit.boundingBox()
  expect(hitBox).not.toBeNull()
  await page.mouse.click(hitBox!.x + hitBox!.width / 2, hitBox!.y + hitBox!.height / 2)
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')

  const favorite = page
    .locator('.wb-instruction-strip')
    .getByRole('button', { name: /^常开触点，点击插入到程序段 1/ })
  await favorite.click()

  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', /^编辑常开触点/)
  await expect.poll(() => page.evaluate(() => (
    document.activeElement instanceof HTMLElement
    && document.activeElement.dataset.primary === 'true'
  ))).toBe(true)
  await expect(panel.getByRole('region', { name: '当前程序段概览' })).toBeVisible()

  expect(errors, errors.join('\n')).toEqual([])
})

test('连续两次从画布加号插入，每次都聚焦新元件的操作数', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')
  await page.locator('.ll-node[data-node-id]').first().click()

  const panel = page.locator('.qe-panel.is-dock')
  const slot = page.locator('.ll-rung').first().locator('.ll-slot').first()

  await slot.hover()
  let hitBox = await slot.locator('.ll-slot-plus-hit').boundingBox()
  expect(hitBox).not.toBeNull()
  await page.mouse.click(hitBox!.x + hitBox!.width / 2, hitBox!.y + hitBox!.height / 2)
  await page.getByRole('menu').getByRole('menuitem', { name: /常开触点/ }).click()

  await expect(panel).toHaveAttribute('aria-label', /^编辑常开触点/)
  await expect(panel.locator('input[data-primary="true"]')).toBeFocused()

  await slot.hover()
  hitBox = await slot.locator('.ll-slot-plus-hit').boundingBox()
  expect(hitBox).not.toBeNull()
  await page.mouse.click(hitBox!.x + hitBox!.width / 2, hitBox!.y + hitBox!.height / 2)
  await page.getByRole('menu').getByRole('menuitem', { name: /常闭触点/ }).click()

  await expect(panel).toHaveAttribute('aria-label', /^编辑常闭触点/)
  await expect(panel.locator('input[data-primary="true"]')).toBeFocused()

  expect(errors, errors.join('\n')).toEqual([])
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 700 },
  { width: 1024, height: 768 },
  { width: 1440, height: 560 },
]) {
  test(`右侧参数面板在 ${viewport.width}×${viewport.height} 时保留底部提示`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.setViewportSize(viewport)

    await openHome(page)
    await loadCourseExperiment(page, '02 定时器与计数器')
    await page.locator('.ll-node[data-node-id]').first().click()

    const panel = page.locator('.qe-panel.is-dock')
    const footer = panel.locator('.qe-foot')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('region', { name: '当前程序段概览' })).toBeVisible()
    await expect(footer).toBeInViewport()

    const panelBox = await panel.boundingBox()
    const footerBox = await footer.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(footerBox).not.toBeNull()
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(
      Math.min(panelBox!.y + panelBox!.height, viewport.height) + 0.5,
    )

    const scroll = panel.locator('.qe-scroll')
    await expect(scroll).toHaveCSS('overflow-y', 'auto')
    const scrollMetrics = await scroll.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth)
    expect(errors, errors.join('\n')).toEqual([])
  })
}

test('切换编辑对象时参数面板回到表单顶部', async ({ page }) => {
  const errors = trackPageErrors(page)
  await page.setViewportSize({ width: 1180, height: 700 })

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  await page.locator('.ll-rung').nth(1).locator('[data-output-id]').click()
  const panel = page.locator('.qe-panel.is-dock')
  const scroll = panel.locator('.qe-scroll')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', /接通延时 TON/)
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  await page.locator('.ll-node[data-node-id]').first().click()
  await expect(panel).toHaveAttribute('aria-label', /^编辑常闭触点/)
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0)

  expect(errors, errors.join('\n')).toEqual([])
})
