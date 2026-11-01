import { useEffect, useRef, useState } from 'react'
import { useMediaQuery } from './useMediaQuery'

/**
 * Keeps a closing surface mounted long enough for its exit transition to run.
 * The first render never mounts a surface that was already closed.
 */
export function usePresence(open: boolean, exitDurationMs = 160) {
  const [present, setPresent] = useState(open)
  const [closing, setClosing] = useState(false)
  const timerRef = useRef<number | null>(null)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  // CSS 已经移除动画时仍等满 300ms，会让指针看起来“失灵”。
  const effectiveExitMs = reduceMotion ? 0 : exitDurationMs

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect -- 退场计时器是外部副作用，开启时必须立即恢复在场状态
      setPresent(true)
      setClosing(false)
      return
    }

    if (!present) return
    // oxlint-disable-next-line react/set-state-in-effect -- 关闭事件触发退场计时，不能等下一次用户操作
    setClosing(true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setPresent(false)
      setClosing(false)
    }, effectiveExitMs)
  }, [effectiveExitMs, open, present])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return { present, closing }
}
