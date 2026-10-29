import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createBlankProject, renameProject } from './custom-export.spec'
import { openHome } from './support'

const PROJECT_RECORD_PREFIX = 'ladderlab.library.v2.project.'
const LIBRARY_LOCK_NAME = 'ladderlab.library.v2'
const STALE_PREVIEW_MESSAGE = '项目库在预览之后已有更新。已刷新恢复预览，请重新确认要写入的内容。'

interface BackupProject {
  id: string
  name: string
  savedAt: number
  program: {
    name: string
  }
}

interface BackupDocument {
  format: string
  version: number
  generatedAt: string
  count: number
  checksum: string
  projects: BackupProject[]
}

interface StoredProjectRecord {
  schema: number
  id: string
  savedAt: number
  program: {
    name: string
  }
}

interface RestoreFixture {
  project: BackupProject
}

async function saveNewProject(page: Page, name: string): Promise<void> {
  await createBlankProject(page)
  await renameProject(page, name)
  await expect(page.locator('#project-name')).toHaveValue(name)

  await page.getByRole('button', { name: '保存到本机项目库' }).click()
  const dialog = page.getByRole('dialog', { name: '保存工程' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('工程名称').fill(name)
  await dialog.getByRole('button', { name: '保存到项目库' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(`已保存「${name}」到本机项目库`, { exact: true })).toBeVisible()
}

async function openBackupDialog(page: Page) {
  await page.getByRole('button', { name: '打开项目' }).click()
  const drawer = page.getByRole('dialog', { name: '项目' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: /^整包备份/ }).click()

  const dialog = page.getByRole('dialog', { name: '整包备份' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function exportBackup(page: Page, dialog: Locator): Promise<BackupDocument> {
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^导出整包备份/ }).click()
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  // 备份文件名和其他导出一致：本地时间 yyyy-MM-dd_HH-mm-ss，只含安全字符。
  const name = download.suggestedFilename()
  expect(name, '整包备份文件名应带本地时间戳：' + name)
    .toMatch(/^梯形实验室-整包备份-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  return JSON.parse(await readFile(path!, 'utf8')) as BackupDocument
}

async function injectBackup(dialog: Locator, backupText: string): Promise<void> {
  await dialog.locator('input[type="file"]').setInputFiles({
    name: '备份竞态.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backupText, 'utf8'),
  })
  await expect(dialog.getByText('备份生成于', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '确认恢复', exact: true })).toBeVisible()
}

/** 从真实界面导出并重新选择同一份备份，停在“确认恢复”预览。 */
async function prepareRestore(page: Page, projectName: string): Promise<RestoreFixture> {
  await openHome(page)
  await saveNewProject(page, projectName)
  const dialog = await openBackupDialog(page)
  const backup = await exportBackup(page, dialog)
  const backupText = JSON.stringify(backup, null, 2)

  const project = backup.projects.find((item) => item.name === projectName)
  if (!project) throw new Error(`备份里没有刚保存的工程「${projectName}」`)
  expect(backup.count).toBe(1)
  expect(backup.projects).toHaveLength(1)

  await injectBackup(dialog, backupText)
  return { project }
}

async function openSavedProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '打开项目' }).click()
  const drawer = page.getByRole('dialog', { name: '项目' })
  await expect(drawer).toBeVisible()
  await drawer.getByTitle(`打开「${name}」`).click()

  const confirm = page.getByRole('dialog', { name: `打开「${name}」？` })
  if (await confirm.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await confirm.getByRole('button', { name: '打开', exact: true }).click()
  }
  await expect(drawer).toBeHidden()
  await expect(page.locator('#project-name')).toHaveValue(name)
}

async function readStoredProject(page: Page, id: string): Promise<StoredProjectRecord | null> {
  return page.evaluate(
    ({ key }) => {
      const raw = window.localStorage.getItem(key)
      if (!raw) return null
      return JSON.parse(raw) as StoredProjectRecord
    },
    { key: `${PROJECT_RECORD_PREFIX}${id}` },
  )
}

test.describe('整包备份并发恢复', () => {
  test('另一个标签页修改项目后，旧预览不能静默覆盖新版本', async ({ context, page }) => {
    test.setTimeout(120_000)
    const projectName = '备份竞态原始工程'
    const otherTabName = '页面 B 新版本'
    const fixture = await prepareRestore(page, projectName)
    const dialog = page.getByRole('dialog', { name: '整包备份' })

    const pageB = await context.newPage()
    await openHome(pageB)
    await openSavedProject(pageB, projectName)
    await renameProject(pageB, otherTabName)
    await expect(pageB.locator('#project-name')).toHaveValue(otherTabName)
    await pageB.getByRole('button', { name: '保存到本机项目库' }).click()

    await expect.poll(async () => (await readStoredProject(pageB, fixture.project.id))?.program.name, {
      message: '页面 B 应已把新版本写入共享项目库',
    }).toBe(otherTabName)
    const newer = await readStoredProject(pageB, fixture.project.id)
    expect(newer?.savedAt).toBeGreaterThan(fixture.project.savedAt)

    await expect(dialog.getByText('备份较早', { exact: false })).toHaveCount(0)
    await dialog.getByRole('button', { name: '确认恢复', exact: true }).click()

    await expect(dialog.getByText(STALE_PREVIEW_MESSAGE, { exact: true })).toBeVisible()
    await expect(dialog.getByText('备份较早', { exact: false })).toBeVisible()
    await expect(dialog.getByText('恢复完成', { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '确认恢复', exact: true })).toBeEnabled()

    // 第一次确认只刷新预览，项目库必须仍是页面 B 的新版本。
    expect((await readStoredProject(page, fixture.project.id))?.program.name).toBe(otherTabName)

    await dialog.getByRole('button', { name: '确认恢复', exact: true }).click()
    await expect(dialog.getByText('恢复完成', { exact: true })).toBeVisible()
    await expect.poll(async () => (await readStoredProject(page, fixture.project.id))?.program.name, {
      message: '第二次确认后应按备份内容恢复',
    }).toBe(projectName)
    expect((await readStoredProject(page, fixture.project.id))?.savedAt).toBe(fixture.project.savedAt)
  })

  test('恢复会等待另一个标签页释放项目库 Web Lock', async ({ context, page }) => {
    test.setTimeout(120_000)
    const fixture = await prepareRestore(page, '跨标签页锁工程')
    const dialog = page.getByRole('dialog', { name: '整包备份' })

    const pageB = await context.newPage()
    await openHome(pageB)
    await pageB.evaluate(async (lockName) => {
      await new Promise<void>((acquired) => {
        void navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
          const raceWindow = window as Window & { __releaseBackupRaceLock?: () => void }
          acquired()
          await new Promise<void>((release) => {
            raceWindow.__releaseBackupRaceLock = release
          })
        })
      })
    }, LIBRARY_LOCK_NAME)

    await dialog.getByRole('button', { name: '确认恢复', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '正在恢复…', exact: true })).toBeVisible()
    await expect(dialog.getByText('恢复完成', { exact: true })).toHaveCount(0)

    await pageB.evaluate(() => {
      const raceWindow = window as Window & { __releaseBackupRaceLock?: () => void }
      const release = raceWindow.__releaseBackupRaceLock
      if (!release) throw new Error('没有找到待释放的项目库锁')
      delete raceWindow.__releaseBackupRaceLock
      release()
    })

    await expect(dialog.getByText('恢复完成', { exact: true })).toBeVisible()
    expect((await readStoredProject(page, fixture.project.id))?.program.name).toBe('跨标签页锁工程')
  })

  test('Web Locks 不可用时仍能通过页面内队列完成恢复', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext()
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: undefined,
      })
    })

    try {
      const page = await context.newPage()
      await openHome(page)
      expect(await page.evaluate(() => typeof navigator.locks)).toBe('undefined')

      const fixture = await prepareRestore(page, '无 Web Locks 工程')
      const dialog = page.getByRole('dialog', { name: '整包备份' })
      await dialog.getByRole('button', { name: '确认恢复', exact: true }).click()

      await expect(dialog.getByText('恢复完成', { exact: true })).toBeVisible()
      expect((await readStoredProject(page, fixture.project.id))?.program.name).toBe('无 Web Locks 工程')
    } finally {
      await context.close()
    }
  })
})
