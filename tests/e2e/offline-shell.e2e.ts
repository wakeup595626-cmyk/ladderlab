import { expect, test } from '@playwright/test'
import { openHome, trackPageErrors } from './support'

/** Service Worker 的预缓存要在断网后真的能用：HTML、JS、CSS 都得命中。 */
test('断网刷新后应用仍能从缓存启动', async ({ page, context }) => {
  const errors = trackPageErrors(page)
  await openHome(page)

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      message: '页面应被 Service Worker 接管',
      timeout: 20_000,
    })
    .toBe(true)

  // 等安装阶段的预缓存完成，再模拟断网。
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const keys = await caches.keys()
          const name = keys.find((key) => key.startsWith('ladderlab-'))
          if (!name) return 0
          return (await (await caches.open(name)).keys()).length
        }),
      { message: '应用外壳与构建产物应进入缓存', timeout: 20_000 },
    )
    .toBeGreaterThan(8)

  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '梯形实验室' })).toBeVisible({ timeout: 20_000 })
  } finally {
    await context.setOffline(false)
  }

  expect(errors, `离线启动不应有脚本错误：\n${errors.join('\n')}`).toEqual([])
})
