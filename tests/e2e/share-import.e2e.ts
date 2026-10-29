import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { openHome } from './support'

test('分享链接确认前保留完整载荷，导入完成后才清理地址栏', async ({ page }) => {
  await openHome(page)

  const fixture = await readFile(new URL('./fixtures/self-hold.json', import.meta.url), 'utf8')
  const encoded = Buffer.from(fixture, 'utf8').toString('base64url')
  const shareHash = `#p=0.${encoded}`
  await page.goto(`/${shareHash}`)

  const confirm = page.getByRole('dialog', { name: '导入分享的工程「E2E 分享自保持」？' })
  await expect(confirm).toBeVisible()
  expect(new URL(page.url()).hash).toBe(shareHash)

  await confirm.getByRole('button', { name: '导入', exact: true }).click()
  await expect(page.locator('#project-name')).toHaveValue('E2E 分享自保持')
  await expect(page.getByText('已导入「E2E 分享自保持」', { exact: true })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
})

test('主动取消分享导入后才清理载荷，刷新不会再次追问', async ({ page }) => {
  await openHome(page)

  const fixture = await readFile(new URL('./fixtures/self-hold.json', import.meta.url), 'utf8')
  const encoded = Buffer.from(fixture, 'utf8').toString('base64url')
  await page.goto(`/#p=0.${encoded}`)

  const confirm = page.getByRole('dialog', { name: '导入分享的工程「E2E 分享自保持」？' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '先不导入', exact: true }).click()
  expect(new URL(page.url()).hash).toBe('')

  await page.reload()
  await expect(page.getByRole('dialog', { name: '导入分享的工程「E2E 分享自保持」？' })).toHaveCount(0)
})

test('分享载荷解码失败时保留地址，便于用户重新复制或修正', async ({ page }) => {
  await openHome(page)

  const brokenHash = '#p=1.not-base64!!'
  await page.goto(`/${brokenHash}`)
  await expect(page.getByRole('alert')).toContainText('分享链接内容已损坏')
  expect(new URL(page.url()).hash).toBe(brokenHash)
})
