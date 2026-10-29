import { expect, test } from '@playwright/test'
import { downloadExport, loadCourseExperiment, openHome } from './support'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('课程实验可以导出真实的顺序功能图 PNG', async ({ page }) => {
  await openHome(page)
  await loadCourseExperiment(page, '03 十字路口交通灯')

  await expect(page.locator('#project-name')).toHaveValue('实验三 · 十字路口交通灯')

  const { name, bytes } = await downloadExport(page, '顺序功能图 PNG')

  expect(name).toMatch(/顺序功能图.*\.png$/)
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE)
  expect(bytes.byteLength).toBeGreaterThan(20 * 1024)
})
