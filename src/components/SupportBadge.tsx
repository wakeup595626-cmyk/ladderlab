import { useCallback, useEffect, useId, useRef, useState } from 'react'
import './SupportBadge.css'
import alipayQr from '../assets/support-alipay.png'

const GITHUB_PROFILE = 'https://github.com/wakeup595626-cmyk'
const GITHUB_REPO = 'https://github.com/wakeup595626-cmyk/ladderlab'
/** 关掉之后不再打扰；只存在本机浏览器，不参与云端同步。 */
const DISMISS_KEY = 'ladderlab.support-badge.dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(value: boolean) {
  try {
    window.localStorage.setItem(DISMISS_KEY, value ? '1' : '0')
  } catch {
    // 隐私模式禁用了存储时忽略：这个开关不影响任何工程数据。
  }
}

/**
 * 左下角常驻的「请我喝杯咖啡」标签。
 *
 * 左半段（咖啡）点开一张非模态浮层：支付宝收款码 + GitHub 入口；右半段
 * 是 GitHub 图标，一次点击直接新标签页打开作者主页。浮层刻意做成非模态
 * （aria-modal=false），因为它是随时可关的附属信息，不该把画布锁住。
 */
export default function SupportBadge() {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(readDismissed)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    // 打开后焦点交给关闭按钮；Esc 与点空白都能收起。
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 画布自己也有 Esc 逻辑（取消取点），浮层开着时先吃掉这一下。
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root || !(event.target instanceof Node)) return
      if (!root.contains(event.target)) setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, close])

  if (dismissed) return null

  return (
    <div className="support-badge" ref={rootRef} data-open={open ? 'true' : undefined}>
      <div className="support-badge-pill">
        <button
          type="button"
          ref={triggerRef}
          className="support-badge-trigger"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-haspopup="dialog"
          title="请我喝杯咖啡（支付宝收款码）"
          onClick={() => setOpen((value) => !value)}
        >
          <svg
            className="support-badge-icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" />
            <path d="M16 9h2.2a2.8 2.8 0 0 1 0 5.6H16" />
            <path d="M7.5 3.4c-.6.8.6 1.3 0 2.1M11 3.4c-.6.8.6 1.3 0 2.1" />
          </svg>
          <span className="support-badge-label">请我喝杯咖啡</span>
        </button>

        <a
          className="support-badge-github"
          href={GITHUB_PROFILE}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="在新标签页打开作者 GitHub 主页"
          title="作者 GitHub 主页"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      </div>

      {open && (
        <section
          id={panelId}
          className="support-badge-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${panelId}-title`}
        >
          <header className="support-badge-head">
            <h2 id={`${panelId}-title`}>请我喝杯咖啡</h2>
            <button
              type="button"
              ref={closeRef}
              className="support-badge-close"
              aria-label="收起打赏面板"
              onClick={() => close(true)}
            >
              ×
            </button>
          </header>

          <p className="support-badge-copy">
            这个工具免费、不插广告，靠业余时间维护。如果它帮你省了一晚上的调试，可以请作者喝杯咖啡。
          </p>

          <figure className="support-badge-qr">
            <img src={alipayQr} alt="支付宝收款二维码，收款人显示为「树」" width={640} height={727} />
            <figcaption>打开支付宝「扫一扫」即可</figcaption>
          </figure>

          <div className="support-badge-actions">
            <a
              className="support-badge-link is-primary"
              href={GITHUB_PROFILE}
              target="_blank"
              rel="noopener noreferrer"
            >
              去 GitHub 主页
              <span aria-hidden="true">↗</span>
            </a>
            <a
              className="support-badge-link"
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看源码
            </a>
          </div>

          <button
            type="button"
            className="support-badge-dismiss"
            onClick={() => {
              writeDismissed(true)
              setOpen(false)
              setDismissed(true)
            }}
          >
            以后不再显示
          </button>
        </section>
      )}
    </div>
  )
}
