import { expect, test, type Page } from '@playwright/test'
import { openHome, trackPageErrors } from './support'

const VERSION = 'v5-update-prompt-e2e'
const PROMPTED_KEY = `ladderlab.sw-update.prompted.v1:${VERSION}`
const REFRESHED_KEY = `ladderlab.sw-update.refreshed.v1:${VERSION}`

/** Install a deterministic SW lifecycle before main.tsx runs. The application's
 * real React/banner/state-machine code stays untouched; only the browser's
 * service-worker surface is replaced so the waiting-worker cases are instant. */
async function installFakeWaitingWorker(page: Page, seedPromptedMarker: boolean): Promise<void> {
  await page.addInitScript(
    ({ version, promptedKey, seed }) => {
      if (seed) sessionStorage.setItem(promptedKey, '1')
      const completed = sessionStorage.getItem('ladderlab.fake-update-complete') === '1'

      class FakeWorker extends EventTarget {
        state: ServiceWorkerState = 'installed'
        scriptURL = new URL('sw.js', location.href).href

        postMessage(message: unknown, transfer?: Transferable[]): void {
          if (!message || typeof message !== 'object' || !('type' in message)) return
          if (message.type === 'GET_VERSION') {
            const port = transfer?.[0]
            if (port && 'postMessage' in port) {
              port.postMessage({ type: 'LADDERLAB_VERSION', version })
            }
            return
          }
          if (message.type === 'SKIP_WAITING') {
            sessionStorage.setItem('ladderlab.fake-update-complete', '1')
            container.controller = this as unknown as ServiceWorker
            container.dispatchEvent(new Event('controllerchange'))
          }
        }
      }

      const active = new FakeWorker()
      active.state = 'activated'
      const waiting = new FakeWorker()
      const registration = new EventTarget() as EventTarget & {
        installing: ServiceWorker | null
        waiting: ServiceWorker | null
        active: ServiceWorker | null
        update: () => Promise<void>
      }
      registration.installing = null
      registration.waiting = completed ? null : (waiting as unknown as ServiceWorker)
      registration.active = active as unknown as ServiceWorker
      registration.update = async () => undefined

      const container = new EventTarget() as EventTarget & {
        controller: ServiceWorker | null
        register: () => Promise<typeof registration>
      }
      container.controller = active as unknown as ServiceWorker
      container.register = async () => registration

      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: container,
      })
    },
    { version: VERSION, promptedKey: PROMPTED_KEY, seed: seedPromptedMarker },
  )
}

test('稍后关闭后刷新页面仍会提示尚未安装的更新', async ({ page }) => {
  const errors = trackPageErrors(page)
  await installFakeWaitingWorker(page, true)
  await openHome(page)

  const banner = page.getByRole('status', { name: `应用更新提示，版本 ${VERSION}` })
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: '稍后' }).click()
  await expect(banner).toBeHidden()

  // A manual refresh does not activate a waiting worker. It must show the same
  // banner again even though the old implementation had left a prompted marker.
  await page.reload()
  await expect(page.getByRole('heading', { name: '梯形实验室' })).toBeVisible()
  await expect(banner).toBeVisible()
  expect(errors).toEqual([])
})

test('只有控制器真正移交后才记下刷新完成', async ({ page }) => {
  const errors = trackPageErrors(page)
  await installFakeWaitingWorker(page, false)
  await openHome(page)

  const banner = page.getByRole('status', { name: `应用更新提示，版本 ${VERSION}` })
  await expect(banner).toBeVisible()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), REFRESHED_KEY)).toBeNull()

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    banner.getByRole('button', { name: '刷新' }).click(),
  ])

  await expect(page.getByRole('heading', { name: '梯形实验室' })).toBeVisible()
  await expect(banner).toBeHidden()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), REFRESHED_KEY)).toBe('1')
  expect(errors).toEqual([])
})
