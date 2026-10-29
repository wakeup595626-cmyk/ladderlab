import { expect, test } from '@playwright/test'
import { openHome } from './support'

/**
 * 新 Service Worker 接管旧标签页后，旧页面仍可能请求上一版带 hash 的懒加载
 * chunk。这里通过真实浏览器模拟“当前缓存没命中、上一版缓存仍保留”的部署
 * 过渡状态，确保 cache-first 与 stale-while-revalidate 都能回查旧缓存。
 */
test('新 worker 接管后仍能读到上一版缓存里的旧响应', async ({ page }) => {
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

  const paths = {
    asset: '/assets/legacy-hashed-chunk-e2e.js',
    shell: '/legacy-runtime-e2e.txt',
    preferred: '/assets/current-cache-wins-e2e.js',
  } as const

  try {
    await page.evaluate(async ({ asset, shell, preferred }) => {
      const probePrefix = 'ladderlab-v4-e2e-'
      const previous = await caches.open(`${probePrefix}previous`)
      const middle = await caches.open(`${probePrefix}middle`)
      const oldest = await caches.open(`${probePrefix}oldest`)
      await oldest.put(
        new Request(new URL(asset, location.origin)),
        new Response('export const answer = 42', {
          headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
        }),
      )
      await previous.put(
        new Request(new URL(shell, location.origin)),
        new Response('previous-runtime', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      )

      // 当前版缓存必须没有这两个探针；否则测试命中的是当前缓存，证明不了回退。
      const currentName = (await caches.keys()).find(
        (name) => name.startsWith('ladderlab-') && !name.startsWith(probePrefix),
      )
      if (!currentName) throw new Error('找不到当前 Service Worker 缓存')
      const current = await caches.open(currentName)
      for (const path of [asset, shell, preferred]) {
        const url = new URL(path, location.origin)
        const response = await current.match(url, { ignoreVary: true })
        if (response) await current.delete(url)
      }

      // 同一条资源在两版缓存里都存在时，必须继续返回当前版，旧缓存只能兜底。
      await previous.put(new Request(new URL(preferred, location.origin)), new Response('previous-version'))
      await middle.put(new Request(new URL(preferred, location.origin)), new Response('middle-version'))
      await oldest.put(new Request(new URL(preferred, location.origin)), new Response('oldest-version'))
      await current.put(new Request(new URL(preferred, location.origin)), new Response('current-version'))
    }, paths)

    const results = await page.evaluate(async ({ asset, shell, preferred }) => {
      const read = async (path: string) => {
        const response = await fetch(path)
        return { status: response.status, text: await response.text() }
      }
      return { asset: await read(asset), shell: await read(shell), preferred: await read(preferred) }
    }, paths)

    expect(results.asset).toEqual({ status: 200, text: 'export const answer = 42' })
    expect(results.shell).toEqual({ status: 200, text: 'previous-runtime' })
    expect(results.preferred).toEqual({ status: 200, text: 'current-version' })
  } finally {
    await page.evaluate(async () => {
      await Promise.all([
        caches.delete('ladderlab-v4-e2e-previous'),
        caches.delete('ladderlab-v4-e2e-middle'),
        caches.delete('ladderlab-v4-e2e-oldest'),
      ])
    })
  }
})
