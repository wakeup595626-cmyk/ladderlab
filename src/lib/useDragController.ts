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
export function useDragController(onDrop: (payload: DragPayload, target: DropTarget) => void): DragController {
  const [drag, setDrag] = useState<DragViewState | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const pendingRef = useRef<PendingDrag | null>(null)
  const targetRef = useRef<DropTarget | null>(null)
  const onDropRef = useRef(onDrop)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    onDropRef.current = onDrop
  }, [onDrop])

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
      const dx = native.clientX - current.startX
      const dy = native.clientY - current.startY
      if (!current.active) {
        if (Math.hypot(dx, dy) < 6) return
        current.active = true
        document.body.dataset.dragKind = current.payload.type
      }
      native.preventDefault()
      setDrag({ payload: current.payload, label: current.label, x: native.clientX, y: native.clientY })
      const hit = document.elementFromPoint(native.clientX, native.clientY)
      const drop = hit instanceof Element ? hit.closest('[data-drop]') : null
      // SVG <g> 与 HTML 元素都可能承载投放点，用 getAttribute 同时兼容两者。
      const next = parseDropTarget(drop?.getAttribute('data-drop') ?? null)
      if (targetKey(next) !== targetKey(targetRef.current)) {
        targetRef.current = next
        setTarget(next)
      }
    }

    const up = (native: PointerEvent) => {
      if (native.pointerId !== pending.pointerId) return
      finish(true)
    }

    const cancel = (native: PointerEvent) => {
      if (native.pointerId !== pending.pointerId) return
      finish(false)
    }

    const blur = () => finish(false)

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', blur)
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', blur)
    }

    if (touch) event.preventDefault()
  }, [finish])

  useEffect(() => () => finish(false), [finish])

  return { drag, target, start }
}
