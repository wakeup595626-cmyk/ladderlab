import { useMemo, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { makeAgentPrompt } from '../lib/courseDesign'
import { useModalFocus } from '../lib/useModalFocus'
import { usePresence } from '../lib/usePresence'
import { CloseIcon, CopyIcon } from './Icons'
import './CourseDesignDialog.css'

interface CourseDesignDialogProps {
  open: boolean
  onClose: () => void
}

const QUICK_EXAMPLES = ['三层电梯', '四路抢答器', '推土机']

export default function CourseDesignDialog({ open, onClose }: CourseDesignDialogProps) {
  const { present, closing } = usePresence(open, 180)
  if (!present) return null
  return <CourseDesignDialogContent open={open} closing={closing} onClose={onClose} />
}

interface CourseDesignDialogContentProps extends CourseDesignDialogProps {
  closing: boolean
}

function CourseDesignDialogContent({ open, closing, onClose }: CourseDesignDialogContentProps) {
  const [query, setQuery] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')
  const queryRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useModalFocus<HTMLElement>(open, onClose, queryRef)
  const agentPrompt = useMemo(() => makeAgentPrompt(query), [query])
  const canCopy = query.trim().length > 0

  const updateQuery = (next: string) => {
    setQuery(next)
    setCopyState('idle')
  }

  const copyPrompt = async () => {
    if (!canCopy) return
    setCopyState(await copyText(agentPrompt) ? 'done' : 'failed')
  }

  return (
    <div
      className={`course-design-backdrop${closing ? ' is-closing' : ''}`}
      data-state={closing ? 'closing' : 'open'}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="course-design-dialog"
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        inert={closing}
        aria-labelledby="course-design-title"
        aria-describedby="course-design-description"
        tabIndex={-1}
      >
        <header className="course-design-head">
          <div className="course-design-title-wrap">
            <h2 id="course-design-title">让 AI 做课设</h2>
            <p id="course-design-description">填好要求，复制提示词，粘贴给电脑上的 Agent。</p>
          </div>
          <button
            type="button"
            className="icon-button course-design-close"
            onClick={onClose}
            aria-label="关闭 AI 课设"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="course-design-body">
          <label className="course-design-field">
            <span>课设要求</span>
            <textarea
              ref={queryRef}
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void copyPrompt()
                }
              }}
              placeholder="例如：三层电梯，每层有外呼、选层、开关门和急停。"
              rows={6}
              spellCheck={false}
            />
          </label>

          <div className="course-design-examples" aria-label="快捷填写课设要求">
            {QUICK_EXAMPLES.map((example) => (
              <button
                type="button"
                key={example}
                onClick={() => {
                  updateQuery(example)
                  queryRef.current?.focus()
                }}
              >
                {example}
              </button>
            ))}
          </div>

          <details className="course-design-prompt-preview">
            <summary>查看完整提示词</summary>
            <textarea
              value={agentPrompt}
              readOnly
              aria-label="Agent 提示词"
              rows={10}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
          </details>

        </div>

        <footer className="course-design-actions">
          <p className="course-design-feedback" role="status" aria-live="polite">
            {copyState === 'done'
              ? '已复制，去 Agent 里粘贴即可。'
              : copyState === 'failed'
                ? '复制失败，请展开提示词后手动复制。'
                : ''}
          </p>
          <button
            type="button"
            className="course-design-copy"
            disabled={!canCopy}
            onClick={() => void copyPrompt()}
            aria-keyshortcuts="Control+Enter Meta+Enter"
          >
            <CopyIcon size={16} />
            <span>
              {copyState === 'done'
                ? '已复制'
                : copyState === 'failed'
                  ? '重新复制'
                  : '复制提示词'}
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}
