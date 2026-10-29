import { expect, test } from '@playwright/test'
import { openHome, trackPageErrors } from './support'

test('首屏不请求 GitHub API，星标数只在打开浮层时才拉取', async ({ page }) => {
  const errors = trackPageErrors(page)
  const apiCalls: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://api.github.com/')) apiCalls.push(request.url())
  })

  await openHome(page)
  await page.waitForLoadState('networkidle')
  // 多等一会儿，确认不是延迟触发。
  await page.waitForTimeout(1500)
  expect(apiCalls, '首屏不应该访问 api.github.com').toEqual([])

  await page.getByRole('button', { name: /请杯咖啡/ }).click()
  await expect(page.getByRole('dialog', { name: '请杯咖啡' })).toBeVisible()
  // 打开浮层后才允许拉星标数；即使被限流也只是少显示一个数字。
  await page.waitForTimeout(1200)
  expect(errors.filter((item) => !item.includes('api.github.com')), errors.join('\n')).toEqual([])
})
