export interface UpdateStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface UpdateRegistrationLike {
  waiting: { postMessage(message: unknown): void } | null
}

/** The tiny slice of ServiceWorkerContainer the refresh path needs. */
export interface ControllerChangeSource {
  addEventListener(type: 'controllerchange', listener: () => void): void
  removeEventListener(type: 'controllerchange', listener: () => void): void
}

export interface SwUpdateInfo {
  version: string
  revision: number
}

export type SwUpdateListener = () => void

interface VersionMessage {
  type: 'LADDERLAB_VERSION'
  version: string
}

interface MonitorOptions {
  registration: ServiceWorkerRegistration
  container: ServiceWorkerContainer
  onUpdate?: (update: SwUpdateInfo) => void
}

const REFRESHED_KEY_PREFIX = 'ladderlab.sw-update.refreshed.v1:'
const VERSION_MESSAGE = 'LADDERLAB_VERSION'

let nextRevision = 1
let currentUpdate: SwUpdateInfo | null = null
let currentRegistration: UpdateRegistrationLike | null = null
const listeners = new Set<SwUpdateListener>()
const promptedInMemory = new Set<string>()
const refreshedInMemory = new Set<string>()

export function getSessionUpdateStorage(): UpdateStorageLike | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function versionKey(prefix: string, version: string): string {
  return `${prefix}${encodeURIComponent(version)}`
}

function readStorage(storage: UpdateStorageLike | null, key: string): string | null {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(storage: UpdateStorageLike | null, key: string): void {
  if (!storage) return
  try {
    storage.setItem(key, '1')
  } catch {
    // Private browsing and quota errors must not break update handling.
  }
}

/** The worker is ready to replace the page only when it is installed/activated
 * and this page was already controlled before that update was discovered. */
export function isUpdateReadyToPrompt(state: ServiceWorkerState, hadController: boolean): boolean {
  return hadController && (state === 'installed' || state === 'activated')
}

/** A refresh marker only records a confirmed controller hand-off. It is not a
 * reason to hide a worker that is still waiting: the previous refresh may have
 * timed out, or the hand-off may have happened in another tab. */
export function hasRefreshedUpdate(storage: UpdateStorageLike | null, version: string): boolean {
  return (
    refreshedInMemory.has(version) ||
    readStorage(storage, versionKey(REFRESHED_KEY_PREFIX, version)) !== null
  )
}

/** Claims the one automatic prompt for this document + worker version. The
 * claim is deliberately in-memory: dismissing the banner or reloading must not
 * permanently consume an update that is still waiting behind the old page. */
export function claimUpdatePrompt(version: string): boolean {
  if (!version || promptedInMemory.has(version) || refreshedInMemory.has(version)) return false

  promptedInMemory.add(version)
  return true
}

export function markUpdateRefreshed(storage: UpdateStorageLike | null, version: string): void {
  refreshedInMemory.add(version)
  writeStorage(storage, versionKey(REFRESHED_KEY_PREFIX, version))
}

/** Ask a waiting worker to activate, then reload once the new worker actually
 * controls the page. Reloading straight after postMessage raced the activation:
 * the page occasionally came back under the old worker, so the banner kept
 * returning. A short timeout keeps a broken worker from trapping the user. */
export function refreshForUpdate(
  update: Pick<SwUpdateInfo, 'version'>,
  registration: UpdateRegistrationLike | null,
  storage: UpdateStorageLike | null,
  reload: () => void,
  controller?: ControllerChangeSource | null,
  timeoutMs = 2000,
): void {
  const waiting = registration?.waiting ?? null

  // Nothing is waiting: the worker is already in control, reload right away.
  if (!waiting || !controller) {
    waiting?.postMessage({ type: 'SKIP_WAITING' })
    reload()
    return
  }

  let settled = false
  const finish = (activated: boolean): void => {
    if (settled) return
    settled = true
    controller.removeEventListener('controllerchange', onControllerChange)
    clearTimeout(timer)
    // A timeout fallback may still leave the waiting worker in place. Persist
    // success only after the browser confirms that it actually took control.
    if (activated) markUpdateRefreshed(storage, update.version)
    reload()
  }
  const onControllerChange = (): void => finish(true)
  const timer = setTimeout(() => finish(false), timeoutMs)

  controller.addEventListener('controllerchange', onControllerChange)
  try {
    waiting.postMessage({ type: 'SKIP_WAITING' })
  } catch {
    finish(false)
  }
}

export function subscribeToSwUpdates(listener: SwUpdateListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSwUpdateSnapshot(): SwUpdateInfo | null {
  return currentUpdate
}

export function getUpdateRegistration(): UpdateRegistrationLike | null {
  return currentRegistration
}

function publishUpdate(update: SwUpdateInfo): void {
  currentUpdate = update
  for (const listener of listeners) listener()
}

function isVersionMessage(value: unknown): value is VersionMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<VersionMessage>
  return message.type === VERSION_MESSAGE && typeof message.version === 'string' && message.version.length > 0
}

export function parseCacheVersion(source: string): string | null {
  const match = /\bCACHE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(source)
  return match?.[1] ?? null
}

async function requestWorkerVersion(worker: ServiceWorker): Promise<string | null> {
  if (typeof MessageChannel === 'undefined') return null

  return new Promise((resolve) => {
    const channel = new MessageChannel()
    let settled = false

    const finish = (version: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      channel.port1.close()
      resolve(version)
    }

    const timeout = setTimeout(() => finish(null), 1200)
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      finish(isVersionMessage(event.data) ? event.data.version : null)
    }

    try {
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2])
    } catch {
      finish(null)
    }
  })
}

async function readDeployedVersion(worker: ServiceWorker): Promise<string | null> {
  try {
    // Keep the fallback out of the old worker's stale-while-revalidate cache.
    const scriptUrl = new URL(worker.scriptURL)
    scriptUrl.searchParams.set('__lad_update_version', String(Date.now()))
    const response = await fetch(scriptUrl, { cache: 'no-store' })
    if (!response.ok) return null
    return parseCacheVersion(await response.text())
  } catch {
    return null
  }
}

/** Attaches to an update already in progress or one found later. The returned
 * cleanup removes every listener and prevents late version replies publishing. */
export function monitorServiceWorkerUpdates({
  registration,
  container,
  onUpdate,
}: MonitorOptions): () => void {
  let hadController = container.controller !== null
  const trackedWorkers = new Set<ServiceWorker>()
  const announcedWorkers = new WeakSet<ServiceWorker>()
  const versionRequests = new WeakMap<ServiceWorker, Promise<string | null>>()
  const cleanups: Array<() => void> = []
  let disposed = false

  currentRegistration = registration

  const readVersion = (worker: ServiceWorker): Promise<string | null> => {
    const existing = versionRequests.get(worker)
    if (existing) return existing

    const request = requestWorkerVersion(worker).then(async (version) => version ?? readDeployedVersion(worker))
    versionRequests.set(worker, request)
    return request
  }

  const inspectWorker = async (worker: ServiceWorker): Promise<void> => {
    if (
      disposed ||
      announcedWorkers.has(worker) ||
      !isUpdateReadyToPrompt(worker.state, hadController)
    ) {
      return
    }

    const version = await readVersion(worker)
    if (!version || disposed || announcedWorkers.has(worker)) return
    if (!claimUpdatePrompt(version)) return

    announcedWorkers.add(worker)
    const update = { version, revision: nextRevision++ }
    if (onUpdate) onUpdate(update)
    else publishUpdate(update)
  }

  const trackWorker = (worker: ServiceWorker | null): void => {
    if (!worker || trackedWorkers.has(worker)) return
    trackedWorkers.add(worker)

    const onStateChange = (): void => {
      void inspectWorker(worker)
    }
    worker.addEventListener('statechange', onStateChange)
    cleanups.push(() => worker.removeEventListener('statechange', onStateChange))
    void inspectWorker(worker)
  }

  const onUpdateFound = (): void => trackWorker(registration.installing)
  const rememberController = (): void => {
    // The first install controls the page without a banner. Remember that so a
    // later update in this same long-lived tab is still treated as an update.
    hadController = true
  }

  registration.addEventListener('updatefound', onUpdateFound)
  container.addEventListener('controllerchange', rememberController)
  cleanups.push(() => registration.removeEventListener('updatefound', onUpdateFound))
  cleanups.push(() => container.removeEventListener('controllerchange', rememberController))

  trackWorker(registration.installing)
  trackWorker(registration.waiting)

  return () => {
    disposed = true
    for (const cleanup of cleanups) cleanup()
    if (currentRegistration === registration) currentRegistration = null
  }
}
