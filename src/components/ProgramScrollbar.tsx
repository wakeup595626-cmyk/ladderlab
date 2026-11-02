import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import './ProgramScrollbar.css'

interface ProgramScrollbarProps {
  paneRef: RefObject<HTMLElement | null>
  frameRef: RefObject<HTMLElement | null>
}

interface ScrollbarMetrics {
  top: number
  height: number
  thumbHeight: number
  maxScroll: number
}

const MIN_THUMB_HEIGHT = 56
const TRACK_INSET = 14
// The thumb sits outside the paper edge. On narrow desktop windows there is
// only the pane's 24px gutter to live in, so the gap shrinks before it clips.
const SCROLLBAR_WIDTH = 20
const OUTSIDE_GAP = 24
// A proportional thumb moves ~10px of document per pointer pixel on a long
// program. Students read that as a jump, so drag travel is geared down while
// the thumb itself still reports the real scroll position.
const DRAG_GAIN = 0.45

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * An always-visible scroll affordance for the drafting sheet. Wheel and trackpad
 * input still target the pane itself; this thumb gives the paper edge the direct
 * drag behaviour students expect from a desktop editor.
 */
export default function ProgramScrollbar({ paneRef, frameRef }: ProgramScrollbarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const metricsRef = useRef<ScrollbarMetrics | null>(null)
  const pointerRef = useRef<{
    pointerId: number
    startY: number
    startScroll: number
  } | null>(null)
  const [shown, setShown] = useState(false)
  const [dragging, setDragging] = useState(false)

  const paintThumb = useCallback(() => {
    const pane = paneRef.current
    const root = rootRef.current
    const thumb = thumbRef.current
    const metrics = metricsRef.current
    if (!pane || !root || !thumb || !metrics) return

    const maxThumbTop = Math.max(0, metrics.height - metrics.thumbHeight)
    const ratio = metrics.maxScroll > 0
      ? clamp(pane.scrollTop / metrics.maxScroll, 0, 1)
      : 0
    const offset = Math.round(maxThumbTop * ratio)
    thumb.style.height = `${metrics.thumbHeight}px`
    thumb.style.transform = `translate3d(0, ${offset}px, 0)`
    root.setAttribute('aria-valuemax', String(Math.round(metrics.maxScroll)))
    root.setAttribute('aria-valuenow', String(Math.round(pane.scrollTop)))
    root.setAttribute('aria-valuetext', `${Math.round(ratio * 100)}%`)
  }, [paneRef])

  const measure = useCallback(() => {
    const pane = paneRef.current
    const frame = frameRef.current
    const root = rootRef.current
    if (!pane || !frame || !root) return

    // The scrollbar lives inside the relative-positioned workbench. Measure in
    // that coordinate space so it follows the sheet when the coach strip or
    // topbar changes height, instead of freezing a viewport-relative top.
    const container = root.parentElement
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const paneRect = pane.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight)
    const height = Math.max(0, Math.round(paneRect.height - TRACK_INSET * 2))
    const shouldShow = maxScroll > 1 && height >= MIN_THUMB_HEIGHT && frameRect.width > 0
    setShown((current) => current === shouldShow ? current : shouldShow)
    if (!shouldShow) {
      metricsRef.current = null
      return
    }

    const top = Math.round(paneRect.top - containerRect.top + TRACK_INSET)
    // Keep the rail in the pink gutter outside the paper. The width handle
    // stays on the border itself, so the two controls no longer share a strip.
    const outsideRoom = Math.max(0, containerRect.right - frameRect.right)
    const gap = clamp(Math.round(outsideRoom - SCROLLBAR_WIDTH), 4, OUTSIDE_GAP)
    const left = Math.round(frameRect.right - containerRect.left + gap)
    const thumbHeight = Math.min(
      height,
      Math.max(
        MIN_THUMB_HEIGHT,
        Math.round(height * (pane.clientHeight / Math.max(pane.scrollHeight, pane.clientHeight))),
      ),
    )
    root.style.top = `${top}px`
    root.style.left = `${left}px`
    root.style.height = `${height}px`
    metricsRef.current = { top, height, thumbHeight, maxScroll }
    paintThumb()
  }, [frameRef, paintThumb, paneRef])

  useLayoutEffect(() => {
    measure()
    const pane = paneRef.current
    const frame = frameRef.current
    if (!pane) return

    let requestId = 0
    const queuePaint = () => {
      if (requestId) return
      requestId = window.requestAnimationFrame(() => {
        requestId = 0
        paintThumb()
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    if (frame) observer.observe(frame)
    window.addEventListener('resize', measure)
    pane.addEventListener('scroll', queuePaint, { passive: true })
    void document.fonts.ready.then(measure)

    return () => {
      if (requestId) window.cancelAnimationFrame(requestId)
      observer.disconnect()
      window.removeEventListener('resize', measure)
      pane.removeEventListener('scroll', queuePaint)
    }
  }, [frameRef, measure, paintThumb, paneRef])

  useEffect(() => {
    if (shown) paintThumb()
  }, [paintThumb, shown])

  useEffect(() => {
    const container = rootRef.current?.parentElement
    if (!container) return
    if (shown) container.setAttribute('data-program-scrollbar', 'true')
    else container.removeAttribute('data-program-scrollbar')
    return () => container.removeAttribute('data-program-scrollbar')
  }, [shown])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !shown) return
    const thumb = thumbRef.current
    const pane = paneRef.current
    const metrics = metricsRef.current
    if (!thumb || !pane || !metrics) return
    const thumbRect = thumb.getBoundingClientRect()
    // The rail is deliberately inert. Only the visible pill starts a drag, so
    // a stray click can never page the document or select another rung.
    if (event.clientY < thumbRect.top || event.clientY > thumbRect.bottom) return
    event.preventDefault()
    event.stopPropagation()
    pointerRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScroll: pane.scrollTop,
    }
    thumb.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    const pane = paneRef.current
    const metrics = metricsRef.current
    if (!pane || !metrics) return
    event.preventDefault()
    const delta = event.clientY - pointer.startY
    if (Math.abs(delta) < 2) return
    const maxThumbTop = Math.max(0, metrics.height - metrics.thumbHeight)
    const scrollPerPixel = maxThumbTop > 0 ? metrics.maxScroll / maxThumbTop : 0
    pane.scrollTop = clamp(
      pointer.startScroll + delta * scrollPerPixel * DRAG_GAIN,
      0,
      metrics.maxScroll,
    )
    paintThumb()
  }

  const endPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    const thumb = thumbRef.current
    if (thumb?.hasPointerCapture(pointer.pointerId)) {
      thumb.releasePointerCapture(pointer.pointerId)
    }
    pointerRef.current = null
    setDragging(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const pane = paneRef.current
    const metrics = metricsRef.current
    if (!pane || !metrics) return
    const page = Math.max(120, Math.round(pane.clientHeight * 0.86))
    const line = event.shiftKey ? 160 : 48
    let next: number | null = null
    if (event.key === 'ArrowUp') next = pane.scrollTop - line
    if (event.key === 'ArrowDown') next = pane.scrollTop + line
    if (event.key === 'PageUp') next = pane.scrollTop - page
    if (event.key === 'PageDown') next = pane.scrollTop + page
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = metrics.maxScroll
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    pane.scrollTop = clamp(next, 0, metrics.maxScroll)
    paintThumb()
  }

  return (
    <div
      ref={rootRef}
      className="program-scrollbar"
      role="scrollbar"
      aria-label="滚动程序块"
      aria-controls="wb-main"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={0}
      aria-valuenow={0}
      aria-keyshortcuts="ArrowUp ArrowDown PageUp PageDown Home End"
      data-dragging={dragging ? 'true' : undefined}
      hidden={!shown}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onLostPointerCapture={endPointerDrag}
      onKeyDown={handleKeyDown}
    >
      <span ref={thumbRef} className="program-scrollbar-thumb" aria-hidden="true" />
    </div>
  )
}
