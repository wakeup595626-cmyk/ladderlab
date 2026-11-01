import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE = [
  'summary',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// 抽屉关闭与下一个弹层打开常发生在同一帧：此时 document.activeElement
// 已经退回 body，只有提前记住弹层外的上一个焦点，关闭后才能还回去。
// 监听器从模块加载时就存在，因为触屏点击不一定先让触发按钮获得焦点；
// 若等首个弹层打开才注册，首次打开时已经错过了真正的触发点。
interface FocusMemory {
  lastExternalFocus: HTMLElement | null
  tracking: boolean
}

const focusMemory = (() => {
  const host = globalThis as typeof globalThis & {
    __ladderlabFocusMemory?: FocusMemory
  }
  host.__ladderlabFocusMemory ??= {
    lastExternalFocus: null,
    tracking: false,
  }
  return host.__ladderlabFocusMemory
})()
interface ModalEntry {
  id: symbol
  container: HTMLElement | null
  /** 被这一层压住的上一层弹层；关闭时恢复它原来的惰性状态。 */
  masked?: {
    container: HTMLElement
    wasInert: boolean
    ariaHidden: string | null
    ariaModal: string | null
  }
}

const modalStack = (() => {
  const host = globalThis as typeof globalThis & { __ladderlabModalStack?: ModalEntry[] }
  host.__ladderlabModalStack ??= []
  return host.__ladderlabModalStack
})()

/**
 * 焦点只能还给仍然可见、可交互的节点。正在退场的弹层会保留 DOM 但带
 * `inert`，直接对它里面的按钮调用 focus() 会静默失败并让焦点掉到 body。
 */
function canRestoreFocus(node: Element | null): node is HTMLElement {
  if (!(node instanceof HTMLElement) || !node.isConnected) return false
  if (node.getClientRects().length === 0) return false
  if (node.closest('[inert], [aria-hidden="true"], [data-state="closing"]')) return false
  return true
}

function trackExternalFocus() {
  if (focusMemory.tracking || typeof document === 'undefined') return
  focusMemory.tracking = true
  const remember = (candidate: EventTarget | null) => {
    const target = candidate
    if (!(target instanceof HTMLElement)) return
    if (target.closest('[role="dialog"]')) return
    focusMemory.lastExternalFocus = target.closest<HTMLElement>(
      'summary, button, a[href], input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? target
  }
  document.addEventListener('focusin', (event) => remember(event.target), true)
  document.addEventListener('pointerdown', (event) => remember(event.target), true)
}

trackExternalFocus()

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
    // 弹层内容只在 open 时挂载，effect 运行时容器已经确定。把节点捕获到
    // 本次 effect 中，既让焦点陷阱始终指向同一个弹层，也避免退场清理时
    // 因 ref 已清空而无法判断焦点是否仍在弹层内部。
    const container = containerRef.current
    const modalId = Symbol('modal')
    const entry: ModalEntry = { id: modalId, container }
    const below = modalStack[modalStack.length - 1]
    modalStack.push(entry)
    // 嵌套弹层（例如实验库上的确认框）把下层整个设为惰性：键盘之外，
    // 读屏和虚拟光标也不能继续进入背景弹层。
    if (below?.container && container && below.container !== container
      && !below.container.contains(container) && !container.contains(below.container)) {
      entry.masked = {
        container: below.container,
        wasInert: below.container.inert,
        ariaHidden: below.container.getAttribute('aria-hidden'),
        ariaModal: below.container.getAttribute('aria-modal'),
      }
      below.container.inert = true
      below.container.setAttribute('aria-hidden', 'true')
      // 同一时刻只能有一个模态对话框：下层仍保留 role=dialog，
      // 但不能再向读屏声明 aria-modal，否则两层都会声称独占页面。
      below.container.removeAttribute('aria-modal')
    }
    const active = document.activeElement
    let previous = active instanceof HTMLElement || active instanceof SVGElement ? active : null
    if (!previous || previous === document.body) {
      previous = focusMemory.lastExternalFocus
    }

    const focusable = () => Array.from(
      container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter((element) => {
      if (
        element.hasAttribute('hidden')
        || element.getAttribute('aria-hidden') === 'true'
        || element.getClientRects().length === 0
      ) return false
      // 折叠的 <details> 只有自己的 summary 可聚焦；里面的控件虽然仍有
      // 布局矩形，浏览器原生 Tab 会跳过它们，焦点陷阱必须和原生行为一致。
      const closedDetails = element.closest('details:not([open])')
      if (closedDetails) {
        const ownSummary = closedDetails.querySelector(':scope > summary')
        if (element !== ownSummary) return false
      }
      return true
    })

    const focusTimer = window.setTimeout(() => {
      if (modalStack[modalStack.length - 1]?.id !== modalId) return
      const preferred = initialFocusTarget.current?.current
      const items = focusable()
      // 指定了落点就严格用它；落点被隐藏时退回普通控件，避免手机自动弹出键盘。
      // 标题一类 tabIndex={-1} 的元素不在 Tab 序列里，但作为初始焦点仍然合法，
      // 而且比落在第一个输入框上更能说明“现在打开的是哪个弹层”。
      const visiblePreferred = preferred && (
        items.includes(preferred)
        || (preferred.tabIndex === -1 && preferred.getClientRects().length > 0)
      )
        ? preferred
        : null
      const fallback = initialFocusTarget.current
        ? items.find((element) => !element.matches('input, select, textarea')) ?? items[0]
        : items.find((element) => element.matches('input, select, textarea')) ?? items[0]
      const target = visiblePreferred ?? fallback ?? container
      target?.focus()
    }, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1]?.id !== modalId) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        container?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const focused = document.activeElement as HTMLElement | null
      // 焦点可能停在标题这类 tabIndex=-1 的非 Tab 序列节点上；
      // 此时 index=-1，Shift+Tab 必须回到末项，Tab 必须回到首项，
      // 不能因为“仍在容器内”就放行焦点逃到背景。
      const index = focused ? items.indexOf(focused) : -1
      if (event.shiftKey && index <= 0) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (index < 0 || index === items.length - 1)) {
        event.preventDefault()
        first.focus()
      }
    }

    // 捕获阶段接管 Esc：弹层里的输入框或第三方扩展常会截断冒泡，
    // 用冒泡监听会出现“按 Esc 没反应”的假死感。
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown, true)
      const wasTop = modalStack[modalStack.length - 1]?.id === modalId
      const index = modalStack.findIndex((item) => item.id === modalId)
      if (index >= 0) modalStack.splice(index, 1)
      if (entry.masked) {
        entry.masked.container.inert = entry.masked.wasInert
        if (entry.masked.ariaHidden === null) entry.masked.container.removeAttribute('aria-hidden')
        else entry.masked.container.setAttribute('aria-hidden', entry.masked.ariaHidden)
        if (entry.masked.ariaModal === null) entry.masked.container.removeAttribute('aria-modal')
        else entry.masked.container.setAttribute('aria-modal', entry.masked.ariaModal)
      }
      // 退场动画期间底层可以继续操作。只有当用户的焦点仍停留在弹层里、
      // 或已经退回 body 时才归还焦点；用户主动点到的外部控件必须保留。
      const activeElement = document.activeElement
      const shouldRestore = !activeElement
        || activeElement === document.body
        || Boolean(container?.contains(activeElement))
      const restoreTarget = canRestoreFocus(previous)
        ? previous
        : canRestoreFocus(focusMemory.lastExternalFocus)
          ? focusMemory.lastExternalFocus
          : document.getElementById('wb-main')
      if (wasTop && shouldRestore) restoreTarget?.focus()
    }
  }, [open])

  return containerRef
}
