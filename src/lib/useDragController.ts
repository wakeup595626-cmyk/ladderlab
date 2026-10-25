import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { parseDropTarget, type DragPayload, type DropTarget } from './dragTypes'

export interface DragViewState {
  payload: DragPayload
  label: string
  x: number
  y: number
}

export interface DragController {
  drag: DragViewState | null
  target: DropTarget | null
  start: (event: ReactPointerEvent, payload: DragPayload, label: string) => void
}

export interface DragControllerOptions {
  onDragStart?: () => void
}

interface PendingDrag {
  payload: DragPayload
  label: string
  startX: number
  startY: number
  pointerId: number
  active: boolean
  touch: boolean
}

function targetKey(target: DropTarget | null): string {
  return target ? JSON.stringify(target) : ''
}

/**
 * 统一的鼠标 / 触控拖放内核。拖动超过 6px 才真正开始，单击仍然保留原有行为；
 * 投放点由画布上的 data-drop 属性声明，因而侧栏、程序块和网络头可以共用一个控制器。
 */
export function useDragController(
  onDrop: (payload: DragPayload, target: DropTarget) => void,
  options: DragControllerOptions = {},
): DragController {
  const [drag, setDrag] = useState<DragViewState | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const pendingRef = useRef<PendingDrag | null>(null)
  const targetRef = useRef<DropTarget | null>(null)
  const onDropRef = useRef(onDrop)
  const onDragStartRef = useRef(options.onDragStart)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    onDropRef.current = onDrop
  }, [onDrop])

  useEffect(() => {
    onDragStartRef.current = options.onDragStart
  }, [options.onDragStart])

  const finish = useCallback((commit: boolean) => {
    const pending = pendingRef.current
    cleanupRef.current?.()
    cleanupRef.current = null
    pendingRef.current = null
    delete document.body.dataset.dragKind
    setDrag(null)
    setTarget(null)

    if (!pending?.active) return
    if (commit && targetRef.current) {
      onDropRef.current(pending.payload, targetRef.current)
    }
    // 拖动结束后浏览器仍会派发一次 click；只吞掉紧随其后的那一次，
    // 避免额外选中元件或打开属性弹层。
    const swallow = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('click', swallow, true)
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 80)
    targetRef.current = null
  }, [])

  const start = useCallback((event: ReactPointerEvent, payload: DragPayload, label: string) => {
    if (event.button !== 0 || pendingRef.current) return
    const touch = event.pointerType !== 'mouse'
    if (touch) {
      const handle = event.target instanceof Element ? event.target.closest('[data-drag-handle]') : null
      if (!handle) return
    }

    const pending: PendingDrag = {
      payload,
      label,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      active: false,
      touch,
    }
    pendingRef.current = pending

    const move = (native: PointerEvent) => {
      const current = pendingRef.current
      if (!current || native.pointerId !== current.pointerId) return
      // Touch has its own non-passive listener below: SVG children do not
      // honour touch-action in Chromium, so the browser would cancel the
      // pointer as soon as the finger starts panning the sheet.
      if (current.touch) return
      native.preventDefault()
      updateFromPoint(native.clientX, native.clientY)
    }

    // A drawer may still be unmounting on the first move. Walk the visual
    // stack so the canvas below it can become a valid drop target at once.
    const updateFromPoint = (x: number, y: number) => {
      const current = pendingRef.current
      if (!current) return
      const dx = x - current.startX
      const dy = y - current.startY
      if (!current.active) {
        if (Math.hypot(dx, dy) < 6) return
        current.active = true
        onDragStartRef.current?.()
        document.body.dataset.dragKind = current.payload.type
      }
      setDrag({ payload: current.payload, label: current.label, x, y })
      const hit = document.elementsFromPoint(x, y)
        .map((element) => element.closest('[data-drop]'))
        .find((element): element is Element => element instanceof Element)
      const drop = hit ?? null
      const next = parseDropTarget(drop?.getAttribute('data-drop') ?? null)
      if (targetKey(next) !== targetKey(targetRef.current)) {
        targetRef.current = next
        setTarget(next)
      }
    }

    const touchMove = (native: TouchEvent) => {
      if (!pendingRef.current) return
      const point = native.touches[0]
      if (!point) return
      // The gesture belongs to the drag handle: keep the page still.
      native.preventDefault()
      updateFromPoint(point.clientX, point.clientY)
    }

    const touchEnd = (native: TouchEvent) => {
      if (native.touches.length > 0) return
      finish(true)
    }

    const touchCancel = (native: TouchEvent) => {
      if (native.touches.length > 0) return
      finish(false)
    }

    const up = (native: PointerEvent) => {
      if (native.pointerId !== pending.pointerId) return
      finish(true)
    }

    const cancel = (native: PointerEvent) => {
      if (native.pointerId !== pending.pointerId) return
      // Touch drags are driven by touch events; a pointercancel here only
      // means Chromium started (and we stopped) a pan.
      if (pending.touch) return
      finish(false)
    }

    const blur = () => finish(false)

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', blur)
    if (pending.touch) {
      window.addEventListener('touchmove', touchMove, { passive: false })
      window.addEventListener('touchend', touchEnd)
      window.addEventListener('touchcancel', touchCancel)
    }
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', blur)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('touchend', touchEnd)
      window.removeEventListener('touchcancel', touchCancel)
    }

  }, [finish])

  useEffect(() => () => finish(false), [finish])

  return { drag, target, start }
}
