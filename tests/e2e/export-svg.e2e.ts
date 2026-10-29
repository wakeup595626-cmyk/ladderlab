import { expect, test } from '@playwright/test'
import { downloadExport, loadCourseExperiment, openHome } from './support'

function asText(bytes: Buffer): string {
  return bytes.toString('utf8')
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
  // 根节点上的 role="img" 是图层语义，保留；其余交互角色不应出现。
  const rootTag = /<svg\b[^>]*>/.exec(text)?.[0] ?? ''
  const roles = text.match(/role=/g) ?? []
  expect(roles.length).toBeLessThanOrEqual(1)
  if (roles.length === 1) expect(rootTag).toContain('role="img"')
}

test('完整程序、纯梯形图、顺序功能图都能下载自包含的 SVG', async ({ page }) => {
  await openHome(page)
  await loadCourseExperiment(page, '03 十字路口交通灯')
  await expect(page.locator('#project-name')).toHaveValue('实验三 · 十字路口交通灯')

  for (const item of ['完整程序 SVG', '纯梯形图 SVG', '顺序功能图 SVG']) {
    const { name, bytes } = await downloadExport(page, item)
    expect(name.endsWith('.svg'), `${item} 文件名应以 .svg 结尾`).toBe(true)
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
