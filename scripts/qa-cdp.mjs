/** Shared safety policy for every browser acceptance script. */

export const DEFAULT_QA_CDP = 'http://127.0.0.1:9444'
export const DEFAULT_QA_APP_URL = 'http://127.0.0.1:4173/'

/** 页面上下文读取项目库（v2 分键，应用删除墓碑，兼容 v1）。 */
export const READ_LIBRARY_IN_PAGE = String.raw`(() => {
  try {
    const readJson = (raw) => {
      try { return raw ? JSON.parse(raw) : null } catch { return null }
    }
    if (localStorage.getItem('ladderlab.library.v2.ready')) {
      const tombstones = new Map()
      const records = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (!key) continue
        if (key.startsWith('ladderlab.library.v2.deleted.')) {
          const record = readJson(localStorage.getItem(key))
          if (record && typeof record.id === 'string' && Number.isFinite(record.deletedAt)) {
            tombstones.set(record.id, Math.max(tombstones.get(record.id) ?? 0, record.deletedAt))
          }
        } else if (key.startsWith('ladderlab.library.v2.project.')) {
          const record = readJson(localStorage.getItem(key))
          if (record) records.push(record)
        }
      }
      const projects = records.filter((record) => {
        const deletedAt = tombstones.get(record.id)
        return deletedAt === undefined || deletedAt < record.savedAt
      })
      projects.sort((left, right) => (right.savedAt ?? 0) - (left.savedAt ?? 0))
      return { schema: 2, projects }
    }
    return JSON.parse(localStorage.getItem('ladderlab.library.v1') ?? '{"projects":[]}')
  } catch { return null }
})()`

const DEFAULT_CONNECT_TIMEOUT_MS = 5000
const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const QA_KEEPER_URL = 'about:blank#ladderlab-qa-keeper'

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

export function selectExactPage(targets, appUrl, cdpUrl) {
  const matches = targets.filter((target) => target.type === 'page' && target.url === appUrl)
  if (matches.length === 0) {
    throw new Error(
      `QA 浏览器中找不到精确目标页 ${appUrl}（调试端口 ${cdpUrl}）。`
      + '请使用独立的 QA 浏览器标签页，或通过 LADDERLAB_URL 指定已打开的目标页。',
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `QA 浏览器中有 ${matches.length} 个完全相同地址的标签页 ${appUrl}（调试端口 ${cdpUrl}）。`
      + '无法判断哪一个属于本次运行；请关闭重复页后重试，或改用会创建独立标签页的验收脚本。',
    )
  }
  return matches[0]
}

/**
 * Keeps the isolated QA browser alive when a test tab is closed. The keeper is
 * deliberately a blank tab, so no application code or another audit can
 * navigate it to a page that takes ownership of the run.
 */
export async function ensureQaKeeperPage(cdpUrl, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
  const response = await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) {
    throw new Error(`无法读取 QA 标签页列表：${response.status} ${response.statusText}`)
  }
  const targets = await response.json()
  const existing = targets.find((target) => target.type === 'page' && target.url === QA_KEEPER_URL)
  if (existing) return existing

  const keeperResponse = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(QA_KEEPER_URL)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!keeperResponse.ok) {
    throw new Error(`无法创建 QA 保活页：${keeperResponse.status} ${keeperResponse.statusText}`)
  }
  return keeperResponse.json()
}

/**
 * Creates a tab owned by this run. QA scripts must never resize, navigate or
 * close a tab belonging to the person using the browser.
 */
export async function createQaPage(cdpUrl, initialUrl = 'about:blank', timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
  await ensureQaKeeperPage(cdpUrl, timeoutMs)
  const response = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(initialUrl)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`无法创建 QA 标签页：${response.status} ${response.statusText}`)
  }
  return response.json()
}

/**
 * A small CDP transport with bounded waits. Besides per-request timeouts it
 * also fails every in-flight request when the page navigates away or closes,
 * so an interrupted QA run reports an error instead of hanging forever.
 */
export async function connectToPage(target, {
  timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const eventHandlers = new Set()
  let nextId = 0
  let closedError = null
  let lastRequest = '无'

  const failPending = (error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  const handleClose = (event) => {
    const detail = event?.code ? `，代码 ${event.code}` : ''
    const error = new Error(
      `QA 标签页或调试连接已关闭：${target.id}（最近请求：${lastRequest}${detail}）`,
    )
    closedError = error
    failPending(error)
  }

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
      return
    }
    for (const handler of eventHandlers) handler(message)
  })
  socket.addEventListener('close', handleClose)
  socket.addEventListener('error', handleClose)

  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', reject, { once: true })
      }),
      timeoutMs,
      `连接 QA 标签页超时：${target.id}`,
    )
  } catch (error) {
    socket.close()
    throw error
  }

  function send(method, params = {}, timeout = requestTimeoutMs) {
    if (closedError) return Promise.reject(closedError)
    lastRequest = method
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP 请求超时（${timeout}ms）：${method}`))
      }, timeout)
      pending.set(id, { resolve, reject, timer })
      try {
        socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        reject(error)
      }
    })
  }

  function onEvent(handler) {
    eventHandlers.add(handler)
    return () => eventHandlers.delete(handler)
  }

  function close() {
    socket.close()
  }

  return { target, socket, send, onEvent, close }
}

/** Closes only the tab created by this run, and never the last page in Chrome. */
export async function closeQaPage(cdpUrl, targetId, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
  try {
    const response = await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return false
    const pages = (await response.json()).filter((target) => target.type === 'page')
    if (!pages.some((target) => target.id === targetId) || pages.length <= 1) return false
    const closed = await fetch(`${cdpUrl}/json/close/${encodeURIComponent(targetId)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return closed.ok
  } catch {
    return false
  }
}
