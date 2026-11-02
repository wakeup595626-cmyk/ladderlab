import { expect, test } from '@playwright/test'
import {
  downloadExport,
  openExportMenu,
  openHome,
  trackPageErrors,
} from './support'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PDF_SIGNATURE = Buffer.from('%PDF-')

async function generateCourse(page: Parameters<typeof openHome>[0], prompt: string, title: string) {
  await page.getByRole('button', { name: '一键课设：输入题目生成梯形图', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '一键课设' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('课设题目或动作要求').fill(prompt)
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(dialog.getByText('编译通过', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '生成并载入梯形图' }).click()
  const confirm = page.getByRole('dialog', { name: '载入这个课设？' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '载入', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.ll-rung:not(.is-placeholder)').first()).toBeVisible()
  await expect(page.locator('.status-error')).toHaveCount(0)
}

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

test('没有内置模板时给出可复制的 Agent 任务单并明确未验证边界', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
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

  await dialog.getByRole('button', { name: /复制 Agent 任务单/ }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('https://github.com/wakeup595626-cmyk/ladderlab')
  expect(copied).toContain('node scripts/check-project.mjs')
})

test('分页 PDF 导出真实文件，长程序不会只有一个页面', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await generateCourse(page, '三层电梯', '三层电梯')

  const menu = await openExportMenu(page)
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await menu.getByRole('menuitem', { name: '完整程序（分页 PDF）', exact: true }).click()
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toMatch(/-完整程序-分页-.*\.pdf$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(path!)
  expect(bytes.subarray(0, PDF_SIGNATURE.length)).toEqual(PDF_SIGNATURE)
  expect(bytes.byteLength).toBeGreaterThan(20_000)
  const source = bytes.toString('latin1')
  expect(source.match(/\/Type\s*\/Page\b/g)?.length ?? 0).toBeGreaterThan(1)
  await expect(page.getByText(/已导出分页 PDF，共 \d+ 页/)).toBeVisible()
  expect(errors).toEqual([])
})

test('题目规格按路数与层数参数化，超范围时拒绝猜模板', async ({ page }) => {
  await openHome(page)
  await page.getByRole('button', { name: /一键课设/ }).click()
  const dialog = page.getByRole('dialog', { name: '一键课设' })
  const input = dialog.getByLabel('课设题目或动作要求')

  await input.fill('九路流水灯')
  await expect(dialog.getByText('题目规格与内置模板不一致')).toBeVisible()
  await expect(dialog.locator('.course-design-support-range')).toContainText('支持 2～8 路')
  await expect(dialog.getByRole('button', { name: '生成并载入梯形图' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: /复制 Agent 任务单/ })).toBeVisible()

  await input.fill('四层电梯')
  await expect(dialog.getByRole('heading', { name: '四层电梯', exact: true })).toBeVisible()
  await expect(dialog.getByText(/当前规格：4 层/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: '生成并载入梯形图' })).toBeEnabled()
  await dialog.getByRole('button', { name: '生成并载入梯形图' }).click()
  const confirm = page.getByRole('dialog', { name: '载入这个课设？' })
  await confirm.getByRole('button', { name: '载入', exact: true }).click()
  await expect(page.locator('#project-name')).toHaveValue('实验四 · 4 层电梯呼叫与方向')
  await expect(page.locator('.ll-rung:not(.is-placeholder)').first()).toBeVisible()
  await expect(page.locator('.status-error')).toHaveCount(0)
})

test('六个课程实验都能生成、载入并保持编译零错误', async ({ page }) => {
  test.setTimeout(120_000)
  await openHome(page)
  for (const title of [
    '四路抢答器',
    '定时器与计数器',
    '十字路口交通灯',
    '三层电梯',
    '音乐喷泉',
    '装配流水线',
  ]) {
    await generateCourse(page, title, title)
  }
})

test('三个机器课设都能生成、载入并保持编译零错误', async ({ page }) => {
  test.setTimeout(120_000)
  await openHome(page)
  for (const title of [
    '推土机 · 行走与铲刀',
    '电机正反转',
    '八路流水灯',
  ]) {
    await generateCourse(page, title, title)
  }
})

test('五个基础示例都能生成、载入并保持编译零错误', async ({ page }) => {
  test.setTimeout(120_000)
  await openHome(page)
  for (const title of [
    '启保停',
    '顺序启动',
    '计数包装',
    '闪烁回路',
    '边沿计数',
  ]) {
    await generateCourse(page, title, title)
  }
})
