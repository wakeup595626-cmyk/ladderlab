import { useRef } from 'react'
import type { ProgramIssue } from '../lib/io'
import { useModalFocus } from '../lib/useModalFocus'
import './ProgramIssuesDialog.css'

/** 一次列全工程里的地址与引用问题；逐条挤在提示条里只会让人漏看。 */
export default function ProgramIssuesDialog({
  issues,
  onClose,
  onOpenTags,
}: {
  issues: ProgramIssue[]
  onClose: () => void
  onOpenTags: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose, closeRef)

  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog issues-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issues-title"
        tabIndex={-1}
      >
        <h2 id="issues-title">变量问题（{issues.length} 处）</h2>
        <p>工程已载入。修好这些地址和引用后，编译和导出就不会再被挡住。</p>
        <ol className="issues-list">
          {issues.map((issue, index) => <li key={index}>{issue.message}</li>)}
        </ol>
        <div className="confirm-actions">
          <button ref={closeRef} type="button" className="confirm-cancel" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="confirm-ok"
            onClick={() => {
              onClose()
              onOpenTags()
            }}
          >
            打开变量表
          </button>
        </div>
      </div>
    </div>
  )
}
