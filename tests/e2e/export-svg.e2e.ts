import { expect, test, type Page } from '@playwright/test'
import { downloadExport, loadCourseExperiment, openExportMenu, openHome } from './support'

/** PNG 超限时应用给出的提示，必须指路到不受画布限制的 SVG。 */
const PNG_TOO_LARGE_MESSAGE = '工程过长，单张 PNG 超过浏览器画布上限；'
  + '请改用 SVG（不受画布限制）导出，或减少程序段后重试'

function asText(bytes: Buffer): string {
  return bytes.toString('utf8')
}

/** XML 1.0 不允许的控制字符：除制表、换行、回车以外的 0x00-0x1F。 */
function hasForbiddenControlChar(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true
  }
  return false
}

/** 走「导入工程 → 粘贴 JSON」这条真实路径换掉当前工程。 */
async function importProgram(page: Page, program: unknown): Promise<void> {
  await page.getByRole('button', { name: '导入工程文件', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导入工程' })
  await expect(dialog).toBeVisible()
  await dialog.getByText('没有文件？直接粘贴工程 JSON').click()
  await dialog.getByLabel('工程 JSON 内容').fill(JSON.stringify(program))
  await dialog.getByRole('button', { name: '检查内容' }).click()
  await dialog.getByRole('button', { name: '导入并打开' }).click()
  await expect(dialog).toBeHidden()
}

/** 三条 SVG 都必须是不依赖外部资源的纯矢量文件。 */
function expectSelfContainedSvg(text: string): void {
  expect(text.startsWith('<?xml')).toBe(true)
  expect(text).toMatch(/<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  expect(text).toMatch(/<svg\b[^>]*viewBox="0 0 [0-9.]+ [0-9.]+"/)
  expect(text).not.toContain('<foreignObject')
  expect(text).not.toContain('<image')
  expect(text).not.toContain('tabindex')
  expect(text).not.toContain('data-')
  expect(text).not.toContain('aria-')
  // 三条 SVG 统一为纯图形文档：不带任何 role，也不带根级 <title>。
  expect(text).not.toContain('role=')
  // 页头只留工程名与块信息，产品字样不该再出现在成品图里。
  expect(text).not.toContain('LADDERLAB')
  expect(text).not.toContain('程序导出')
}

/** 与应用的 downloadTimestamp() 同一套格式：本地时间到秒。 */
function localStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + '_' + pad(date.getHours()) + '-' + pad(date.getMinutes()) + '-' + pad(date.getSeconds())
}

/** 从「名称-2026-10-30_01-45-08.svg」里取出时间戳部分。 */
function stampOf(name: string): string | undefined {
  return /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.svg$/.exec(name)?.[1]
}

/** 把时间戳按本地时区还原成毫秒，用来判断它是不是这次导出写的。 */
function stampToTime(stamp: string): number {
  const match = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(stamp)
  if (!match) return Number.NaN
  return new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
  ).getTime()
}

test('完整程序、纯梯形图、顺序功能图都能下载自包含的 SVG', async ({ page }) => {
  await openHome(page)
  await loadCourseExperiment(page, '03 十字路口交通灯')
  await expect(page.locator('#project-name')).toHaveValue('实验三 · 十字路口交通灯')

  for (const item of ['完整程序 SVG', '纯梯形图 SVG', '顺序功能图 SVG']) {
    const before = new Date()
    const { name, bytes } = await downloadExport(page, item)
    const after = new Date()
    expect(name.endsWith('.svg'), item + ' 文件名应以 .svg 结尾').toBe(true)
    // 文件名只带本地秒级时间戳，且不能混进 Windows 不接受的字符。
    const stamp = stampOf(name)
    expect(stamp, item + ' 文件名缺少时间戳：' + name).toBeTruthy()
    // 时间戳必须落在这次点击的起止之间：写成 UTC 会差 8 小时，直接露馅。
    const stampedAt = stampToTime(stamp ?? '')
    const startedAt = Math.floor(before.getTime() / 1000) * 1000
    const endedAt = Math.floor(after.getTime() / 1000) * 1000
    expect(
      stampedAt >= startedAt && stampedAt <= endedAt,
      item + ' 时间戳不是本次导出的本地时间：' + name
        + '（本地 ' + localStamp(before) + ' ~ ' + localStamp(after) + '）',
    ).toBe(true)
    expect(name, item + ' 文件名含非法字符：' + name).not.toMatch(/[\\/:*?"<>|]/)
    expect(bytes.byteLength).toBeGreaterThan(2 * 1024)
    expectSelfContainedSvg(asText(bytes))
  }
})

test('不同实验导出的顺序功能图内容不同', async ({ page }) => {
  await openHome(page)

  await loadCourseExperiment(page, '03 十字路口交通灯')
  const lab03 = asText((await downloadExport(page, '顺序功能图 SVG')).bytes)

  await loadCourseExperiment(page, '06 装配流水线')
  await expect(page.locator('#project-name')).toHaveValue('实验六 · 装配流水线移位控制')
  const lab06 = asText((await downloadExport(page, '顺序功能图 SVG')).bytes)

  expect(lab03).not.toBe(lab06)
  // 两张图都必须真的画出步骤框和白底，而不是空白占位。
  for (const svg of [lab03, lab06]) {
    expect(svg).toContain('fill="#ffffff"')
    expect((svg.match(/<rect\b/g) ?? []).length).toBeGreaterThan(2)
    expect((svg.match(/<text\b/g) ?? []).length).toBeGreaterThan(2)
  }
})

test('变量名里的非法控制字符不会写进导出的 SVG', async ({ page }) => {
  await openHome(page)

  const program = {
    schema: 1,
    name: '控制字符回归',
    profile: 'v21',
    tags: [{ id: 't1', name: '启A\u0001B动', address: 'M0.0', kind: 'BOOL', initial: false, comment: '' }],
    rungs: [{
      id: 'r1',
      label: '启动',
      nodes: [{ type: 'contact', id: 'n1', kind: 'NO', tag: '启A\u0001B动' }],
      output: { id: 'o1', kind: 'COIL', tag: '启A\u0001B动' },
    }],
  }

  await importProgram(page, program)

  for (const item of ['完整程序 SVG', '纯梯形图 SVG']) {
    const text = asText((await downloadExport(page, item)).bytes)
    expect(hasForbiddenControlChar(text), `${item} 仍残留非法控制字符`).toBe(false)
    expect(text).toContain('启AB动')
    const parserError = await page.evaluate((svgText) => {
      const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
      return doc.querySelector('parsererror')?.textContent ?? ''
    }, text)
    expect(parserError, `${item} 不是合法的 SVG XML`).toBe('')
  }
})

test('超长工程导出 PNG 时提前拦下，并指路到不受画布限制的 SVG', async ({ page }) => {
  test.setTimeout(120_000)
  await openHome(page)

  // 单段 460 个并联支路：每支路约 67px，整段高度已越过 0.5 倍率下 30000 的单边上限。
  const branches = Array.from({ length: 460 }, (_, index) => [
    { type: 'contact', id: 'n' + index, kind: 'NO', tag: 'T0' },
  ])
  const program = {
    schema: 1,
    name: '超长单段',
    profile: 'v21',
    tags: [
      { id: 't0', name: 'T0', address: 'M0.0', kind: 'BOOL', initial: false, comment: '' },
      { id: 't1', name: 'T1', address: 'M0.1', kind: 'BOOL', initial: false, comment: '' },
    ],
    rungs: [{
      id: 'r1',
      label: '超长单段',
      nodes: [{ type: 'parallel', id: 'p1', branches }],
      output: { id: 'o1', kind: 'COIL', tag: 'T1' },
    }],
  }

  await importProgram(page, program)

  const menu = await openExportMenu(page)
  await menu.getByRole('menuitem', { name: '完整程序 PNG' }).click()
  await expect(page.getByText(PNG_TOO_LARGE_MESSAGE, { exact: true })).toBeVisible({ timeout: 60_000 })

  // 同一个工程改走 SVG 仍然出得来，提示里的替代方案不是空话。
  const svg = asText((await downloadExport(page, '完整程序 SVG')).bytes)
  expectSelfContainedSvg(svg)
})
