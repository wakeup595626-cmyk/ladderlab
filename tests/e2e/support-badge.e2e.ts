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

test('收款码默认微信，并能与支付宝互相切换', async ({ page }) => {
  await openHome(page)
  await page.getByRole('button', { name: /请杯咖啡/ }).click()

  const dialog = page.getByRole('dialog', { name: '请杯咖啡' })
  const wechat = dialog.getByRole('button', { name: '微信', exact: true })
  const alipay = dialog.getByRole('button', { name: '支付宝', exact: true })
  const qr = dialog.locator('.support-badge-qr')

  await expect(wechat).toHaveAttribute('aria-pressed', 'true')
  await expect(alipay).toHaveAttribute('aria-pressed', 'false')
  await expect(qr).toHaveAttribute('alt', /微信收款二维码/)
  await expect(qr).toHaveAttribute('src', /support-wechat\.png$/)
  await expect.poll(() => qr.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  await expect(dialog.getByText('打开微信「扫一扫」即可')).toBeVisible()

  await alipay.click()
  await expect(alipay).toHaveAttribute('aria-pressed', 'true')
  await expect(wechat).toHaveAttribute('aria-pressed', 'false')
  await expect(qr).toHaveAttribute('alt', /支付宝收款二维码/)
  await expect(qr).toHaveAttribute('src', /support-alipay\.png$/)
  await expect(dialog.getByText('打开支付宝「扫一扫」即可')).toBeVisible()

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /请杯咖啡/ }).click()
  await expect(wechat).toHaveAttribute('aria-pressed', 'true')
  await expect(qr).toHaveAttribute('alt', /微信收款二维码/)
})
