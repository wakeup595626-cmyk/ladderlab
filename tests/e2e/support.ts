import { readFile } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'

export type ExportFormat = 'png' | 'svg'
export type ExportContent = '完整程序' | '纯梯形图'
export type ExportContentName = ExportContent | '顺序功能图'

/** 忽略浏览器扩展自己注入到页面里的报错，只收应用自身的错误。 */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const location = message.location()
    if (location.url.startsWith('chrome-extension://') || message.text().includes('chrome-extension://')) return
    // Star count is optional third-party enhancement. GitHub API rate limiting
    // produces a resource 403 that is not an application script error.
    if (
      location.url.startsWith('https://api.github.com/') &&
      message.text().includes('Failed to load resource')
    ) {
      return
    }
    errors.push(`console: ${message.text()} @ ${location.url}`)
  })

  page.on('pageerror', (error) => {
    if (error.stack?.includes('chrome-extension://')) return
    errors.push(`pageerror: ${error.message}`)
  })

  return errors
}

export async function openHome(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '梯形实验室' })).toBeVisible()

  const dismissCoach = page.getByRole('button', { name: '关闭快速上手' })
  if (await dismissCoach.isVisible().catch(() => false)) await dismissCoach.click()
}

/**
 * 导出按钮的无障碍名称会随可导出的格式文案调整（「…PNG 图片」/「…梯形图图片」），
 * 所以只锁定前缀，避免文案微调就让整条用例超时。
 */
export function exportButton(page: Page) {
  return page.getByRole('button', { name: /^导出工程/ })
}

/**
 * 打开项目抽屉。桌面顶栏是「打开项目」，窄屏收在底部「项目」标签或
 * 「文件」菜单里，所以这里按可见性逐级回退，避免移动端用例整条超时。
 */
export async function openProjectDialog(page: Page): Promise<void> {
  const direct = page.getByRole('button', { name: '打开项目', exact: true }).first()
  if (await direct.isVisible().catch(() => false)) {
    await direct.click()
    return
  }

  const mobileTab = page.getByRole('button', { name: '项目', exact: true }).first()
  if (await mobileTab.isVisible().catch(() => false)) {
    await mobileTab.click()
    return
  }

  await page.getByRole('button', { name: '文件：新建、导入或导出' }).click()
  await page.getByRole('menuitem', { name: '项目、变量表与实验库' }).click()
}

/** 打开项目 → 实验库 → 载入指定实验，等工程名落到顶栏。 */
export async function loadCourseExperiment(page: Page, label: string): Promise<void> {
  await openProjectDialog(page)
  const projectDrawer = page.getByRole('dialog', { name: '项目' })
  await expect(projectDrawer).toBeVisible()
  await projectDrawer.getByRole('button', { name: /实验库/ }).click()

  const library = page.getByRole('dialog', { name: '实验与示例' })
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: new RegExp(`载入${label}`) }).click()

  const confirm = page.getByRole('dialog', { name: '载入这个实验？' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '载入', exact: true }).click()
}

/** 点顶栏「导出工程」并把导出菜单打开。 */
export async function openExportMenu(page: Page) {
  await exportButton(page).click()
  const menu = page.getByRole('menu', { name: '导出' })
  await expect(menu).toBeVisible()
  return menu
}

/** 在已打开的导出菜单里选择一次图片格式；切换格式不会关闭菜单。 */
export async function selectExportFormat(menu: Locator, format: ExportFormat) {
  const radio = menu.getByRole('menuitemradio', { name: format.toUpperCase(), exact: true })
  await radio.click()
  await expect(radio).toHaveAttribute('aria-checked', 'true')
  await expect(menu).toBeVisible()
}

/** 选择导出范围；切换内容只更新菜单，不会提前触发下载。 */
export async function selectExportContent(menu: Locator, content: ExportContent) {
  const radio = menu.getByRole('menuitemradio', { name: content, exact: true })
  await radio.click()
  await expect(radio).toHaveAttribute('aria-checked', 'true')
  await expect(menu).toBeVisible()
}

/** 先选导出范围与图片格式，再点「整张图片」，返回下载文件读出的原始字节。 */
export async function downloadExport(
  page: Page,
  itemName: ExportContentName,
  format: ExportFormat = 'png',
) {
  const menu = await openExportMenu(page)
  if (itemName !== '顺序功能图') await selectExportContent(menu, itemName)
  await selectExportFormat(menu, format)
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  const action = itemName === '顺序功能图' ? /^顺序功能图$/ : /^整张图片/
  await menu.getByRole('menuitem', { name: action }).click()
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).not.toBeNull()
  return { name: download.suggestedFilename(), bytes: await readFile(path!) }
}
