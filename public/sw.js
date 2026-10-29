/*
 * 梯形实验室 LadderLab · Service Worker
 * ---------------------------------------------------------------------------
 * 缓存版本：生产构建会自动把 CACHE_VERSION 写成
 * v6-<UTC时间戳>-<提交号>。时间戳在前，保证多个连续部署可以按名称可靠
 * 排序；老客户端下次访问时会安装新脚本并重新拉取构建产物。
 * 只清理本应用前缀（ladderlab-）的缓存，不影响同一域名下的其他站点。
 *
 * 策略：
 * - 安装：预缓存应用外壳、图标，以及构建后 index.html 引用的 JS/CSS 入口
 * - 安装：新版本装好后进入 waiting，不抢当前页面的控制权
 * - 激活：新 worker 接管页面，保留上一版缓存供尚未刷新的旧页面使用
 * - 导航请求：network-first，失败时回退缓存（离线可打开）
 * - 构建产物（路径含 /assets/）：cache-first（文件名带 hash，可长期缓存）
 * - 其他同源 GET：stale-while-revalidate
 *
 * 不在 install 里自动 skipWaiting：新 worker 一旦立刻接管，页面里还没加载的
 * 懒加载 chunk 会去要新部署里已经不存在的旧文件名，导出功能就会突然失效。
 */
const CACHE_PREFIX = 'ladderlab-'
const CACHE_VERSION = 'v6'
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION
// 新 worker 接管时，可能仍有多个旧标签页在请求不同部署的懒加载文件。
// 留三版并逐个回查，避免只保留一版时切页或导出突然 504。
const KEEP_PREVIOUS_CACHES = 3
const OFFLINE_URL = './index.html'
const ASSET_MANIFEST_URL = './asset-manifest.json'
const PRECACHE_URLS = [
  './',
  './index.html',
  ASSET_MANIFEST_URL,
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
  const preloaded = new Map()
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

  // A build manifest also covers lazy chunks that index.html does not name.
  // Without it, installing the app and then opening the exporter offline could
  // miss the ProgramImageExporter chunk until it had been loaded once online.
  try {
    const manifestResponse = await fetch(
      new Request(new URL(ASSET_MANIFEST_URL, scopeUrl), { cache: 'reload' }),
    )
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json()
      if (Array.isArray(manifest?.files)) {
        for (const file of manifest.files) {
          if (typeof file === 'string') urls.add(new URL(file, scopeUrl).href)
        }
      }
    }
  } catch {
    // Older builds predate the manifest; index.html entries still enable offline use.
  }

  // 字体在 CSS 里通过 url() 引用，HTML 上看不到。少这一步，断网首屏会退到
  // 系统字体，控制台还会刷一排 504。
  await Promise.all(
    [...urls]
      .filter((url) => url.endsWith('.css'))
      .map(async (cssUrl) => {
        try {
          const response = await fetch(new Request(cssUrl, { cache: 'reload' }))
          if (!response.ok) return
          preloaded.set(cssUrl, response.clone())
          const css = await response.text()
          for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
            const assetUrl = new URL(match[1], cssUrl)
            if (assetUrl.origin === self.location.origin) urls.add(assetUrl.href)
          }
        } catch {
          // A broken CSS file must not block the rest of the precache.
        }
      }),
  )

  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const response = preloaded.get(url) ?? (await fetch(new Request(url, { cache: 'reload' })))
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
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const previous = keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .sort(compareCacheNamesNewestFirst)
      await Promise.all(
        previous.slice(KEEP_PREVIOUS_CACHES).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const type = event.data && typeof event.data === 'object' ? event.data.type : null

  if (type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
    return
  }

  if (type === 'GET_VERSION') {
    const port = event.ports && event.ports[0]
    if (port) port.postMessage({ type: 'LADDERLAB_VERSION', version: CACHE_VERSION })
  }
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
    // 预缓存时用 URL 字符串写入（请求头是空的），而真实的导航请求带着
    // Accept / Accept-Encoding 等头；一旦响应带 Vary，普通 match 就会
    // 明明有缓存却匹配不到。ignoreVary 让离线回退稳定命中。
    const cached = await cache.match(request, { ignoreVary: true })
    if (cached) return cached

    const fallback = await cache.match(
      new URL(OFFLINE_URL, self.registration.scope).href,
      { ignoreVary: true },
    )
    if (fallback) return fallback

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>梯形实验室 LadderLab</title><p>当前处于离线状态，本地也没有可用缓存。请联网后再刷新页面。</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

async function handleCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  // 构建产物的响应通常带 Vary: Accept-Encoding，而 install 阶段是用 URL
  // 字符串写入缓存的；不加 ignoreVary 时离线刷新会退化成 504。
  const cached = await matchCachedResponse(cache, request)
  if (cached) return cached

  // 新 worker 接管旧标签页时，旧页面可能还没拿到新部署的 index.html，仍会
  // 请求上一版带 hash 的懒加载 chunk。当前缓存里没有，不代表响应已经从磁盘
  // 消失：激活时特意保留的上一版缓存仍在。仅在当前版本完全未命中时回查，
  // 确保本版资源永远优先。
  const previous = await matchPreviousCachedResponse(request)
  if (previous) return previous

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
  const cached = await matchCachedResponse(cache, request)
  const previous = cached ? null : await matchPreviousCachedResponse(request)

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => undefined)
      }
      return response
    })
    .catch(() => undefined)

  if (cached || previous) {
    // 后台静默更新，失败也不影响本次返回
    event.waitUntil(network)
    return cached || previous
  }

  const response = await network
  return response || new Response('', { status: 504, statusText: 'Offline' })
}

/** Cache.match 对请求头和 Vary 很敏感；导出产物统一按两种键各试一次。 */
async function matchCachedResponse(cache, request) {
  return (await cache.match(request, { ignoreVary: true }))
    ?? (await cache.match(request.url, { ignoreVary: true }))
}

function compareCacheNamesNewestFirst(left, right) {
  // 生产版本形如 v6-20261029123045123-abcdef123456；固定宽度的 UTC
  // 时间戳可以直接按字符串倒序。兜底版本也按整个后缀比较，避免旧版
  // v5-<随机提交号> 因大小版本相同而排错顺序。
  const version = (name) => name.slice(CACHE_PREFIX.length)
  return version(right).localeCompare(version(left), 'en', { numeric: true })
}

/**
 * 只回查本应用真正保留下来的上一版缓存，不扫描同域名下其他应用的缓存。
 * 单个旧响应读失败（例如另一标签页正在卸载缓存）时继续尝试下一项，而不是
 * 让整个 fetch 落到 504。
 */
async function matchPreviousCachedResponse(request) {
  let keys
  try {
    keys = await caches.keys()
  } catch {
    return undefined
  }
  const previous = keys
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .sort(compareCacheNamesNewestFirst)
  for (const key of previous.slice(0, KEEP_PREVIOUS_CACHES)) {
    try {
      const cache = await caches.open(key)
      const response = await matchCachedResponse(cache, request)
      if (response) return response
    } catch {
      // 缓存名只来自 CacheStorage 自己；单项打不开时继续回退。
    }
  }
  return undefined
}
