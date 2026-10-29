import { useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
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
}

const bannerStyle: CSSProperties = {
  position: 'fixed',
  top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
  left: '50%',
  zIndex: 250,
  display: 'flex',
  width: 'min(560px, calc(100vw - 24px))',
  minHeight: 44,
  transform: 'translateX(-50%)',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '8px 14px',
  padding: '7px 8px 7px 14px',
  border: '1px solid var(--accent-ink)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: 'var(--shadow-overlay)',
  fontFamily: 'var(--sans)',
  fontSize: 'var(--fs-body)',
}

const actionGroupStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginLeft: 'auto',
}

const buttonStyle: CSSProperties = {
  padding: '0 12px',
  border: '1px solid var(--control)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: '12.5px',
  cursor: 'pointer',
}

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: 'var(--accent-ink)',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
}

/** Presentation-only banner. The default export below is the store-connected
 * shell that can be dropped into App without props. */
export function UpdateBannerView({ update, onRefresh, onLater }: UpdateBannerViewProps) {
  return (
    <aside
      className="sw-update-banner"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`应用更新提示，版本 ${update.version}`}
      style={bannerStyle}
    >
      <span>有新版本，点击刷新</span>
      <span style={actionGroupStyle}>
        <button type="button" className="sw-update-banner__action" onClick={onLater} style={buttonStyle}>
          稍后
        </button>
        <button
          type="button"
          className="sw-update-banner__action"
          onClick={onRefresh}
          style={primaryButtonStyle}
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
