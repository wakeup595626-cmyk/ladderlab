import { expect, test } from '@playwright/test'
import { exportButton, openHome, trackPageErrors } from './support'

test('首屏无脚本错误，并显示主要工程入口', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)

  await expect(page.getByRole('button', { name: '打开项目' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建空白工程' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存到本机项目库' })).toBeVisible()
  await expect(exportButton(page)).toBeVisible()

  await page.waitForLoadState('networkidle')
  expect(errors, errors.join('\n')).toEqual([])
})
