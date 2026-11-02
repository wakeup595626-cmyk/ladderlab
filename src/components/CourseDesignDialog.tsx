import { useMemo, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { makeAgentPrompt } from '../lib/courseDesign'
import { useModalFocus } from '../lib/useModalFocus'
import { usePresence } from '../lib/usePresence'
import { BoltIcon, CloseIcon, CopyIcon } from './Icons'
import './CourseDesignDialog.css'

interface CourseDesignDialogProps {
  open: boolean
  onClose: () => void
}

const QUICK_EXAMPLES = ['三层电梯', '四路抢答器', '推土机', '八路流水灯', '十字路口交通灯']

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
            <span className="course-design-mark" aria-hidden="true"><BoltIcon size={19} /></span>
            <div>
              <h2 id="course-design-title">让 AI 做课设</h2>
              <p id="course-design-description">
                写清要求，复制提示词，交给电脑上的 AI。
              </p>
            </div>
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
          <ol className="course-design-steps" aria-label="三步完成课设">
            <li>
              <span className="course-design-step-index" aria-hidden="true">1</span>
              <div>
                <strong>写要求</strong>
                <span>写清题目、动作和停止条件。</span>
              </div>
            </li>
            <li>
              <span className="course-design-step-index" aria-hidden="true">2</span>
              <div>
                <strong>复制给 AI</strong>
                <span>复制后粘贴给电脑上的 AI。</span>
              </div>
            </li>
            <li>
              <span className="course-design-step-index" aria-hidden="true">3</span>
              <div>
                <strong>导入导出</strong>
                <span>打开链接，导入后导出图片或 PDF。</span>
              </div>
            </li>
          </ol>

          <label className="course-design-field">
            <span>你的课设要求</span>
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
              rows={4}
              spellCheck={false}
            />
          </label>

          <div className="course-design-examples" aria-label="快捷填写课设要求">
            <span>快速示例</span>
            {QUICK_EXAMPLES.map((example) => (
              <button type="button" key={example} onClick={() => updateQuery(example)}>
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

          <aside className="course-design-boundary">
            <strong>小提示</strong>
            <p>
              AI 不能运行命令时，可能只会给你工程文件。
            </p>
          </aside>

          <p className="course-design-library-note">
            现成梯形图在「项目 → 实验库」。
          </p>
        </div>

        <footer className="course-design-actions">
          <p className="course-design-feedback" role="status" aria-live="polite">
            {copyState === 'done'
              ? '已复制，粘贴给 AI 即可。'
              : copyState === 'failed'
                ? '复制失败，请展开提示词后手动复制。'
                : '复制后粘贴给电脑上的 AI。'}
          </p>
          <div className="course-design-action-buttons">
            <button type="button" className="course-design-cancel" onClick={onClose}>关闭</button>
            <button
              type="button"
              className="course-design-copy"
              disabled={!canCopy}
              onClick={() => void copyPrompt()}
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
          </div>
        </footer>
      </section>
    </div>
  )
}
