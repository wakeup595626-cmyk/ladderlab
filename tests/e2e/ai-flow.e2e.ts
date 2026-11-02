import { readFile } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import { downloadExport, openHome, trackPageErrors } from './support'

const EXAMPLE = new URL('../../examples/pipeline-sorting.ladderlab.json', import.meta.url)

test('AI 分享链接可导入样例并导出真实 PNG', async ({ page }) => {
  const errors = trackPageErrors(page)
  const program = JSON.parse(await readFile(EXAMPLE, 'utf8')) as {
    name: string
    rungs: unknown[]
  }
  const payload = deflateRawSync(Buffer.from(JSON.stringify(program, null, 2), 'utf8'), {
    level: 9,
  })
  const shareUrl = '/#p=1.' + Buffer.from(payload).toString('base64url')

  await openHome(page)
  await page.goto(shareUrl)

  const confirm = page.getByRole('dialog', {
    name: '导入分享的工程「' + program.name + '」？',
  })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '导入', exact: true }).click()

  await expect(page.locator('#project-name')).toHaveValue(program.name)
  await expect(page.getByText('已导入「' + program.name + '」', { exact: true })).toBeVisible()
  await expect(page.locator('.ll-rung:not(.is-placeholder)')).toHaveCount(program.rungs.length)
  await expect(page.locator('.status-error')).toHaveCount(0)

  const file = await downloadExport(page, '纯梯形图', 'png')
  expect(file.name).toMatch(/\-纯梯形图-.*\.png$/)
  expect(file.bytes.byteLength).toBeGreaterThan(5_000)
  expect(file.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

  const width = file.bytes.readUInt32BE(16)
  const height = file.bytes.readUInt32BE(20)
  expect(width).toBeGreaterThan(800)
  expect(height).toBeGreaterThan(200)
  expect(errors).toEqual([])
})
