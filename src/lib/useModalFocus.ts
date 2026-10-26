import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// 抽屉关闭与下一个弹层打开常发生在同一帧：此时 document.activeElement
// 已经退回 body，只有提前记住弹层外的上一个焦点，关闭后才能还回去。
let lastExternalFocus: HTMLElement | null = null
let tracking = false
const modalStack: symbol[] = []

function trackExternalFocus() {
  if (tracking || typeof document === 'undefined') return
  tracking = true
  document.addEventListener('focusin', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('[role="dialog"]')) return
    lastExternalFocus = target
  }, true)
}

/** Keeps keyboard focus inside an open dialog and restores it on close. */
export function useModalFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const containerRef = useRef<T>(null)
  const closeRef = useRef(onClose)
  const initialFocusTarget = useRef(initialFocusRef)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    initialFocusTarget.current = initialFocusRef
  }, [initialFocusRef])

  useEffect(() => {
    if (!open) return
    trackExternalFocus()
    const modalId = Symbol('modal')
    modalStack.push(modalId)
    const active = document.activeElement
    let previous = active instanceof HTMLElement || active instanceof SVGElement ? active : null
    if (!previous || previous === document.body) {
      previous = lastExternalFocus
    }

    const focusable = () => Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter((element) => (
      !element.hasAttribute('hidden')
      && element.getAttribute('aria-hidden') !== 'true'
      && element.getClientRects().length > 0
    ))

    const focusTimer = window.setTimeout(() => {
      if (modalStack[modalStack.length - 1] !== modalId) return
      const preferred = initialFocusTarget.current?.current
      const items = focusable()
      // 指定了落点就严格用它；落点被隐藏时退回普通控件，避免手机自动弹出键盘。
      const visiblePreferred = preferred && items.includes(preferred) ? preferred : null
      const fallback = initialFocusTarget.current
        ? items.find((element) => !element.matches('input, select, textarea')) ?? items[0]
        : items.find((element) => element.matches('input, select, textarea')) ?? items[0]
      const target = visiblePreferred ?? fallback ?? containerRef.current
      target?.focus()
    }, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== modalId) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        containerRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const focused = document.activeElement
      if (event.shiftKey && (focused === first || !containerRef.current?.contains(focused))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (focused === last || !containerRef.current?.contains(focused))) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
      const wasTop = modalStack[modalStack.length - 1] === modalId
      const index = modalStack.indexOf(modalId)
      if (index >= 0) modalStack.splice(index, 1)
      if (wasTop && previous?.isConnected) previous.focus()
    }
  }, [open])

  return containerRef
}
