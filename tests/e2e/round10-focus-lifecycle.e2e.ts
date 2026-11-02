import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { openHome, openProjectDialog } from './support'

type ExitProbe = {
  sawClosing: boolean
  removed: boolean
  closingAt: number | null
  removedAt: number | null
}

type ProbeWindow = Window & {
  __round10ExitProbe?: ExitProbe
  __round10ExitObserver?: MutationObserver
}

async function prepare(page: Page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport)
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await openHome(page)
}

async function activeFocus(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement
    const element = active instanceof HTMLElement ? active : null
    const dialog = element?.closest<HTMLElement>('[role="dialog"]') ?? null
    return {
      tag: element?.tagName ?? null,
      id: element?.id || null,
      className: typeof element?.className === 'string' ? element.className : null,
      ariaLabel: element?.getAttribute('aria-label') ?? null,
      text: element?.innerText?.trim().replace(/\s+/g, ' ').slice(0, 120) ?? null,
      isBody: active === document.body,
      insideDialog: Boolean(dialog),
      dialogName: dialog?.getAttribute('aria-label')
        ?? (dialog?.getAttribute('aria-labelledby')
          ? document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent?.trim() ?? null
          : null),
    }
  })
}

async function attachFocus(page: Page, name: string) {
  const snapshot = await activeFocus(page)
  await test.info().attach(name, {
    body: JSON.stringify(snapshot, null, 2),
    contentType: 'application/json',
  })
  return snapshot
}

async function startExitProbe(page: Page, selector: string) {
  await page.evaluate((panelSelector) => {
    const target = document.querySelector<HTMLElement>(panelSelector)
    if (!target) throw new Error(`找不到退场目标：${panelSelector}`)
    const host = window as unknown as ProbeWindow
    host.__round10ExitObserver?.disconnect()
    host.__round10ExitProbe = {
      sawClosing: false,
      removed: false,
      closingAt: null,
      removedAt: null,
    }

    const inspect = () => {
      const backdrop = target.closest<HTMLElement>('[class*="backdrop"]')
      const probe = host.__round10ExitProbe
      if (!probe) return
      const closing = target.classList.contains('is-closing')
        || Boolean(backdrop?.classList.contains('is-closing'))
        || target.parentElement?.classList.contains('is-closing') === true
      if (closing && !probe.sawClosing) {
        probe.sawClosing = true
        probe.closingAt = performance.now()
      }
      if (!target.isConnected && !probe.removed) {
        probe.removed = true
        probe.removedAt = performance.now()
      }
    }

    inspect()
    const observer = new MutationObserver(inspect)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-state'],
      childList: true,
      subtree: true,
    })
    host.__round10ExitObserver = observer
  }, selector)
}

async function readExitProbe(page: Page): Promise<ExitProbe> {
  return page.evaluate(() => {
    const host = window as unknown as ProbeWindow
    return host.__round10ExitProbe ?? {
      sawClosing: false,
      removed: false,
      closingAt: null,
      removedAt: null,
    }
  })
}

async function openBackupDialog(page: Page) {
  await openProjectDialog(page)
  const drawer = page.getByRole('dialog', { name: '项目' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: /^整包备份/ }).click()
  const dialog = page.getByRole('dialog', { name: '整包备份' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openRecoveryDialog(page: Page) {
  await openProjectDialog(page)
  const drawer = page.getByRole('dialog', { name: '项目' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: /^安全副本/ }).click()
  const dialog = page.getByRole('dialog', { name: '本机安全副本' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('手机项目抽屉在退场中可立即重开，退场结束后归还焦点', async ({ page }) => {
  await prepare(page, { width: 390, height: 844 })
  const opener = page.locator('.mobile-tab-action').filter({ hasText: '项目' })
  await opener.click()

  const drawer = page.getByRole('dialog', { name: '项目' })
  const backdrop = page.locator('.wb-drawer-backdrop')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: '关闭项目' }).click()

  await expect(backdrop).toHaveAttribute('data-state', 'closing')
  expect(await drawer.evaluate((element) => element.hasAttribute('inert'))).toBe(true)
  await expect(drawer).not.toHaveAttribute('aria-modal', 'true')

  await opener.click()
  await page.waitForTimeout(420)
  await expect(drawer).toBeVisible()
  await expect(backdrop).toHaveAttribute('data-state', 'open')
  await expect(drawer.getByRole('button', { name: '关闭项目' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(backdrop).toHaveAttribute('data-state', 'closing')
  await expect(backdrop).toHaveCount(0, { timeout: 1200 })
  await expect(opener).toBeFocused()
})

test('抽屉退场时立即打开配色面板，焦点不会被旧弹层抢回', async ({ page }) => {
  await prepare(page, { width: 390, height: 844 })
  const opener = page.locator('.mobile-tab-action').filter({ hasText: '项目' })
  await opener.click()

  const drawer = page.getByRole('dialog', { name: '项目' })
  await drawer.getByRole('button', { name: '关闭项目' }).click()
  await page.locator('.wb-theme-button').click()

  const theme = page.getByRole('dialog', { name: '配色外观' })
  const selected = theme.locator('[role="radio"][aria-checked="true"]')
  await expect(theme).toBeVisible()
  await expect(selected).toBeFocused()
  await page.waitForTimeout(420)
  await expect(selected).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(theme).toHaveCount(0)
  await expect(page.locator('.wb-theme-button')).toBeFocused()
})

test('手机抽屉打开变量表后关闭属性面板，焦点回到项目标签', async ({ page }) => {
  await prepare(page, { width: 390, height: 844 })
  const projectTab = page.locator('.mobile-tab-action').filter({ hasText: '项目' })
  await projectTab.click()
  await page.getByRole('dialog', { name: '项目' }).getByRole('button', { name: /变量表/ }).click()

  const inspector = page.getByRole('dialog', { name: '属性与变量' })
  await expect(inspector).toBeVisible()
  await inspector.getByRole('button', { name: '关闭属性面板' }).click()
  await expect(inspector).toHaveCount(0)
  await attachFocus(page, '关闭手机属性面板后的焦点')
  await expect(projectTab).toBeFocused()
})

test('等抽屉退场完成再关闭手机属性面板，焦点可回到项目标签', async ({ page }) => {
  await prepare(page, { width: 390, height: 844 })
  const projectTab = page.locator('.mobile-tab-action').filter({ hasText: '项目' })
  await projectTab.click()
  await page.getByRole('dialog', { name: '项目' }).getByRole('button', { name: /变量表/ }).click()

  const inspector = page.getByRole('dialog', { name: '属性与变量' })
  await expect(inspector).toBeVisible()
  await page.waitForTimeout(380)
  await inspector.getByRole('button', { name: '关闭属性面板' }).click()
  await expect(inspector).toHaveCount(0)
  await expect(projectTab).toBeFocused()
})

test('导入弹窗的 Tab 顺序首尾相接，Esc 立即释放焦点陷阱', async ({ page }) => {
  await prepare(page)
  const opener = page.getByRole('button', { name: '导入工程文件', exact: true })
  await opener.click()

  const dialog = page.getByRole('dialog', { name: '导入工程' })
  const backdrop = page.locator('.project-import-backdrop')
  const choose = dialog.getByRole('button', { name: '选择文件', exact: true })
  const summary = dialog.locator('.project-import-paste > summary')
  const close = dialog.getByRole('button', { name: '关闭导入工程' })
  await expect(choose).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(summary).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(choose).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(summary).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(backdrop).toHaveAttribute('data-state', 'closing')
  expect(await dialog.evaluate((element) => element.hasAttribute('inert'))).toBe(true)
  await expect(dialog).not.toHaveAttribute('aria-modal', 'true')
  await expect(opener).toBeFocused()

  await page.keyboard.press('Tab')
  const afterTab = await attachFocus(page, '退场弹层释放监听后的焦点')
  expect(afterTab.insideDialog).toBe(false)
})

test('整包备份空库时优先把焦点交给可用的恢复入口', async ({ page }) => {
  await prepare(page)
  const dialog = await openBackupDialog(page)
  await expect(dialog.getByRole('button', { name: /^从备份恢复/ })).toBeFocused()
})

test('整包备份关闭时保留弹层播放退场，并在结束后卸载', async ({ page }) => {
  await prepare(page)
  const dialog = await openBackupDialog(page)
  await startExitProbe(page, 'section[aria-labelledby="project-backup-title"]')
  await dialog.getByRole('button', { name: '关闭整包备份' }).click()
  await expect.poll(async () => (await readExitProbe(page)).removed).toBe(true)

  const probe = await readExitProbe(page)
  expect(probe.sawClosing).toBe(true)
  expect(probe.closingAt).not.toBeNull()
  expect(probe.removedAt).not.toBeNull()
  expect(probe.removedAt! - probe.closingAt!).toBeGreaterThanOrEqual(120)
})

test('安全副本关闭时播放退场并把焦点还给入口', async ({ page }) => {
  await prepare(page)
  const dialog = await openRecoveryDialog(page)
  await expect(dialog.getByText('目前没有自动快照', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '关闭本机安全副本' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '完成', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '关闭本机安全副本' })).toBeFocused()

  await startExitProbe(page, 'section[aria-labelledby="recovery-backups-title"]')
  await dialog.getByRole('button', { name: '关闭本机安全副本' }).click()
  await expect.poll(async () => (await readExitProbe(page)).removed).toBe(true)
  const probe = await readExitProbe(page)
  expect(probe.sawClosing).toBe(true)
  expect(probe.closingAt).not.toBeNull()
  expect(probe.removedAt).not.toBeNull()
  expect(probe.removedAt! - probe.closingAt!).toBeGreaterThanOrEqual(120)
})

test('实验库载入确认只让顶层弹层可交互', async ({ page }) => {
  await prepare(page)
  await openProjectDialog(page)
  const drawer = page.getByRole('dialog', { name: '项目' })
  await drawer.getByRole('button', { name: /实验库/ }).click()

  const library = page.getByRole('dialog', { name: '实验与示例' })
  const search = library.getByRole('searchbox', { name: '搜索实验、课设或示例' })
  await expect(library).toBeVisible()
  await expect(search).toBeFocused()

  const item = library.getByRole('button', { name: '载入01 四路抢答器' })
  await item.click()
  const confirm = page.getByRole('dialog', { name: '载入这个实验？' })
  await expect(confirm).toBeVisible()
  const cancel = confirm.getByRole('button', { name: '取消', exact: true })
  const load = confirm.getByRole('button', { name: '载入', exact: true })
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(load).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()

  const nesting = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        name: element.getAttribute('aria-label')
          ?? document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent?.trim()
          ?? '未命名',
        ariaModal: element.getAttribute('aria-modal'),
        inert: element.hasAttribute('inert'),
      }))
    return dialogs
  })
  await test.info().attach('嵌套弹层语义', {
    body: JSON.stringify(nesting, null, 2),
    contentType: 'application/json',
  })
  expect(nesting.filter((dialog) => dialog.ariaModal === 'true')).toHaveLength(1)
  expect(nesting.find((dialog) => dialog.name === '实验与示例')?.inert).toBe(true)

  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(library).toBeVisible()
  await expect(item).toBeFocused()
})

test('实验库关闭时保留退场并在结束后归还桌面入口', async ({ page }) => {
  await prepare(page)
  await openProjectDialog(page)
  await page.getByRole('dialog', { name: '项目' }).getByRole('button', { name: /实验库/ }).click()
  const library = page.getByRole('dialog', { name: '实验与示例' })
  await expect(library).toBeVisible()

  await startExitProbe(page, 'section[aria-labelledby="library-title"]')
  await library.getByRole('button', { name: '关闭实验与示例' }).click()
  await expect.poll(async () => (await readExitProbe(page)).removed).toBe(true)
  const probe = await readExitProbe(page)
  expect(probe.sawClosing).toBe(true)
  expect(probe.closingAt).not.toBeNull()
  expect(probe.removedAt).not.toBeNull()
  expect(probe.removedAt! - probe.closingAt!).toBeGreaterThanOrEqual(120)
})

test('导入成功后焦点回到导入入口，不落到页面根节点', async ({ page }) => {
  await prepare(page)
  const opener = page.getByRole('button', { name: '导入工程文件', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: '导入工程' })
  await dialog.locator('input[type="file"]').setInputFiles(
    fileURLToPath(new URL('./fixtures/self-hold.json', import.meta.url)),
  )
  await expect(dialog.getByText('E2E 分享自保持', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '导入并打开', exact: true }).click()

  await expect(page.locator('#project-name')).toHaveValue('E2E 分享自保持')
  await expect(page.locator('.project-import-backdrop')).toHaveCount(0, { timeout: 1200 })
  await expect(opener).toBeFocused()
})

test('手机文件菜单导入后记录真实焦点落点', async ({ page }) => {
  await prepare(page, { width: 390, height: 844 })
  await page.getByRole('button', { name: '文件：新建、导入或导出' }).click()
  await page.getByRole('menuitem', { name: '导入工程文件', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导入工程' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '关闭导入工程' }).click()
  await page.waitForTimeout(220)

  const focus = await attachFocus(page, '手机文件菜单导入关闭后的焦点')
  expect(focus.isBody).toBe(false)
})
