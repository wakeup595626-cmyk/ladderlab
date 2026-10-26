import { useRef } from 'react'
import { useModalFocus } from '../lib/useModalFocus'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 不可逆或覆盖当前工程的操作，确认按钮使用警示色。 */
  danger?: boolean
}

export interface ConfirmDialogProps {
  options: ConfirmOptions
  onSettle: (value: boolean) => void
}

export default function ConfirmDialog({ options, onSettle }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalFocus<HTMLDivElement>(true, () => onSettle(false), cancelRef)

  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onSettle(false)
      }}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={options.description ? 'confirm-desc' : undefined}
        tabIndex={-1}
      >
        <h2 id="confirm-title">{options.title}</h2>
        {options.description && <p id="confirm-desc">{options.description}</p>}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="confirm-cancel" onClick={() => onSettle(false)}>
            {options.cancelLabel ?? '取消'}
          </button>
          <button
            type="button"
            className={options.danger ? 'confirm-ok is-danger' : 'confirm-ok'}
            onClick={() => onSettle(true)}
          >
            {options.confirmLabel ?? '继续'}
          </button>
        </div>
      </div>
    </div>
  )
}
