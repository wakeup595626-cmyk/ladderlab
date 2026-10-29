import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import './SupportBadge.css'
import alipayQr from '../assets/support-alipay.png'
import {
  ArrowUpRightIcon,
  CloseIcon,
  CoffeeIcon,
  GithubIcon,
  StarFilledIcon,
} from './Icons'

const GITHUB_PROFILE = 'https://github.com/wakeup595626-cmyk'
const GITHUB_REPO = 'https://github.com/wakeup595626-cmyk/ladderlab'
const REPO_API = 'https://api.github.com/repos/wakeup595626-cmyk/ladderlab'
/** Star 数只是锦上添花：缓存半小时，拉不到就只留图标，不影响编辑。 */
const STAR_CACHE_KEY = 'ladderlab.star-count'
const STAR_CACHE_TTL = 30 * 60 * 1000
/**
 * 落点按「可用行程的比例」保存：0 贴左/上，1 贴右/下。
 * 换窗口尺寸或换设备后浮标仍在相对位置，不会按旧像素卡在屏幕外。
 */
const ANCHOR_KEY = 'ladderlab.support-badge.anchor'
const DEFAULT_ANCHOR = { x: 0, y: 1 }
const MOUSE_THRESHOLD = 4
const TOUCH_THRESHOLD = 8
const PANEL_GAP = 10
const PANEL_WIDTH = 300
const FALLBACK_GAP = 12
const FALLBACK_BOTTOM = 46

type Point = { x: number; y: number }
type Anchor = { x: number; y: number }
type Viewport = { width: number; height: number }
type Insets = { gap: number; bottom: number }
type DragState = {
  pointerId: number
  captureTarget: Element
  startX: number
  startY: number
  originX: number
  originY: number
  current: Point
  moved: boolean
  threshold: number
  pointerType: string
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function readViewport(): Viewport {
  // position: fixed 的坐标系是布局视口，所以这里也用 innerWidth/innerHeight。
  return { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) }
}

/**
 * 探针是一颗 0×0 的固定定位钉子，钉在左下安全线上。
 * 读它的位置，等于把 CSS 断点、状态栏、移动端标签栏和安全区一次性换成像素，
 * 省得 JS 里再抄一份「46 / 94」这种会漂移的数字。
 */
function readInsets(probe: HTMLElement | null, viewport: Viewport): Insets {
  if (!probe) return { gap: FALLBACK_GAP, bottom: FALLBACK_BOTTOM }
  const rect = probe.getBoundingClientRect()
  return {
    gap: Math.max(0, rect.left),
    bottom: Math.max(0, viewport.height - rect.bottom),
  }
}

function travel(viewport: Viewport, size: { width: number; height: number }, insets: Insets) {
  return {
    x: Math.max(0, viewport.width - size.width - insets.gap * 2),
    y: Math.max(0, viewport.height - size.height - insets.gap - insets.bottom),
  }
}

function anchorToPixels(
  anchor: Anchor,
  size: { width: number; height: number },
  viewport: Viewport,
  insets: Insets,
): Point {
  const span = travel(viewport, size, insets)
  return {
    x: Math.round(insets.gap + anchor.x * span.x),
    y: Math.round(insets.gap + anchor.y * span.y),
  }
}

function pixelsToAnchor(
  point: Point,
  size: { width: number; height: number },
  viewport: Viewport,
  insets: Insets,
): Anchor {
  const span = travel(viewport, size, insets)
  return {
    x: span.x > 0 ? clamp((point.x - insets.gap) / span.x, 0, 1) : 0,
    y: span.y > 0 ? clamp((point.y - insets.gap) / span.y, 0, 1) : 0,
  }
}

function readAnchor(): Anchor | null {
  try {
    const raw = window.localStorage.getItem(ANCHOR_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { x, y } = parsed as { x?: unknown; y?: unknown }
    if (typeof x !== 'number' || !Number.isFinite(x)) return null
    if (typeof y !== 'number' || !Number.isFinite(y)) return null
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) }
  } catch {
    return null
  }
}

function writeAnchor(anchor: Anchor) {
  try {
    window.localStorage.setItem(ANCHOR_KEY, JSON.stringify(anchor))
  } catch {
    // 浏览器拒绝写入时仍然可以拖动，只是下次打开会回到默认位置。
  }
}

function readStarCount(): number | null {
  try {
    const raw = window.localStorage.getItem(STAR_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { count, at } = parsed as { count?: unknown; at?: unknown }
    if (typeof count !== 'number' || !Number.isFinite(count)) return null
    if (typeof at !== 'number' || Date.now() - at > STAR_CACHE_TTL) return null
    return count
  } catch {
    return null
  }
}

function formatStarCount(count: number): string {
  if (count < 1000) return String(count)
  return (count / 1000).toFixed(count < 10000 ? 1 : 0) + 'k'
}

/**
 * 常驻的小浮标：两枚 30px 图标，默认停在左下角，可拖到界面任意位置并记住落点。
 *
 * 咖啡段点开非模态浮层（支付宝收款码 + GitHub 入口），星标段打开仓库。
 * GitHub 不允许第三方网页代点 Star，网页能做的是把人送到仓库页并显示当前星标数。
 * 浮层刻意做成非模态（aria-modal=false），因为它是随时可关的附属信息，不该锁住画布。
 */
export default function SupportBadge() {
  const [open, setOpen] = useState(false)
  const [stars, setStars] = useState<number | null>(readStarCount)
  const [anchor, setAnchor] = useState<Anchor>(() => readAnchor() ?? DEFAULT_ANCHOR)
  const [viewport, setViewport] = useState<Viewport>(readViewport)
  const [frame, setFrame] = useState<Point | null>(null)
  const [dragging, setDragging] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const rootRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressNextClickRef = useRef(0)
  const panelId = useId()
  const hintId = panelId + '-drag-hint'
  const titleId = panelId + '-title'

  // 比例 -> 像素。首次挂载、拖动结束、窗口尺寸变化都走这一条路径。
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const size = { width: root.offsetWidth, height: root.offsetHeight }
    setFrame(anchorToPixels(anchor, size, viewport, readInsets(probeRef.current, viewport)))
  }, [anchor, viewport])

  useEffect(() => {
    const onResize = () => setViewport(readViewport())
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  useEffect(() => {
    if (stars !== null) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 6000)
    fetch(REPO_API, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        const count = (data as { stargazers_count?: unknown } | null)?.stargazers_count
        if (typeof count !== 'number') return
        setStars(count)
        try {
          window.localStorage.setItem(STAR_CACHE_KEY, JSON.stringify({ count, at: Date.now() }))
        } catch {
          // 隐私模式写不进缓存就下次再拉，展示失败不影响任何功能。
        }
      })
      .catch(() => {
        // 离线、被拦截或触发 GitHub 限流时保留纯图标入口。
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [stars])

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // 面板贴着浮标算位置：够高就往上翻，贴边就左右收，实在放不下才居中并允许内部滚动。
  useLayoutEffect(() => {
    // 面板关闭时整段卸载，样式留着也无妨：重开时本效果会在绘制前重新算一遍。
    if (!open) return
    const root = rootRef.current
    const panel = panelRef.current
    if (!root || !panel) return

    const rootRect = root.getBoundingClientRect()
    const insets = readInsets(probeRef.current, viewport)
    const width = Math.min(PANEL_WIDTH, Math.max(1, viewport.width - insets.gap * 2))
    const naturalHeight = Math.max(1, panel.scrollHeight)
    const spaceAbove = rootRect.top - PANEL_GAP - insets.gap
    const spaceBelow = viewport.height - rootRect.bottom - PANEL_GAP - insets.bottom
    const fits = spaceAbove >= naturalHeight || spaceBelow >= naturalHeight

    let maxHeight: number
    let top: number
    if (fits) {
      const placeAbove = spaceAbove >= naturalHeight || spaceAbove >= spaceBelow
      maxHeight = Math.min(naturalHeight, placeAbove ? spaceAbove : spaceBelow)
      top = placeAbove ? rootRect.top - PANEL_GAP - maxHeight : rootRect.bottom + PANEL_GAP
    } else {
      const room = viewport.height - insets.gap - insets.bottom
      maxHeight = Math.min(naturalHeight, room)
      top = insets.gap + Math.max(0, (room - maxHeight) / 2)
    }

    const preferredLeft = rootRect.left + width <= viewport.width - insets.gap
      ? rootRect.left
      : rootRect.right - width
    const left = clamp(
      preferredLeft,
      insets.gap,
      Math.max(insets.gap, viewport.width - width - insets.gap),
    )

    setPanelStyle({ left, top, width, maxHeight, visibility: 'visible' })
  }, [open, frame, viewport])

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

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    const root = rootRef.current
    const pill = pillRef.current
    if (!root || !pill) return
    const rect = root.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      // 捕获在真正被按下的按钮/图标上，而不是外层胶囊。外层接管 pointerup
      // 会把单击的 click 目标改成 div，咖啡与 Star 就再也点不开了。
      captureTarget: event.target instanceof Element ? event.target : pill,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      current: { x: rect.left, y: rect.top },
      moved: false,
      threshold: event.pointerType === 'mouse' ? MOUSE_THRESHOLD : TOUCH_THRESHOLD,
      pointerType: event.pointerType,
    }
    try {
      dragRef.current.captureTarget.setPointerCapture(event.pointerId)
    } catch {
      // 指针在按下瞬间就失效时拿不到捕获，后面的 move 自然也不会来。
    }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const root = rootRef.current
    if (!drag || !root || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < drag.threshold) return
      drag.moved = true
      setDragging(true)
      setOpen(false)
    }

    event.preventDefault()
    const size = { width: root.offsetWidth, height: root.offsetHeight }
    const current = readViewport()
    const insets = readInsets(probeRef.current, current)
    const span = travel(current, size, insets)
    const next = {
      x: clamp(drag.originX + dx, insets.gap, insets.gap + span.x),
      y: clamp(drag.originY + dy, insets.gap, insets.gap + span.y),
    }
    drag.current = next
    setFrame(next)
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const captureTarget = drag.captureTarget
    if (captureTarget.hasPointerCapture(event.pointerId)) {
      captureTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    if (!drag.moved) {
      // 触屏拖完后再轻点，部分浏览器会吞掉紧接着的原生 click。
      // 这里直接触发同一颗按钮/链接，并短暂屏蔽随后可能补发的 click。
      if (drag.pointerType !== 'mouse' && event.target instanceof Element) {
        const action = event.target.closest<HTMLElement>(
          '.support-badge-trigger, .support-badge-caption',
        )
        if (action) {
          event.preventDefault()
          action.click()
          suppressNextClickRef.current = performance.now() + 700
        }
      }
      return
    }
    setDragging(false)

    const root = rootRef.current
    if (root) {
      const size = { width: root.offsetWidth, height: root.offsetHeight }
      const current = readViewport()
      const insets = readInsets(probeRef.current, current)
      const next = pixelsToAnchor(drag.current, size, current, insets)
      setAnchor(next)
      writeAnchor(next)
    }

    // pointerup 之后浏览器还会补一次 click；先吃掉它，避免拖完误开面板或跳走。
    const swallow = (click: MouseEvent) => {
      click.preventDefault()
      click.stopPropagation()
    }
    window.addEventListener('click', swallow, true)
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 80)
  }

  const cancelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const captureTarget = drag.captureTarget
    if (captureTarget.hasPointerCapture(event.pointerId)) {
      captureTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    if (!drag.moved) return
    setDragging(false)
    // 浏览器接管手势（来电、系统级滚动）时退回按下时的位置，不写记忆。
    setFrame({ x: drag.originX, y: drag.originY })
  }

  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!event.altKey) return
    const directions: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }
    const direction = directions[event.key]
    if (!direction) return
    const root = rootRef.current
    if (!root) return
    event.preventDefault()

    const step = event.shiftKey ? 24 : 8
    const size = { width: root.offsetWidth, height: root.offsetHeight }
    const current = readViewport()
    const insets = readInsets(probeRef.current, current)
    const span = travel(current, size, insets)
    const base = frame ?? anchorToPixels(anchor, size, current, insets)
    const next = {
      x: clamp(base.x + direction.x * step, insets.gap, insets.gap + span.x),
      y: clamp(base.y + direction.y * step, insets.gap, insets.gap + span.y),
    }
    const nextAnchor = pixelsToAnchor(next, size, current, insets)
    setFrame(next)
    setAnchor(nextAnchor)
    writeAnchor(nextAnchor)
  }

  return (
    <div
      className="support-badge"
      ref={rootRef}
      data-open={open ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      style={frame ? { left: frame.x, top: frame.y, right: 'auto', bottom: 'auto' } : undefined}
      onKeyDownCapture={moveWithKeyboard}
    >
      <span className="support-badge-probe" ref={probeRef} aria-hidden="true" />
      <div
        className="support-badge-pill"
        ref={pillRef}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
        onDragStart={(event) => event.preventDefault()}
      >
        <span id={hintId} className="visually-hidden">
          可拖动到界面任意位置；键盘按住 Alt 加方向键移动，按住 Shift 加速。
        </span>
        <button
          type="button"
          ref={triggerRef}
          className="support-badge-trigger"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-haspopup="dialog"
          aria-label="请杯咖啡（打赏与项目链接）"
          aria-describedby={hintId}
          title="打赏与项目链接（可拖动）"
          onClick={(event) => {
            if (performance.now() < suppressNextClickRef.current) {
              event.preventDefault()
              return
            }
            setOpen((value) => !value)
          }}
        >
          <CoffeeIcon className="support-badge-icon" size={20} />
        </button>

        <span
          className="support-badge-caption"
          aria-hidden="true"
          onClick={(event) => {
            if (performance.now() < suppressNextClickRef.current) {
              event.preventDefault()
              return
            }
            setOpen((value) => !value)
          }}
        >
          请杯咖啡
        </span>
      </div>

      {open && (
        <section
          id={panelId}
          ref={panelRef}
          className="support-badge-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          style={panelStyle}
        >
          <header className="support-badge-head">
            <h2 id={titleId}>请杯咖啡</h2>
            <button
              type="button"
              ref={closeRef}
              className="support-badge-close"
              aria-label="收起打赏面板"
              onClick={() => close(true)}
            >
              <CloseIcon size={14} />
            </button>
          </header>

          <p className="support-badge-copy">
            免费、没有广告，靠业余时间维护。
            <br />
            如果它帮到了你，可以请作者喝杯咖啡。
          </p>

          <figure className="support-badge-scan">
            <img
              className="support-badge-qr"
              src={alipayQr}
              alt="支付宝收款二维码，收款人显示为「树」"
              width={640}
              height={727}
              draggable={false}
            />
            <figcaption>打开支付宝「扫一扫」即可</figcaption>
          </figure>

          <div className="support-badge-actions">
            <a
              className="support-badge-link is-primary"
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
            >
              <StarFilledIcon size={14} />
              <span className="support-badge-link-label">给项目点个 Star</span>
              <span className="support-badge-link-tail">
                {stars !== null && (
                  <span className="support-badge-count" aria-label={'当前 ' + stars + ' 个 Star'}>
                    {formatStarCount(stars)}
                  </span>
                )}
                <ArrowUpRightIcon size={13} />
              </span>
            </a>
            <a
              className="support-badge-link"
              href={GITHUB_PROFILE}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubIcon size={14} />
              <span className="support-badge-link-label">作者 GitHub 主页</span>
              <span className="support-badge-link-tail">
                <ArrowUpRightIcon size={13} />
              </span>
            </a>
          </div>
        </section>
      )}
    </div>
  )
}
