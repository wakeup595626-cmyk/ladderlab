import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, openProjectDialog, trackPageErrors } from './support'

async function openImportDialog(page: Page) {
  const opener = page.getByRole('button', { name: '导入工程文件', exact: true }).first()
  await opener.click()
  const dialog = page.getByRole('dialog', { name: '导入工程' })
  await expect(dialog).toBeVisible()
  return { opener, dialog, backdrop: page.locator('.project-import-backdrop') }
}

async function countBannerLandmarks(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    return nodes.filter((node) => !node.ignored && node.role?.value === 'banner').length
  } finally {
    await cdp.detach()
  }
}

async function rgbContrast(page: Page, foreground: string, background: string) {
  return page.evaluate(({ foreground: fg, background: bg }) => {
    const parse = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
      if (!channels || channels.length !== 3) throw new Error(`无法解析颜色：${value}`)
      return channels
    }
    const luminance = (value: string) => {
      const [r, g, b] = parse(value).map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const first = luminance(fg)
    const second = luminance(bg)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  }, { foreground, background })
}

test('导入弹窗播放完退场动画后才卸载，并把焦点还给入口', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  const { opener, dialog, backdrop } = await openImportDialog(page)

  await dialog.getByRole('button', { name: '关闭导入工程' }).click()
  await expect(backdrop).toHaveAttribute('data-state', 'closing')
  const exit = await backdrop.evaluate((element) => {
    const panel = element.querySelector<HTMLElement>('.project-import-dialog')
    if (!panel) return null
    return {
      backdropTransition: getComputedStyle(element).transitionProperty,
      panelTransition: getComputedStyle(panel).transitionProperty,
      pointerEvents: getComputedStyle(element).pointerEvents,
    }
  })
  expect(exit).not.toBeNull()
  expect(exit!.backdropTransition).toContain('opacity')
  expect(exit!.panelTransition).toContain('opacity')
  expect(exit!.panelTransition).toContain('transform')
  expect(exit!.pointerEvents).toBe('none')

  await expect(backdrop).toHaveCount(0, { timeout: 1200 })
  await expect(opener).toBeFocused()
  expect(errors, errors.join('\n')).toEqual([])
})

test('手机项目抽屉从底部退场，结束后卸载并归还焦点', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openHome(page)
  const opener = page.locator('.mobile-tab-action').filter({ hasText: '项目' })
  await opener.click()
  const drawer = page.getByRole('dialog', { name: '项目' })
  const backdrop = page.locator('.wb-drawer-backdrop')
  await expect(drawer).toBeVisible()

  await drawer.getByRole('button', { name: '关闭项目' }).click()
  await expect(backdrop).toHaveAttribute('data-state', 'closing')
  await page.waitForTimeout(120)
  const exit = await drawer.evaluate((element) => ({
    opacity: Number.parseFloat(getComputedStyle(element).opacity),
    transform: getComputedStyle(element).transform,
    pointerEvents: getComputedStyle(element.parentElement!).pointerEvents,
  }))
  expect(exit.transform).not.toBe('none')
  expect(exit.transform).toContain('1')
  expect(exit.pointerEvents).toBe('none')

  await expect(backdrop).toHaveCount(0, { timeout: 1200 })
  await expect(opener).toBeFocused()
})

test('减少动态效果时弹层不位移并立即关闭、归还焦点', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openHome(page)
  const { opener, dialog, backdrop } = await openImportDialog(page)

  const motion = await dialog.evaluate((element) => ({
    transform: getComputedStyle(element).transform,
    transitionProperty: getComputedStyle(element).transitionProperty,
  }))
  expect(motion.transform).toBe('none')
  expect(motion.transitionProperty).not.toContain('transform')

  const startedAt = Date.now()
  await dialog.getByRole('button', { name: '关闭导入工程' }).click()
  // reduced-motion 下没有退场位移，也没有需要等待的计时器：关闭应当是即时的。
  await expect(backdrop).toHaveCount(0, { timeout: 300 })
  expect(Date.now() - startedAt).toBeLessThan(300)
  await expect(opener).toBeFocused()
})

test('768px 引导条保持单行，按钮不被挤成竖排', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '梯形实验室' })).toBeVisible()

  const coach = page.locator('.wb-coach')
  await expect(coach.locator('.wb-coach-compact')).toBeVisible()
  await expect(coach.locator('.wb-coach-path')).toBeHidden()
  const geometry = await coach.getByRole('button', { name: '关闭快速上手' }).evaluate((button) => {
    const rect = button.getBoundingClientRect()
    const label = button.querySelector<HTMLElement>('span')
    return {
      width: rect.width,
      height: rect.height,
      labelWidth: label?.getBoundingClientRect().width ?? 0,
      whiteSpace: getComputedStyle(button).whiteSpace,
    }
  })
  expect(geometry.whiteSpace).toBe('nowrap')
  expect(geometry.width).toBeGreaterThan(geometry.height)
  expect(geometry.labelWidth).toBeGreaterThan(20)
})

test('320px 主题说明完整换行，六套选中说明都达到正文对比度', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openHome(page)
  await page.getByRole('button', { name: /配色外观，当前/ }).click()
  const menu = page.getByRole('dialog', { name: '配色外观' })
  await expect(menu).toBeVisible()

  for (const name of ['原版绿', '冰湖青', '晴空蓝', '薄荷绿', '晨雾紫', '樱花粉']) {
    await menu.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
    const selected = menu.locator('.wb-theme-option[aria-checked="true"]')
    await expect(selected).toContainText(name)
    const note = selected.locator('.wb-theme-option-note')
    const reading = await note.evaluate((element) => {
      const option = element.closest<HTMLElement>('.wb-theme-option')!
      const style = getComputedStyle(element)
      return {
        whiteSpace: style.whiteSpace,
        opacity: Number.parseFloat(style.opacity),
        clipped: element.scrollHeight > element.clientHeight + 1,
        color: style.color,
        background: getComputedStyle(option).backgroundColor,
      }
    })
    expect(reading.whiteSpace, name).toBe('normal')
    expect(reading.opacity, name).toBe(1)
    expect(reading.clipped, name).toBe(false)
    expect(await rgbContrast(page, reading.color, reading.background), name).toBeGreaterThanOrEqual(4.5)
  }
})

test('原版绿状态栏免责声明与背景达到 4.5:1', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHome(page)
  await page.getByRole('button', { name: /配色外观，当前/ }).click()
  const menu = page.getByRole('dialog', { name: '配色外观' })
  await menu.getByRole('radio', { name: /^原版绿/ }).click()
  await page.keyboard.press('Escape')

  const colors = await page.locator('.wb-statusbar .status-disclaimer').evaluate((element) => {
    let backgroundNode: HTMLElement | null = element as HTMLElement
    let background = 'rgba(0, 0, 0, 0)'
    while (backgroundNode) {
      background = getComputedStyle(backgroundNode).backgroundColor
      if (!background.endsWith(', 0)') && background !== 'transparent') break
      backgroundNode = backgroundNode.parentElement
    }
    return { color: getComputedStyle(element).color, background }
  })
  expect(await rgbContrast(page, colors.color, colors.background)).toBeGreaterThanOrEqual(4.5)
})

test('手机打赏浮标让开加高后的状态栏和底部导航', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport)
    await openHome(page)
    // The chrome settles after its short entrance transform. Measure the
    // resting geometry so this test checks persistent spacing, not one frame
    // in the middle of the opening animation.
    await page.locator('.wb-statusbar').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})))
    })
    const geometry = await page.evaluate(() => {
      const badge = document.querySelector('.support-badge')?.getBoundingClientRect()
      const status = document.querySelector('.wb-statusbar')?.getBoundingClientRect()
      const tabs = document.querySelector('.wb-tabbar')?.getBoundingClientRect()
      return {
        badgeBottom: badge?.bottom ?? 0,
        statusTop: status?.top ?? 0,
        tabsTop: tabs?.top ?? 0,
        statusHeight: status?.height ?? 0,
      }
    })
    expect(geometry.statusHeight).toBeGreaterThanOrEqual(45)
    expect(geometry.badgeBottom).toBeLessThanOrEqual(Math.min(geometry.statusTop, geometry.tabsTop) - 7)
  }
})

test('自动草稿不会被误称为命名项目，命名保存后才进入项目库', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '01 四路抢答器')

  const draftState = page.locator('.wb-statusbar .save-state')
  await expect(draftState).toContainText(/草稿已自动保存 \d{2}:\d{2}:\d{2}/)

  await openProjectDialog(page)
  const drawer = page.getByRole('dialog', { name: '项目' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('0 个命名项目', { exact: true })).toBeVisible()
  await expect(drawer.getByText('还没有命名项目', { exact: true })).toBeVisible()
  await expect(drawer).toContainText('自动草稿只保护本页编辑')
  await drawer.getByRole('button', { name: '关闭项目' }).click()

  const projectName = 'E2E 草稿与项目库区分'
  await page.getByRole('button', { name: '保存到本机项目库' }).click()
  const saveDialog = page.getByRole('dialog', { name: '保存工程' })
  await saveDialog.getByLabel('工程名称').fill(projectName)
  await saveDialog.getByRole('button', { name: '保存到项目库' }).click()
  await expect(page.getByText(`已保存「${projectName}」到本机项目库`, { exact: true })).toBeVisible()
  await expect(saveDialog).toBeHidden()

  await openProjectDialog(page)
  const reopened = page.getByRole('dialog', { name: '项目' })
  await expect(reopened.getByText('1 个', { exact: true })).toBeVisible()
  await expect(reopened.getByRole('button', { name: new RegExp(`^${projectName}`) })).toBeVisible()
  await expect(reopened.getByText('还没有命名项目', { exact: true })).toHaveCount(0)
  expect(errors, errors.join('\n')).toEqual([])
})

test('844×390 横屏项目抽屉可滚到已存项目与帮助页脚', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHome(page)

  const projectName = 'E2E 横屏可达性'
  await page.getByRole('button', { name: '保存到本机项目库' }).click()
  const saveDialog = page.getByRole('dialog', { name: '保存工程' })
  await saveDialog.getByLabel('工程名称').fill(projectName)
  await saveDialog.getByRole('button', { name: '保存到项目库' }).click()
  await expect(saveDialog).toBeHidden()

  await page.setViewportSize({ width: 844, height: 390 })
  await openProjectDialog(page)
  const drawer = page.getByRole('dialog', { name: '项目' })
  await expect(drawer).toBeVisible()
  const savedEntry = drawer.getByRole('button', { name: new RegExp(`^${projectName}`) })
  await expect(savedEntry).toBeVisible()

  const metrics = await drawer.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }))
  expect(metrics.overflowY).toBe('auto')
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

  const about = drawer.getByRole('button', { name: /关于与数据说明/ })
  await about.scrollIntoViewIfNeeded()
  await expect(about).toBeInViewport()
  await expect(drawer.getByRole('button', { name: '三步上手' })).toBeInViewport()

  const deleteWidth = await drawer.getByRole('button', { name: `删除项目「${projectName}」` }).evaluate(
    (button) => button.getBoundingClientRect().width,
  )
  expect(deleteWidth).toBeGreaterThanOrEqual(44)
})

test('导入弹窗只保留一个 banner 地标', async ({ page }) => {
  await openHome(page)
  await openImportDialog(page)
  expect(await countBannerLandmarks(page)).toBe(1)
})

test('整包备份与安全副本弹窗都只保留一个 banner 地标', async ({ page }) => {
  await openHome(page)
  await openProjectDialog(page)
  const drawer = page.getByRole('dialog', { name: '项目' })

  await drawer.getByRole('button', { name: /^整包备份/ }).click()
  const backup = page.getByRole('dialog', { name: '整包备份' })
  await expect(backup).toBeVisible()
  expect(await countBannerLandmarks(page)).toBe(1)
  await backup.getByRole('button', { name: '关闭整包备份' }).click()
  await expect(backup).toBeHidden()

  await openProjectDialog(page)
  await page.getByRole('dialog', { name: '项目' }).getByRole('button', { name: /^安全副本/ }).click()
  const recovery = page.getByRole('dialog', { name: '本机安全副本' })
  await expect(recovery).toBeVisible()
  expect(await countBannerLandmarks(page)).toBe(1)
})

test('844×390 横屏安全副本弹窗可滚到完成按钮', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await openHome(page)
  await openProjectDialog(page)
  await page.getByRole('dialog', { name: '项目' }).getByRole('button', { name: /^安全副本/ }).click()

  const dialog = page.getByRole('dialog', { name: '本机安全副本' })
  await expect(dialog).toBeVisible()
  const metrics = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }))
  expect(metrics.overflowY).toBe('auto')
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

  const done = dialog.getByRole('button', { name: '完成' })
  await done.scrollIntoViewIfNeeded()
  await expect(done).toBeInViewport()
})
