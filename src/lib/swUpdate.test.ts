import { describe, expect, it, vi } from 'vitest'
import {
  claimUpdatePrompt,
  hasRefreshedUpdate,
  isUpdateReadyToPrompt,
  monitorServiceWorkerUpdates,
  parseCacheVersion,
  refreshForUpdate,
} from './swUpdate'
import type { ControllerChangeSource, UpdateStorageLike } from './swUpdate'

function createStorage(initial?: Iterable<readonly [string, string]>): UpdateStorageLike & {
  values: Map<string, string>
} {
  const values = new Map<string, string>(initial)
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

class FakeWorker extends EventTarget {
  readonly version: string
  state: ServiceWorkerState = 'installing'
  scriptURL = 'https://ladderlab.test/sw.js'

  constructor(version = 'v3-monitor-test') {
    super()
    this.version = version
  }

  postMessage = vi.fn((message: unknown, transfer?: Transferable[]) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return
    if (message.type !== 'GET_VERSION') return

    const port = transfer?.[0]
    if (port && 'postMessage' in port) {
      port.postMessage({ type: 'LADDERLAB_VERSION', version: this.version })
    }
  })

  transitionTo(state: ServiceWorkerState): void {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  installing: ServiceWorker | null = null
  waiting: ServiceWorker | null = null
  active: ServiceWorker | null = null
}

class FakeContainer extends EventTarget {
  controller: ServiceWorker | null

  constructor(controller: ServiceWorker | null) {
    super()
    this.controller = controller
  }
}

describe('service worker update detection', () => {
  it('requires an existing controller and an installed or activated worker', () => {
    expect(isUpdateReadyToPrompt('installed', true)).toBe(true)
    expect(isUpdateReadyToPrompt('activated', true)).toBe(true)
    expect(isUpdateReadyToPrompt('installing', true)).toBe(false)
    expect(isUpdateReadyToPrompt('installed', false)).toBe(false)
  })

  it('deduplicates banners in memory without consuming the update on disk', () => {
    const storage = createStorage()

    expect(claimUpdatePrompt('v3-once-test')).toBe(true)
    expect(claimUpdatePrompt('v3-once-test')).toBe(false)
    expect(storage.values.size).toBe(0)

    expect(claimUpdatePrompt('v4-once-test')).toBe(true)
  })

  it('does not let a stale forced-prompt marker hide a waiting worker', () => {
    const storage = createStorage([
      ['ladderlab.sw-update.prompted.v1:v3-waiting-test', '1'],
      ['ladderlab.sw-update.refreshed.v1:v3-waiting-test', '1'],
    ])

    expect(hasRefreshedUpdate(storage, 'v3-waiting-test')).toBe(true)
    expect(claimUpdatePrompt('v3-waiting-test')).toBe(true)
  })

  it('does not consume a refresh marker when no waiting worker is reachable', () => {
    const storage = createStorage()
    const reload = vi.fn()

    refreshForUpdate({ version: 'v3-refresh-test' }, null, storage, reload)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(hasRefreshedUpdate(storage, 'v3-refresh-test')).toBe(false)
    expect(claimUpdatePrompt('v3-refresh-test')).toBe(true)
  })

  it('posts SKIP_WAITING and calls the reload stub on refresh', () => {
    const postMessage = vi.fn()
    const reload = vi.fn()

    refreshForUpdate(
      { version: 'v3-click-test' },
      { waiting: { postMessage } },
      createStorage(),
      reload,
    )

    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('waits for controllerchange before reloading', () => {
    const postMessage = vi.fn()
    const reload = vi.fn()
    const container = new EventTarget()

    const storage = createStorage()
    refreshForUpdate(
      { version: 'v4-wait-test' },
      { waiting: { postMessage } },
      storage,
      reload,
      container as unknown as ControllerChangeSource,
    )

    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()
    expect(hasRefreshedUpdate(storage, 'v4-wait-test')).toBe(false)

    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(hasRefreshedUpdate(storage, 'v4-wait-test')).toBe(true)

    // A second controllerchange must not reload the page twice.
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('falls back to reloading when the new worker never takes control', () => {
    vi.useFakeTimers()
    try {
      const postMessage = vi.fn()
      const reload = vi.fn()

      const storage = createStorage()
      refreshForUpdate(
        { version: 'v4-timeout-test' },
        { waiting: { postMessage } },
        storage,
        reload,
        new EventTarget() as unknown as ControllerChangeSource,
        2000,
      )

      expect(reload).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1999)
      expect(reload).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(reload).toHaveBeenCalledTimes(1)
      expect(hasRefreshedUpdate(storage, 'v4-timeout-test')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the cache version from sw.js text', () => {
    expect(parseCacheVersion("const CACHE_VERSION = 'v3'")).toBe('v3')
    expect(parseCacheVersion('const OTHER = 1')).toBeNull()
  })

  it('announces an installed update only for a page that was already controlled', async () => {
    const worker = new FakeWorker()
    const registration = new FakeRegistration()
    const controlled = new FakeContainer({} as ServiceWorker)
    const onUpdate = vi.fn()
    const cleanup = monitorServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: controlled as unknown as ServiceWorkerContainer,
      onUpdate,
    })

    registration.installing = worker as unknown as ServiceWorker
    registration.dispatchEvent(new Event('updatefound'))
    worker.transitionTo('installed')

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({
        version: 'v3-monitor-test',
        revision: expect.any(Number),
      })
    })

    cleanup()
  })

  it('does not announce the first install of an uncontrolled page', async () => {
    const worker = new FakeWorker()
    const registration = new FakeRegistration()
    const uncontrolled = new FakeContainer(null)
    const onUpdate = vi.fn()
    const cleanup = monitorServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: uncontrolled as unknown as ServiceWorkerContainer,
      onUpdate,
    })

    registration.installing = worker as unknown as ServiceWorker
    registration.dispatchEvent(new Event('updatefound'))
    worker.transitionTo('installed')
    uncontrolled.controller = worker as unknown as ServiceWorker
    uncontrolled.dispatchEvent(new Event('controllerchange'))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onUpdate).not.toHaveBeenCalled()

    cleanup()
  })

  it('announces a waiting worker on startup even after an old prompt marker', async () => {
    const worker = new FakeWorker('v3-waiting-startup-test')
    worker.transitionTo('installed')
    const registration = new FakeRegistration()
    registration.waiting = worker as unknown as ServiceWorker
    const controlled = new FakeContainer({} as ServiceWorker)
    const onUpdate = vi.fn()
    const storage = createStorage([
      ['ladderlab.sw-update.prompted.v1:v3-waiting-startup-test', '1'],
      ['ladderlab.sw-update.refreshed.v1:v3-waiting-startup-test', '1'],
    ])
    expect(hasRefreshedUpdate(storage, 'v3-waiting-startup-test')).toBe(true)

    const cleanup = monitorServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: controlled as unknown as ServiceWorkerContainer,
      onUpdate,
    })

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({
        version: 'v3-waiting-startup-test',
        revision: expect.any(Number),
      })
    })

    cleanup()
  })

  it('does not show an update banner merely because a new worker took control', async () => {
    const worker = new FakeWorker()
    worker.transitionTo('activated')
    const registration = new FakeRegistration()
    registration.active = worker as unknown as ServiceWorker
    const controlled = new FakeContainer(worker as unknown as ServiceWorker)
    const onUpdate = vi.fn()
    const cleanup = monitorServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: controlled as unknown as ServiceWorkerContainer,
      onUpdate,
    })

    controlled.dispatchEvent(new Event('controllerchange'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onUpdate).not.toHaveBeenCalled()

    cleanup()
  })

  it('still detects later updates after the first install takes control', async () => {
    const firstWorker = new FakeWorker('v3-first-install-test')
    firstWorker.transitionTo('activated')
    const registration = new FakeRegistration()
    registration.active = firstWorker as unknown as ServiceWorker
    const container = new FakeContainer(null)
    const onUpdate = vi.fn()
    const cleanup = monitorServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: container as unknown as ServiceWorkerContainer,
      onUpdate,
    })

    container.controller = firstWorker as unknown as ServiceWorker
    container.dispatchEvent(new Event('controllerchange'))

    const nextWorker = new FakeWorker('v4-after-first-install-test')
    registration.installing = nextWorker as unknown as ServiceWorker
    registration.dispatchEvent(new Event('updatefound'))
    nextWorker.transitionTo('installed')

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({
        version: 'v4-after-first-install-test',
        revision: expect.any(Number),
      })
    })
    cleanup()
  })
})
