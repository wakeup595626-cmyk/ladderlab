import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  loadCourseExperiment,
  openExportMenu,
  openHome,
} from './support'

const EXPORT_ITEMS = [
  '顺序功能图 SVG',
  '完整程序 SVG',
  '纯梯形图 SVG',
  '完整程序 PNG',
  '纯梯形图 PNG',
  '顺序功能图 PNG',
]

/** 卡住 SFC PNG 的图片解码，直到测试确认导出中的菜单状态后再放行。 */
async function gateImageDecode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode
    const gate = new Promise<void>((resolve) => {
      ;(window as Window & { __releaseLadderlabImageDecode?: () => void }).__releaseLadderlabImageDecode = resolve
    })
    HTMLImageElement.prototype.decode = function () {
      return gate.then(() => decode.call(this))
    }
  })
}

async function releaseImageDecode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const release = (window as Window & { __releaseLadderlabImageDecode?: () => void })
      .__releaseLadderlabImageDecode
    if (!release) throw new Error('图片解码闸门未安装')
    release()
  })
}

async function expectExportItemsDisabled(menu: Locator): Promise<void> {
  for (const item of EXPORT_ITEMS) {
    await expect(menu.getByRole('menuitem', { name: item })).toBeDisabled()
  }
}

async function expectExportItemsEnabled(menu: Locator): Promise<void> {
  for (const item of EXPORT_ITEMS) {
    await expect(menu.getByRole('menuitem', { name: item })).toBeEnabled()
  }
}

test('顺序功能图 PNG 生成期间，桌面导出菜单六项都不可重复触发', async ({ page }) => {
  await gateImageDecode(page)
  await openHome(page)
  await loadCourseExperiment(page, '03 十字路口交通灯')

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  const menu = await openExportMenu(page)
  await menu.getByRole('menuitem', { name: '顺序功能图 PNG' }).click()
  await expect(page.getByText(/正在生成顺序功能图 PNG/)).toBeVisible()

  const busyMenu = await openExportMenu(page)
  await expectExportItemsDisabled(busyMenu)
  await page.keyboard.press('Escape')

  await releaseImageDecode(page)
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toMatch(/顺序功能图.*\.png$/)

  const recoveredMenu = await openExportMenu(page)
  await expectExportItemsEnabled(recoveredMenu)
})

test('顺序功能图 PNG 生成期间，移动端文件菜单六项都不可重复触发', async ({ page }) => {
  await gateImageDecode(page)
  await openHome(page)
  await loadCourseExperiment(page, '03 十字路口交通灯')
  await page.setViewportSize({ width: 375, height: 812 })

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  await page.getByRole('button', { name: '文件：新建、导入或导出' }).click()
  const fileMenu = page.getByRole('menu', { name: '文件操作' })
  await expect(fileMenu).toBeVisible()
  await fileMenu.getByRole('menuitem', { name: '顺序功能图 PNG' }).click()
  await expect(page.getByText(/正在生成顺序功能图 PNG/)).toBeVisible()

  await page.getByRole('button', { name: '文件：新建、导入或导出' }).click()
  const busyMenu = page.getByRole('menu', { name: '文件操作' })
  await expect(busyMenu).toBeVisible()
  await expectExportItemsDisabled(busyMenu)
  await page.keyboard.press('Escape')

  await releaseImageDecode(page)
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toMatch(/顺序功能图.*\.png$/)

  await page.getByRole('button', { name: '文件：新建、导入或导出' }).click()
  const recoveredMenu = page.getByRole('menu', { name: '文件操作' })
  await expect(recoveredMenu).toBeVisible()
  await expectExportItemsEnabled(recoveredMenu)
})
