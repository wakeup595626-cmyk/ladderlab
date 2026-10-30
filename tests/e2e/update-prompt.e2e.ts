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

/** Simulate a brand-new browser profile: no controller, then the first worker
 * installs, activates and calls clients.claim(). That controller hand-off must
 * not be mistaken for a deployed update that needs a refresh. */
async function installFakeFirstWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeWorker extends EventTarget {
      state: ServiceWorkerState = 'installing'
      scriptURL = new URL('sw.js', location.href).href

      postMessage(message: unknown, transfer?: Transferable[]): void {
        if (!message || typeof message !== 'object' || !('type' in message)) return
        if (message.type !== 'GET_VERSION') return
        const port = transfer?.[0]
        if (port && 'postMessage' in port) {
          port.postMessage({ type: 'LADDERLAB_VERSION', version: 'v6-first-install-e2e' })
        }
      }

      transitionTo(state: ServiceWorkerState): void {
        this.state = state
        this.dispatchEvent(new Event('statechange'))
      }
    }

    const worker = new FakeWorker()
    const registration = new EventTarget() as EventTarget & {
      installing: ServiceWorker | null
      waiting: ServiceWorker | null
      active: ServiceWorker | null
      update: () => Promise<void>
    }
    registration.installing = worker as unknown as ServiceWorker
    registration.waiting = null
    registration.active = null
    let started = false
    registration.update = async () => {
      if (started) return
      started = true
      registration.dispatchEvent(new Event('updatefound'))
      worker.transitionTo('installed')
      container.controller = worker as unknown as ServiceWorker
      container.dispatchEvent(new Event('controllerchange'))
      registration.installing = null
      registration.active = worker as unknown as ServiceWorker
      worker.transitionTo('activated')
      sessionStorage.setItem('ladderlab.fake-first-install', '1')
    }

    const container = new EventTarget() as EventTarget & {
      controller: ServiceWorker | null
      register: () => Promise<typeof registration>
    }
    container.controller = null
    container.register = async () => registration

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container,
    })
  })
}

test('全新用户首装 Service Worker 不会误报更新', async ({ page }) => {
  const errors = trackPageErrors(page)
  // 「文件」合并菜单只在 860px 以下出现；桌面宽屏是新建/导入/导出三个按钮。
  // 这里要验证首装不误报更新且文件菜单仍能打开，所以固定到窄屏布局。
  await page.setViewportSize({ width: 800, height: 720 })
  await installFakeFirstWorker(page)
  await openHome(page)
  await page.waitForFunction(() => sessionStorage.getItem('ladderlab.fake-first-install') === '1')

  await expect(page.getByRole('status', { name: /应用更新提示/ })).toHaveCount(0)
  await page.getByRole('button', { name: '文件：新建、导入或导出' }).click()
  await expect(page.getByRole('menu', { name: '文件操作' })).toBeVisible()
  expect(errors).toEqual([])
})

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

test('375px 顶栏折行时更新提示不挡住文件菜单', async ({ page }) => {
  const errors = trackPageErrors(page)
  await page.setViewportSize({ width: 375, height: 667 })
  await installFakeWaitingWorker(page, false)
  await page.goto('/')

  const banner = page.getByRole('status', { name: `应用更新提示，版本 ${VERSION}` })
  const topbar = page.locator('.wb-topbar')
  const fileButton = page.getByRole('button', { name: '文件：新建、导入或导出' })
  await expect(topbar).toBeVisible()
  await expect(banner).toBeVisible()

  const [bannerBox, topbarBox, fileBox] = await Promise.all([
    banner.boundingBox(),
    topbar.boundingBox(),
    fileButton.boundingBox(),
  ])
  if (!bannerBox || !topbarBox || !fileBox) throw new Error('更新提示或顶栏没有布局尺寸')

  expect(topbarBox.height).toBeGreaterThan(56)
  expect(bannerBox.y).toBeGreaterThanOrEqual(topbarBox.y + topbarBox.height + 8)
  expect(fileBox.y + fileBox.height).toBeLessThanOrEqual(bannerBox.y)

  const badgeBox = await page.locator('.support-badge').boundingBox()
  if (!badgeBox) throw new Error('咖啡浮标没有布局尺寸')
  const overlapsBadge = bannerBox.x < badgeBox.x + badgeBox.width
    && bannerBox.x + bannerBox.width > badgeBox.x
    && bannerBox.y < badgeBox.y + badgeBox.height
    && bannerBox.y + bannerBox.height > badgeBox.y
  expect(overlapsBadge).toBe(false)

  await fileButton.click()
  const menu = page.getByRole('menu', { name: '文件操作' })
  await expect(menu).toBeVisible()

  const sfcItem = menu.getByRole('menuitem', { name: '顺序功能图 SVG' })
  await expect(sfcItem).toBeInViewport()
  await sfcItem.click()
  await expect(menu).toBeHidden()
  await expect(page.getByRole('alert')).toContainText('这个工程还没有梯形图网络')
  expect(errors).toEqual([])
})

test('1280px 更新提示不压住收藏指令条和状态栏', async ({ page }) => {
  const errors = trackPageErrors(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await installFakeWaitingWorker(page, false)
  await page.goto('/')

  const banner = page.getByRole('status', { name: `应用更新提示，版本 ${VERSION}` })
  const strip = page.locator('.wb-instruction-strip')
  const statusbar = page.locator('.status-bar')
  await expect(banner).toBeVisible()
  await expect(strip).toBeVisible()

  const [bannerBox, stripBox, statusBox] = await Promise.all([
    banner.boundingBox(),
    strip.boundingBox(),
    statusbar.boundingBox(),
  ])
  if (!bannerBox || !stripBox || !statusBox) throw new Error('更新提示、收藏条或状态栏没有布局尺寸')

  expect(bannerBox.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height)
  expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(statusBox.y + 1)

  const toolsBlocked = await page.evaluate(() => {
    const tools = document.querySelector('.wb-instruction-tools')
    if (!tools) return true
    const rect = tools.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return !hit || !tools.contains(hit)
  })
  expect(toolsBlocked).toBe(false)
  expect(errors).toEqual([])
})
