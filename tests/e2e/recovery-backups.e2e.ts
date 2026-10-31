import { expect, test, type Page } from '@playwright/test'
import { openHome, trackPageErrors } from './support'

const RECOVERY_KEY = 'ladderlab.project.v1.recovery.2025-02-02T09:30:00.000Z'

/** 把当前自动保存的草稿复制成一份本机安全副本，模拟“上次编辑留下的快照”。 */
async function seedRecoveryBackup(page: Page): Promise<void> {
  // 先落一次真实编辑，让自动保存把草稿写进 localStorage。
  await page.getByRole('button', { name: '新建空白工程' }).click()
  const createDialog = page.getByRole('dialog', { name: '新建工程' })
  await expect(createDialog).toBeVisible()
  await createDialog.locator('#new-project-name').fill('安全副本取样工程')
  await createDialog.getByRole('button', { name: '新建', exact: true }).click()
  await expect(createDialog).toBeHidden()

  await expect
    .poll(() =>
      page.evaluate(() => {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index)
          const value = key ? window.localStorage.getItem(key) : null
          if (value?.includes('"rungs"')) return true
        }
        return false
      }),
    )
    .toBe(true)

  await page.evaluate((recoveryKey) => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      const value = key ? window.localStorage.getItem(key) : null
      if (!value?.includes('"rungs"')) continue
      window.localStorage.setItem(recoveryKey, value)
      return
    }
    throw new Error('没有找到自动保存草稿，无法伪造安全副本')
  }, RECOVERY_KEY)
}

async function reloadHome(page: Page): Promise<void> {
  await page.reload()
  await expect(page.getByRole('heading', { name: '梯形实验室' })).toBeVisible()
  const dismissCoach = page.getByRole('button', { name: '关闭快速上手' })
  if (await dismissCoach.isVisible().catch(() => false)) await dismissCoach.click()
}

async function openRecoveryDialog(page: Page) {
  await page.getByRole('button', { name: '更多操作' }).click()
  const moreMenu = page.getByRole('menu', { name: '更多操作' })
  await expect(moreMenu).toBeVisible()
  await moreMenu.getByRole('menuitem', { name: /^安全副本/ }).click()
  const dialog = page.getByRole('dialog', { name: '本机安全副本' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('启动时不再用横幅挡住程序区，安全副本收进「更多」菜单', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await seedRecoveryBackup(page)
  await reloadHome(page)

  // 旧版会在这里插一条横贯画布的备份条，把程序块盖住。
  await expect(page.locator('.backup-strip')).toHaveCount(0)

  const dialog = await openRecoveryDialog(page)
  await expect(dialog.locator('.recovery-backups-list > li')).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: '下载' })).toBeVisible()

  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate((key) => window.localStorage.getItem(key), RECOVERY_KEY)).not.toBeNull()
  expect(errors).toEqual([])
})

test('手机端可以从项目抽屉打开安全副本', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await seedRecoveryBackup(page)
  // 先按桌面尺寸把快照写进去，再切到手机宽度验证抽屉入口。
  await page.setViewportSize({ width: 390, height: 844 })
  await reloadHome(page)

  await page.getByRole('button', { name: '项目', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '项目' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: /^安全副本/ }).click()

  const dialog = page.getByRole('dialog', { name: '本机安全副本' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.recovery-backups-list > li')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('在弹窗里可以下载并删除安全副本，删除后刷新也不再出现', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await seedRecoveryBackup(page)
  await reloadHome(page)

  const dialog = await openRecoveryDialog(page)
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await dialog.getByRole('button', { name: '下载' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain('恢复副本')

  await dialog.getByRole('button', { name: /^删除 / }).click()
  const confirm = page.getByRole('dialog', { name: '删除这份安全副本？' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '删除', exact: true }).click()

  await expect(dialog.locator('.recovery-backups-empty')).toBeVisible()
  expect(await page.evaluate((key) => window.localStorage.getItem(key), RECOVERY_KEY)).toBeNull()

  await dialog.getByRole('button', { name: '完成' }).click()
  await reloadHome(page)
  await expect(page.locator('.backup-strip')).toHaveCount(0)
  expect(
    await page.evaluate((key) => window.localStorage.getItem(key), RECOVERY_KEY),
  ).toBeNull()
  expect(errors).toEqual([])
})
