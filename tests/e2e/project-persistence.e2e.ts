import { expect, test } from '@playwright/test'
import { openHome } from './support'

test('命名保存的项目在刷新后仍能从本机项目库打开', async ({ page }) => {
  const projectName = 'E2E 项目库持久化'
  await openHome(page)

  await page.getByRole('button', { name: '新建空白工程' }).click()
  const newProjectConfirm = page.getByRole('dialog', { name: '新建空白工程？' })
  await expect(newProjectConfirm).toBeVisible()
  await newProjectConfirm.getByRole('button', { name: '新建', exact: true }).click()

  await page.getByRole('button', { name: '保存到本机项目库' }).click()
  const saveDialog = page.getByRole('dialog', { name: '保存工程' })
  await expect(saveDialog).toBeVisible()
  await saveDialog.getByLabel('工程名称').fill(projectName)
  await saveDialog.getByRole('button', { name: '保存到项目库' }).click()

  await expect(saveDialog).toBeHidden()
  await expect(page.locator('#project-name')).toHaveValue(projectName)

  // 刷新后自动保存应把具名工程还原回来。
  await page.reload()
  await expect(page.getByRole('heading', { name: '梯形实验室' })).toBeVisible()
  await expect(page.locator('#project-name')).toHaveValue(projectName)

  // 切到空白工程，再从项目库把具名工程打开，证明条目真的可用而不只是被列出来。
  await page.getByRole('button', { name: '新建空白工程' }).click()
  await page.getByRole('dialog', { name: '新建空白工程？' }).getByRole('button', { name: '新建', exact: true }).click()
  await expect(page.locator('#project-name')).not.toHaveValue(projectName)

  await page.getByRole('button', { name: '打开项目' }).click()
  const projectDrawer = page.getByRole('dialog', { name: '项目' })
  await expect(projectDrawer).toBeVisible()

  // 项目库条目的无障碍名称是「工程名 + 当前/时间/段数」的组合文本。
  const savedEntry = projectDrawer.getByRole('button', { name: new RegExp(`^${projectName}`) })
  await expect(savedEntry).toBeVisible()
  await savedEntry.click()

  const openConfirm = page.getByRole('dialog', { name: `打开「${projectName}」？` })
  await expect(openConfirm).toBeVisible()
  await openConfirm.getByRole('button', { name: '打开', exact: true }).click()

  await expect(projectDrawer).toBeHidden()
  await expect(page.locator('#project-name')).toHaveValue(projectName)
  await expect(page.getByText(`已打开「${projectName}」`, { exact: true })).toBeVisible()
})
