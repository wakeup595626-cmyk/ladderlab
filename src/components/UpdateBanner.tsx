import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getSwUpdateSnapshot,
  getSessionUpdateStorage,
  getUpdateRegistration,
  refreshForUpdate,
  subscribeToSwUpdates,
} from '../lib/swUpdate'
import type { SwUpdateInfo } from '../lib/swUpdate'
import './UpdateBanner.css'

export interface UpdateBannerViewProps {
  update: SwUpdateInfo
  onRefresh: () => void
  onLater: () => void
  closing?: boolean
}

/** Presentation-only banner. The default export below is the store-connected
 * shell that can be dropped into App without props. */
export function UpdateBannerView({
  update,
  onRefresh,
  onLater,
  closing = false,
}: UpdateBannerViewProps) {
  return (
    <aside
      className="sw-update-banner"
      data-state={closing ? 'closing' : 'open'}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`应用更新提示，版本 ${update.version}`}
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
  const [closingRevision, setClosingRevision] = useState<number | null>(null)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  if (!update || dismissedRevision === update.revision) return null

  const closing = closingRevision === update.revision
  const later = (): void => {
    if (closing || closeTimer.current !== null) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduceMotion) {
      setDismissedRevision(update.revision)
      return
    }
    setClosingRevision(update.revision)
    closeTimer.current = window.setTimeout(() => {
      setDismissedRevision(update.revision)
      closeTimer.current = null
    }, 140)
  }

  const reload = (): void => window.location.reload()
  const container = 'serviceWorker' in navigator ? navigator.serviceWorker : null

  return (
    <UpdateBannerView
      key={update.revision}
      update={update}
      closing={closing}
      onRefresh={() =>
        refreshForUpdate(update, getUpdateRegistration(), getSessionUpdateStorage(), reload, container)
      }
      onLater={later}
    />
  )
}
