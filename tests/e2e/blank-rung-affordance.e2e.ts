import { expect, test } from '@playwright/test'
import { openHome } from './support'

test('空白程序段只保留加号，不叠加会遮挡它的文字提示', async ({ page }) => {
  await openHome(page)
  await page.getByRole('button', { name: '新建空白工程' }).click()

  const dialog = page.getByRole('dialog', { name: '新建工程' })
  await expect(dialog).toBeVisible()
  await dialog.locator('#new-project-name').fill('空白段加号回归')
  await dialog.getByRole('button', { name: '新建', exact: true }).click()

  const placeholder = page.locator('.ll-rung.is-placeholder').last()
  await expect(placeholder).toBeVisible()
  await expect(placeholder.locator('.ll-slot-plus').first()).toBeVisible()
  await expect(page.locator('.ll-empty-hint')).toHaveCount(0)
  await expect(page.getByText('点 + 插入常开触点', { exact: true })).toHaveCount(0)
})
