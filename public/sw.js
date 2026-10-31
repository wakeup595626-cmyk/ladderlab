/*
 * 梯形实验室 LadderLab · Service Worker
 * ---------------------------------------------------------------------------
 * 缓存版本：生产构建会自动把 CACHE_VERSION 写成
 * v7-<提交时间>-<内容哈希>-<提交号>。提交时间在前，保证多个连续部署可以
 * 按名称可靠排序；内容哈希保证同一份源码重复构建得到同一版本。
 * 缓存前缀包含当前部署 scope 的指纹，同一域名下的多个副本不会互删缓存。
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
const CACHE_BASE = 'ladderlab-'
const CACHE_VERSION = 'v7'
const SCOPE_FINGERPRINT = fingerprintScope(self.registration.scope)
const CACHE_PREFIX = CACHE_BASE + SCOPE_FINGERPRINT + '-'
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION
// 新 worker 接管时，可能仍有多个旧标签页在请求不同部署的懒加载文件。
// 留三版并逐个回查，避免只保留一版时切页或导出突然 504。
const KEEP_PREVIOUS_CACHES = 3
const OFFLINE_URL = './index.html'
const ASSET_MANIFEST_URL = './asset-manifest.json'
const OPTIONAL_PRECACHE_URLS = [
  './',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
]

/** 只用于缓存命名；FNV-1a 足够区分部署路径，不承担安全用途。 */
function fingerprintScope(scope) {
  let hash = 0x811c9dc5
  for (let index = 0; index < scope.length; index += 1) {
    hash ^= scope.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

async function fetchRequired(url, label) {
  let response
  try {
    response = await fetch(new Request(url, { cache: 'reload' }))
  } catch (error) {
    throw new Error(`precache: ${label} 请求失败 (${url})`, { cause: error })
  }
  if (!response.ok) {
    throw new Error(`precache: ${label} 返回 HTTP ${response.status} (${url})`)
  }
  return response
}

/**
 * Cache the shell first, then read the built index and cache its hashed entry
 * assets too. Without this second step the first offline launch can get HTML
 * from the service worker but still miss the JavaScript and CSS chunks.
 */
async function precache(cache) {
  const scopeUrl = new URL('./', self.registration.scope).href
  const indexUrl = new URL('./index.html', scopeUrl).href
  const manifestUrl = new URL(ASSET_MANIFEST_URL, scopeUrl).href
  const required = new Set()
  const optional = new Set(OPTIONAL_PRECACHE_URLS.map((path) => new URL(path, scopeUrl).href))
  const stored = new Set()

  // 外壳三件套是离线可用的最低条件：任何一项失败都必须让 install 失败，
  // 保留旧的 Service Worker，而不是激活一个打开就 503 的空壳。
  const indexResponse = await fetchRequired(indexUrl, 'index.html')
  await Promise.all([
    cache.put(indexUrl, indexResponse.clone()),
    cache.put(scopeUrl, indexResponse.clone()),
  ])
  stored.add(indexUrl)
  stored.add(scopeUrl)

  const html = await indexResponse.text()
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"'#]+)["']/gi)) {
    const assetUrl = new URL(match[1], scopeUrl)
    if (assetUrl.origin !== self.location.origin) continue
    // 入口 JS/CSS 缺失时页面根本起不来，按必需资源处理。
    if (assetUrl.pathname.includes('/assets/') && /\.(?:js|css)$/i.test(assetUrl.pathname)) {
      required.add(assetUrl.href)
    } else {
      optional.add(assetUrl.href)
    }
  }

  // A build manifest also covers lazy chunks that index.html does not name.
  // Without it, installing the app and then opening the exporter offline could
  // miss the ProgramImageExporter chunk until it had been loaded once online.
  const manifestResponse = await fetchRequired(manifestUrl, 'asset-manifest.json')
  await cache.put(manifestUrl, manifestResponse.clone())
  stored.add(manifestUrl)
  const manifest = await manifestResponse.json()
  if (!Array.isArray(manifest?.files)) {
    throw new Error('precache: asset-manifest.json 格式不正确')
  }
  for (const file of manifest.files) {
    if (typeof file !== 'string') continue
    const assetUrl = new URL(file, scopeUrl)
    if (assetUrl.origin === self.location.origin) required.add(assetUrl.href)
  }

  await Promise.all(
    [...required].map(async (url) => {
      if (stored.has(url)) return
      const response = await fetchRequired(url, '构建资源')
      await cache.put(url, response.clone())
      stored.add(url)
      if (!url.endsWith('.css')) return
      // 字体在 CSS 里通过 url() 引用，HTML 上看不到。少这一步，断网首屏会
      // 退到系统字体，控制台还会刷一排 504。字体缺失不阻塞安装。
      const css = await response.text()
      for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
        const assetUrl = new URL(match[1], url)
        if (assetUrl.origin === self.location.origin) optional.add(assetUrl.href)
      }
    }),
  )

  await Promise.all(
    [...optional].map(async (url) => {
      if (stored.has(url)) return
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }))
        if (response.ok) await cache.put(url, response)
      } catch {
        // 图标、字体和旧浏览器兼容资源缺失不影响主程序离线启动。
      }
    }),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME)
        await precache(cache)
      } catch (error) {
        // 半成品缓存会让下一个版本误判“已缓存”，必须清掉再让 install 失败。
        await caches.delete(CACHE_NAME).catch(() => undefined)
        console.error('[LadderLab] 预缓存失败，保留上一版 Service Worker', error)
        throw error
      }
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const previous = keys.filter((key) => isOwnCache(key) && key !== CACHE_NAME)
      const currentScope = previous
        .filter((key) => key.startsWith(CACHE_PREFIX))
        .sort(compareCacheNamesNewestFirst)
      // 上一版 v6 缓存没有 scope 指纹；只保留一份过渡，下一轮部署后清掉。
      const legacy = previous
        .filter((key) => !key.startsWith(CACHE_PREFIX))
        .sort(compareCacheNamesNewestFirst)
      await Promise.all(
        [
          ...currentScope.slice(KEEP_PREVIOUS_CACHES),
          ...legacy.slice(1),
        ].map((key) => caches.delete(key)),
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
  // 生产版本形如 v7-<提交时间>-<内容哈希>-<提交号>；固定宽度的提交时间
  // 可以直接按字符串倒序。旧版 v6 的时间戳更宽，numeric 比较仍能对齐。
  const version = (name) => (
    name.startsWith(CACHE_PREFIX)
      ? name.slice(CACHE_PREFIX.length)
      : name.slice(CACHE_BASE.length)
  )
  return version(right).localeCompare(version(left), 'en', { numeric: true })
}

/** 当前 scope 的缓存，以及升级前没有 scope 指纹的 v6 缓存。 */
function isOwnCache(name) {
  return name.startsWith(CACHE_PREFIX) || /^ladderlab-v\d/.test(name)
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
    .filter((key) => isOwnCache(key) && key !== CACHE_NAME)
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
