import { expect, test } from '@playwright/test'
import {
  downloadExport,
  loadCourseExperiment,
  openExportMenu,
  openHome,
  selectExportContent,
  selectExportFormat,
  trackPageErrors,
  type ExportContent,
} from './support'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PDF_SIGNATURE = Buffer.from('%PDF-')

async function downloadPagedPdf(
  page: import('@playwright/test').Page,
  content: ExportContent,
  filename: RegExp,
) {
  const menu = await openExportMenu(page)
  await selectExportContent(menu, content)
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await menu.getByRole('menuitem', { name: '分页 PDF', exact: true }).click()
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toMatch(filename)
  const path = await download.path()
  expect(path).not.toBeNull()
  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(path!)
  expect(bytes.subarray(0, PDF_SIGNATURE.length)).toEqual(PDF_SIGNATURE)
  const pageCount = bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0
  expect(pageCount).toBeGreaterThan(1)
  await expect(page.getByText(/已导出分页 PDF，共 \d+ 页/)).toBeVisible()
  return { bytes, pageCount }
}

async function downloadSegmentArchive(
  page: import('@playwright/test').Page,
  content: ExportContent,
  format: 'png' | 'svg',
  filename: RegExp,
) {
  const menu = await openExportMenu(page)
  await selectExportContent(menu, content)
  await selectExportFormat(menu, format)
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
  await menu.getByRole('menuitem', { name: /^分段图片/ }).click()
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toMatch(filename)
  const path = await download.path()
  expect(path).not.toBeNull()
  const { readFile } = await import('node:fs/promises')
  const { unzipSync } = await import('fflate')
  const bytes = await readFile(path!)
  const entries = unzipSync(new Uint8Array(bytes))
  return { bytes, entries }
}

async function expectSegmentEntries(
  page: import('@playwright/test').Page,
  entries: Record<string, Uint8Array>,
  rungCount: number,
  extension: 'png' | 'svg',
) {
  const names = Object.keys(entries).sort()
  expect(names.length).toBeGreaterThan(0)
  // 分段图是一页多段，图片张数必须明显少于程序段数。
  expect(names.length).toBeLessThan(rungCount)
  let nextStart = 1
  for (const [index, name] of names.entries()) {
    const match = new RegExp('^(\\d{3})-第(\\d+)(?:-(\\d+))?段\\.' + extension + '$').exec(name)
    expect(match, name).not.toBeNull()
    const prefix = Number(match?.[1])
    const start = Number(match?.[2])
    const end = Number(match?.[3] ?? match?.[2])
    expect(prefix).toBe(index + 1)
    expect(start).toBe(nextStart)
    expect(end).toBeGreaterThanOrEqual(start)
    expect(end - start + 1).toBeLessThanOrEqual(5)
    nextStart = end + 1

    const data = entries[name]
    if (extension === 'svg') {
      const source = new TextDecoder().decode(data)
      expect(source).toContain('<svg')
      expect(source).toContain('fill="#ffffff"')
      const placedRungs = await page.evaluate((markup) => {
        const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
        return Array.from(doc.documentElement.children).filter((node) => (
          node.tagName === 'g'
          && node.getAttribute('transform')?.startsWith('translate(')
        )).length
      }, source)
      expect(placedRungs, name + ' 应装下 ' + (end - start + 1) + ' 段').toBe(end - start + 1)
    } else {
      expect(Buffer.from(data.subarray(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE)
      if (end > start) {
        // 两段以上的白底图高度必然超过单段图，防止退回“一段一张”。
        expect(Buffer.from(data).readUInt32BE(20)).toBeGreaterThan(300)
      }
    }
  }
  expect(nextStart).toBe(rungCount + 1)
}

test('AI 课设只生成提示词，并能复制完整需求交给本机 Agent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openHome(page)
  await page.getByRole('button', {
    name: 'AI 课设：复制提示词交给本机 Agent',
    exact: true,
  }).click()

  const dialog = page.getByRole('dialog', { name: '让 AI 做课设' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('粘贴课设要求，复制完整提示词给电脑上的 Agent。')).toBeVisible()
  await expect(dialog.locator('.course-design-examples')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '三层电梯', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '推土机', exact: true })).toHaveCount(0)

  const requirement = dialog.getByRole('textbox', {
    name: '课设要求',
    exact: true,
  })
  await expect(requirement).toBeFocused()
  const prompt = dialog.getByRole('textbox', {
    name: 'Agent 提示词',
    exact: true,
  })
  await expect(prompt).toBeVisible()
  await expect(prompt).toHaveValue(/请直接执行/)
  const copy = dialog.getByRole('button', { name: '复制提示词', exact: true })
  await expect(copy).toBeDisabled()

  const request = '三层电梯，每层有外呼按钮和选层按钮；到站开门延时关门，急停后复位。'
  await requirement.fill(request)
  await expect(copy).toBeEnabled()
  await expect(prompt).toHaveValue(/https:\/\/github\.com\/wakeup595626-cmyk\/ladderlab/)
  await expect(prompt).toHaveValue(new RegExp(request))
  await expect(prompt).toHaveValue(/node scripts\/check-project\.mjs/)
  await expect(prompt).toHaveValue(/node scripts\/share-link\.mjs/)
  await expect(prompt).toHaveValue(/未经仓库校验器验证/)
  await expect(dialog.getByRole('button', { name: '生成并载入梯形图' })).toHaveCount(0)

  await copy.click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('https://github.com/wakeup595626-cmyk/ladderlab')
  expect(copied).toContain(request)
  expect(copied).toContain('node scripts/check-project.mjs')
  expect(copied).toContain('node scripts/share-link.mjs')
  await expect(dialog.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
  await expect(dialog.getByText('已复制，去 Agent 里粘贴即可。')).toBeVisible()
})

test('实验库中的三层电梯仍可导出真实梯形图 PNG', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '04 三层电梯')
  await expect(page.locator('#project-name')).toHaveValue('实验四 · 三层电梯呼叫与方向')
  await expect(page.locator('.ll-rung:not(.is-placeholder)').first()).toBeVisible()
  await expect(page.locator('.status-error')).toHaveCount(0)

  const file = await downloadExport(page, '纯梯形图', 'png')
  expect(file.name).toMatch(/-纯梯形图-.*\.png$/)
  expect(file.bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE)
  expect(file.bytes.byteLength).toBeGreaterThan(5_000)
  expect(file.bytes.readUInt32BE(16)).toBeGreaterThan(800)
  expect(file.bytes.readUInt32BE(20)).toBeGreaterThan(200)
  expect(errors).toEqual([])
})

test('实验库中的装配流水线可分页导出真实 PDF', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '06 装配流水线')
  await expect(page.locator('.ll-rung:not(.is-placeholder)').first()).toBeVisible()

  const { bytes, pageCount } = await downloadPagedPdf(
    page,
    '完整程序',
    /-完整程序-分页-.*\.pdf$/,
  )
  expect(bytes.byteLength).toBeGreaterThan(20_000)
  expect(pageCount).toBeGreaterThan(1)
  expect(errors).toEqual([])
})

test('实验库中的装配流水线可分页导出纯梯形图 PDF', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '06 装配流水线')
  await expect(page.locator('.ll-rung:not(.is-placeholder)').first()).toBeVisible()

  const { bytes, pageCount } = await downloadPagedPdf(
    page,
    '纯梯形图',
    /-纯梯形图-分页-.*\.pdf$/,
  )
  expect(bytes.byteLength).toBeGreaterThan(10_000)
  expect(pageCount).toBeGreaterThan(1)
  expect(errors).toEqual([])
})

test('装配流水线可把完整程序与纯梯形图分别导出成分段图片 ZIP', async ({ page }) => {
  test.setTimeout(180_000)
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '06 装配流水线')
  await expect(page.locator('.ll-rung:not(.is-placeholder)').first()).toBeVisible()
  const rungCount = await page.locator('.ll-rung:not(.is-placeholder)').count()
  expect(rungCount).toBeGreaterThan(1)

  const completeSvg = await downloadSegmentArchive(
    page,
    '完整程序',
    'svg',
    /-完整程序-分段图片-.*\.zip$/,
  )
  await expectSegmentEntries(page, completeSvg.entries, rungCount, 'svg')
  const completeBatchCount = Object.keys(completeSvg.entries).length
  await expect(page.getByText('已导出完整程序-分段图片，共 ' + completeBatchCount + ' 张')).toBeVisible()

  const plainSvg = await downloadSegmentArchive(
    page,
    '纯梯形图',
    'svg',
    /-纯梯形图-分段图片-.*\.zip$/,
  )
  await expectSegmentEntries(page, plainSvg.entries, rungCount, 'svg')

  const completePng = await downloadSegmentArchive(
    page,
    '完整程序',
    'png',
    /-完整程序-分段图片-.*\.zip$/,
  )
  await expectSegmentEntries(page, completePng.entries, rungCount, 'png')

  const plainPng = await downloadSegmentArchive(
    page,
    '纯梯形图',
    'png',
    /-纯梯形图-分段图片-.*\.zip$/,
  )
  await expectSegmentEntries(page, plainPng.entries, rungCount, 'png')
  expect(errors).toEqual([])
})
