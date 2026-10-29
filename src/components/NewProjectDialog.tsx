import { useRef, useState } from 'react'
import { FIELD_LIMITS } from '../lib/limits'
import { useModalFocus } from '../lib/useModalFocus'
import { CloseIcon } from './Icons'
import './ProjectImportDialog.css'
import './SaveProjectDialog.css'

interface NewProjectDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => void
}

const DEFAULT_NAME = '未命名工程'

export default function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  if (!open) return null
  return <NewProjectDialogContent onClose={onClose} onCreate={onCreate} />
}

function NewProjectDialogContent({
  onClose,
  onCreate,
}: Omit<NewProjectDialogProps, 'open'>) {
  const [name, setName] = useState(DEFAULT_NAME)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // 中文输入法选词时按 Enter 只是上屏，不能顺手把工程建出来。
  const composingRef = useRef(false)
  const dialogRef = useModalFocus<HTMLElement>(true, onClose, inputRef)
  const trimmedName = name.trim()

  const submit = () => {
    if (composingRef.current) return
    if (!trimmedName) {
      setError('请先给工程起个名字。')
      inputRef.current?.focus()
      return
    }
    onCreate(trimmedName)
  }

  return (
    <div
      className="project-import-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="project-import-dialog save-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        tabIndex={-1}
      >
        <div className="project-import-head">
          <h2 id="new-project-title">新建工程</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭新建工程"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <form
          className="save-project-form"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label className="save-project-field" htmlFor="new-project-name">
            <span>工程名称</span>
            <input
              ref={inputRef}
              id="new-project-name"
              value={name}
              maxLength={FIELD_LIMITS.programName}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(null)
              }}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                if (composingRef.current || event.nativeEvent.isComposing) return
                event.preventDefault()
                submit()
              }}
              onFocus={(event) => event.currentTarget.select()}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'new-project-error' : undefined}
            />
          </label>

          {error && (
            <p className="project-import-error" id="new-project-error" role="alert">{error}</p>
          )}

          <div className="project-import-actions">
            <button type="button" className="project-import-back" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="project-import-confirm">
              新建
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
