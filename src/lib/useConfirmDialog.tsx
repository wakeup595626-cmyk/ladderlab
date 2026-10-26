import { useCallback, useRef, useState } from 'react'
import ConfirmDialog, { type ConfirmOptions } from '../components/ConfirmDialog'

/**
 * 应用内确认框，替代 window.confirm：与整站视觉一致，也支持 Esc 与焦点回收。
 * 默认焦点落在“取消”上，避免回车误触会覆盖工程的操作。
 */
export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((next: ConfirmOptions) => {
    resolverRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setOptions(next)
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setOptions(null)
    resolve?.(value)
  }, [])

  const dialog = options ? <ConfirmDialog options={options} onSettle={settle} /> : null
  return { confirm, dialog }
}
