import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

const PDF_SIGNATURE = Buffer.from('%PDF-')
const BASE_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4319}`

const VIEWPORTS = [
  { name: '手机竖屏', width: 390, height: 844 },
  { name: '窄手机竖屏', width: 320, height: 568 },
  { name: '平板竖屏', width: 768, height: 1024 },
  { name: '手机横屏', width: 844, height: 390 },
] as const

async function courseEntry(page: Page, width: number): Promise<Locator> {
  if (width > 860) {
    return page.getByRole('button', {
      name: 'AI 课设：复制提示词交给本机 Agent',
      exact: true,
    })
  }
  return page.getByRole('button', { name: '文件：新建、导入或导出', exact: true })
}

async function openCourseDesign(page: Page, width: number): Promise<Locator> {
  const entry = await courseEntry(page, width)
  await expect(entry).toBeVisible()
  await entry.click()

  if (width <= 860) {
    const fileMenu = page.getByRole('menu', { name: '文件操作' })
    await expect(fileMenu).toBeVisible()
    await fileMenu
      .getByRole('menuitem', { name: 'AI 课设 / 复制提示词交给本机 Agent', exact: true })
      .click()
  }

  await expect(page.getByRole('dialog', { name: '让 AI 做课设' })).toBeVisible()
  return entry
}

async function expectInsideViewport(
  locator: Locator,
  viewport: { width: number; height: number },
): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-0.5)
  expect(box!.y).toBeGreaterThanOrEqual(-0.5)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5)
}

async function expectTouchTarget(locator: Locator): Promise<number> {
  await locator.scrollIntoViewIfNeeded()
  await expect
    .poll(async () => (await locator.boundingBox())?.height ?? 0, { timeout: 3_000 })
    .toBeGreaterThanOrEqual(43.5)
  return (await locator.boundingBox())!.height
}

for (const viewport of VIEWPORTS) {
  test(`AI 课设适配${viewport.name} ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      hasTouch: true,
      viewport: { width: viewport.width, height: viewport.height },
    })
    try {
      const page = await context.newPage()
      const errors = trackPageErrors(page)
      await openHome(page)
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

      const opener = await openCourseDesign(page, viewport.width)
      const dialog = page.getByRole('dialog', { name: '让 AI 做课设' })
      await expectInsideViewport(dialog, viewport)
      await expect(dialog.getByText('粘贴课设要求，复制完整提示词给电脑上的 Agent。')).toBeVisible()
      await expect(dialog.locator('.course-design-examples')).toHaveCount(0)

      const dialogBox = await dialog.boundingBox()
      expect(dialogBox).not.toBeNull()
      expect(Math.abs(dialogBox!.x + dialogBox!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1)
      expect(Math.abs(dialogBox!.y + dialogBox!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(1)

      const requirement = dialog.getByRole('textbox', {
        name: '课设要求',
        exact: true,
      })
      await expect(requirement).toBeVisible()
      await expectInsideViewport(requirement, viewport)
      const prompt = dialog.getByRole('textbox', {
        name: 'Agent 提示词',
        exact: true,
      })
      await expect(prompt).toBeVisible()
      await prompt.scrollIntoViewIfNeeded()
      await expectInsideViewport(prompt, viewport)

      const overflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      }))
      expect(overflow.document - overflow.viewport).toBeLessThanOrEqual(1)

      const copy = dialog.getByRole('button', { name: '复制提示词', exact: true })
      await expect(copy).toBeDisabled()
      await requirement.fill('三层电梯，带楼层外呼、选层、方向显示和开门延时。')
      await expect(copy).toBeEnabled()
      await expect(prompt).toHaveValue(/三层电梯/)

      const close = dialog.getByRole('button', { name: '关闭 AI 课设', exact: true })
      await expectInsideViewport(close, viewport)
      const closeHeight = await expectTouchTarget(close)
      const copyHeight = await expectTouchTarget(copy)
      console.log(
        `--- ${viewport.name} ${viewport.width}×${viewport.height}: `
        + `关闭 ${closeHeight.toFixed(1)}px / 复制 ${copyHeight.toFixed(1)}px`,
      )

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(opener).toBeFocused()
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
}

test('短屏触屏可从实验库导出真实分页 PDF', async ({ browser }) => {
  test.setTimeout(120_000)
  const viewport = { width: 844, height: 390 }
  const context = await browser.newContext({
    baseURL: BASE_URL,
    hasTouch: true,
    viewport,
  })
  try {
    const page = await context.newPage()
    const errors = trackPageErrors(page)
    await openHome(page)
    await loadCourseExperiment(page, '06 装配流水线')
    await expect(page.locator('.ll-rung:not(.is-placeholder)').first()).toBeVisible()

    const fileMenuButton = page.getByRole('button', { name: '文件：新建、导入或导出', exact: true })
    await fileMenuButton.click()
    const menu = page.getByRole('menu', { name: '文件操作' })
    await expect(menu).toBeVisible()
    const pdfItem = menu.getByRole('menuitem', {
      name: '完整程序（分页 PDF）',
      exact: true,
    })
    await pdfItem.scrollIntoViewIfNeeded()
    await expectInsideViewport(pdfItem, viewport)
    const height = await expectTouchTarget(pdfItem)
    expect(height).toBeGreaterThanOrEqual(43.5)

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await pdfItem.click()
    const download = await downloadPromise
    expect(await download.failure()).toBeNull()
    expect(download.suggestedFilename()).toMatch(/-完整程序-分页-.*\.pdf$/)
    const path = await download.path()
    expect(path).not.toBeNull()
    const bytes = await readFile(path!)
    expect(bytes.subarray(0, PDF_SIGNATURE.length)).toEqual(PDF_SIGNATURE)
    expect(bytes.byteLength).toBeGreaterThan(20_000)
    await expect(page.getByText(/已导出分页 PDF，共 \d+ 页/)).toBeVisible({ timeout: 60_000 })
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
