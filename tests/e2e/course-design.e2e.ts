import { expect, test } from '@playwright/test'
import { downloadExport, openHome, trackPageErrors } from './support'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('一键课设从题目生成电梯，并导出真实梯形图 PNG', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await page.getByRole('button', { name: /一键课设/ }).click()

  const dialog = page.getByRole('dialog', { name: '一键课设' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('课设题目或动作要求').fill('三层电梯')
  await expect(dialog.getByText('已匹配内置模板')).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '三层电梯', exact: true })).toBeVisible()
  await expect(dialog.getByText('编译通过', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: '生成并载入梯形图' }).click()
  const confirm = page.getByRole('dialog', { name: '载入这个课设？' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '载入', exact: true }).click()

  await expect(page.locator('#project-name')).toHaveValue('实验四 · 三层电梯呼叫与方向')
  await expect(page.locator('.ll-rung:not(.is-placeholder)').first()).toBeVisible()
  await expect(page.locator('.status-error')).toHaveCount(0)
  await expect(page.getByText(/已生成「三层电梯」/)).toBeVisible()

  const file = await downloadExport(page, '纯梯形图', 'png')
  expect(file.name).toMatch(/-纯梯形图-.*\.png$/)
  expect(file.bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE)
  expect(file.bytes.byteLength).toBeGreaterThan(5_000)
  expect(file.bytes.readUInt32BE(16)).toBeGreaterThan(800)
  expect(file.bytes.readUInt32BE(20)).toBeGreaterThan(200)
  expect(errors).toEqual([])
})

test('没有内置模板时给出可复制的 Agent 任务单并明确未验证边界', async ({ page }) => {
  await openHome(page)
  await page.getByRole('button', { name: /一键课设/ }).click()

  const dialog = page.getByRole('dialog', { name: '一键课设' })
  await dialog.getByLabel('课设题目或动作要求').fill('做一个自动分拣机械臂')
  await expect(dialog.getByText('这个题目没有可直接生成的内置模板')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '生成并载入梯形图' })).toBeDisabled()
  await expect(
    dialog.locator('.course-design-agent > p').getByText(/未经仓库校验器验证/),
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: /复制 Agent 任务单/ })).toBeVisible()

  const prompt = dialog.getByLabel('Agent 定制任务单')
  await expect(prompt).toContainText('https://github.com/wakeup595626-cmyk/ladderlab')
  await expect(prompt).toContainText('node scripts/check-project.mjs')
  await expect(prompt).toContainText('node scripts/share-link.mjs')
})
