import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getSwUpdateSnapshot,
  getSessionUpdateStorage,
  getUpdateRegistration,
  refreshForUpdate,
  subscribeToSwUpdates,
} from '../lib/swUpdate'
import type { SwUpdateInfo } from '../lib/swUpdate'
import './UpdateBanner.css'

const TOPBAR_GAP = 8

/** Follow the rendered header instead of assuming its desktop height. At phone
 * widths the header wraps to two rows, so a fixed 64px offset covers the file
 * button and the menu opened from it. */
function useTopbarPosition() {
  const bannerRef = useRef<HTMLElement>(null)
  const [top, setTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    const banner = bannerRef.current
    const topbar = banner
      ?.closest('.app-shell')
      ?.querySelector<HTMLElement>('.wb-topbar')
    if (!topbar) return

    let active = true
    const place = () => {
      if (!active) return
      if (topbar.offsetHeight <= 0) return
      // 提示条是 fixed 定位，必须用视口坐标；offsetTop 是相对 offsetParent
      // 的文档坐标，壳层一旦有偏移或被滚动就会错位。首屏入场动画会短暂
      // 平移顶栏，因此动画结束时再量一次。
      const bottom = topbar.getBoundingClientRect().bottom
      const next = Math.ceil(bottom + TOPBAR_GAP)
      setTop((current) => (current === next ? current : next))
    }

    // Measure before paint; the observer covers the 520px wrap point, while
    // fonts.ready catches a later line-height change without a resize event.
    place()
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(place)
    observer?.observe(topbar)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, { passive: true, capture: true })
    topbar.addEventListener('animationend', place)
    topbar.addEventListener('transitionend', place)
    void document.fonts?.ready.then(place)

    // 顶栏带 360ms 的首屏入场动画，提示条又常常在动画播放到一半时出现：
    // 只量一次会停在动画中的中间位置。开头 40 帧连续跟一次，等布局稳定。
    let frame = 0
    let frameId: number | null = null
    const settle = () => {
      place()
      frame += 1
      frameId = frame < 40 ? window.requestAnimationFrame(settle) : null
    }
    frameId = window.requestAnimationFrame(settle)

    return () => {
      active = false
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, { capture: true })
      topbar.removeEventListener('animationend', place)
      topbar.removeEventListener('transitionend', place)
    }
  }, [])

  return { bannerRef, top }
}

export interface UpdateBannerViewProps {
  update: SwUpdateInfo
  onRefresh: () => void
  onLater: () => void
}

/** Presentation-only banner. The default export below is the store-connected
 * shell that can be dropped into App without props. */
export function UpdateBannerView({ update, onRefresh, onLater }: UpdateBannerViewProps) {
  const { bannerRef, top } = useTopbarPosition()

  return (
    <aside
      ref={bannerRef}
      className="sw-update-banner"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`应用更新提示，版本 ${update.version}`}
      style={top === null ? undefined : { top }}
    >
      <span>有新版本，点击刷新</span>
      <span className="sw-update-banner__actions">
        <button type="button" className="sw-update-banner__action" onClick={onLater}>
          稍后
        </button>
        <button
          type="button"
          className="sw-update-banner__action sw-update-banner__action--primary"
          onClick={onRefresh}
        >
          刷新
        </button>
      </span>
    </aside>
  )
}

export default function UpdateBanner() {
  const update = useSyncExternalStore(subscribeToSwUpdates, getSwUpdateSnapshot, getSwUpdateSnapshot)
  const [dismissedRevision, setDismissedRevision] = useState<number | null>(null)

  if (!update || dismissedRevision === update.revision) return null

  const reload = (): void => window.location.reload()
  const container = 'serviceWorker' in navigator ? navigator.serviceWorker : null

  return (
    <UpdateBannerView
      update={update}
      onRefresh={() =>
        refreshForUpdate(update, getUpdateRegistration(), getSessionUpdateStorage(), reload, container)
      }
      onLater={() => setDismissedRevision(update.revision)}
    />
  )
}
