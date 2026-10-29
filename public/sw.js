/*
 * 梯形实验室 LadderLab · Service Worker
 * ---------------------------------------------------------------------------
 * 缓存版本：修改下面的 CACHE_VERSION（例如从 'v1' 改成 'v2'）即可让已安装的
 * 老客户端在下次访问时安装新脚本、清理旧版本缓存并重新拉取构建产物。
 * 只清理本应用前缀（ladderlab-）的缓存，不影响同一域名下的其他站点。
 *
 * 策略：
 * - 安装：预缓存应用外壳、图标，以及构建后 index.html 引用的 JS/CSS 入口
 * - 激活：删除旧版本缓存并立即接管页面
 * - 导航请求：network-first，失败时回退缓存（离线可打开）
 * - 构建产物（路径含 /assets/）：cache-first（文件名带 hash，可长期缓存）
 * - 其他同源 GET：stale-while-revalidate
 */
const CACHE_PREFIX = 'ladderlab-'
const CACHE_VERSION = 'v2'
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION
const OFFLINE_URL = './index.html'
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
]

/**
 * Cache the shell first, then read the built index and cache its hashed entry
 * assets too. Without this second step the first offline launch can get HTML
 * from the service worker but still miss the JavaScript and CSS chunks.
 */
async function precache(cache) {
  const scopeUrl = new URL('./', self.registration.scope).href
  const urls = new Set(PRECACHE_URLS.map((path) => new URL(path, scopeUrl).href))
  let indexResponse = null

  try {
    indexResponse = await fetch(new Request(new URL('./index.html', scopeUrl), { cache: 'reload' }))
  } catch {
    // Keep the remaining shell URLs as best-effort precache entries.
  }

  if (indexResponse?.ok) {
    await Promise.all([
      cache.put(new URL('./index.html', scopeUrl), indexResponse.clone()).catch(() => undefined),
      cache.put(scopeUrl, indexResponse.clone()).catch(() => undefined),
    ])
    urls.delete(new URL('./index.html', scopeUrl).href)
    urls.delete(scopeUrl)

    const html = await indexResponse.text()
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"'#]+)["']/gi)) {
      const assetUrl = new URL(match[1], scopeUrl)
      if (assetUrl.origin === self.location.origin) urls.add(assetUrl.href)
    }
  }

  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }))
        if (response.ok) await cache.put(url, response)
      } catch {
        // A single missing asset must not prevent the worker from activating.
      }
    }),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await precache(cache)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event, request))
    return
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(handleCacheFirst(request))
    return
  }

  event.respondWith(handleStaleWhileRevalidate(event, request))
})

async function handleNavigation(event, request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    // 导航请求绕过 HTTP 缓存，新版本部署后刷新就能拿到新的 index.html；
    // 离线时仍然回退到下面的缓存。
    const response = await fetch(new Request(request, { cache: 'no-store' }))
    if (response && response.ok) {
      event.waitUntil(cache.put(request, response.clone()).catch(() => undefined))
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached

    const fallback = await cache.match(OFFLINE_URL)
    if (fallback) return fallback

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>梯形实验室 LadderLab</title><p>当前处于离线状态，本地也没有可用缓存。请联网后再刷新页面。</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

async function handleCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => undefined)
    }
    return response
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' })
  }
}

async function handleStaleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => undefined)
      }
      return response
    })
    .catch(() => undefined)

  if (cached) {
    // 后台静默更新，失败也不影响本次返回
    event.waitUntil(network)
    return cached
  }

  const response = await network
  return response || new Response('', { status: 504, statusText: 'Offline' })
}
