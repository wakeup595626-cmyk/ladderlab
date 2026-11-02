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
  const promptRef = useRef<HTMLTextAreaElement>(null)
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
              <h2 id="course-design-title">让 Agent 做课设</h2>
              <p id="course-design-description">
                网页只生成提示词，不调用 AI，也不上传你的题目。
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button course-design-close"
            onClick={onClose}
            aria-label="关闭 Agent 课设"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="course-design-body">
          <ol className="course-design-steps" aria-label="三步完成课设">
            <li>
              <span className="course-design-step-index" aria-hidden="true">1</span>
              <div>
                <strong>打开本地 Agent</strong>
                <span>Codex、Claude Code 或 Cursor，确认它能读写仓库并运行 Node。</span>
              </div>
            </li>
            <li>
              <span className="course-design-step-index" aria-hidden="true">2</span>
              <div>
                <strong>填写并复制需求</strong>
                <span>下面会实时生成完整提示词，整段发给 Agent，不需要自己改命令。</span>
              </div>
            </li>
            <li>
              <span className="course-design-step-index" aria-hidden="true">3</span>
              <div>
                <strong>打开链接并导出</strong>
                <span>点开 Agent 返回的分享链接，导入后导出 PNG、SVG 或分页 PDF。</span>
              </div>
            </li>
          </ol>

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
              aria-label="课设要求"
              placeholder="例如：三层电梯，每层有外呼按钮和选层按钮，显示运行方向与当前楼层；到站开门并延时关门，急停复位后回到安全状态。"
              rows={4}
              spellCheck={false}
            />
          </label>

          <div className="course-design-examples" aria-label="快捷填写课设要求">
            <span>填入示例</span>
            {QUICK_EXAMPLES.map((example) => (
              <button type="button" key={example} onClick={() => updateQuery(example)}>
                {example}
              </button>
            ))}
          </div>

          <label className="course-design-field course-design-prompt-field">
            <span className="course-design-field-head">
              <span>完整 Agent 提示词</span>
              <small>随需求实时更新</small>
            </span>
            <textarea
              ref={promptRef}
              value={agentPrompt}
              readOnly
              aria-label="Agent 提示词"
              rows={12}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>

          <aside className="course-design-boundary">
            <strong>能力边界</strong>
            <p>
              能访问仓库并运行 Node 的 Agent，才能完成编译校验和分享链接；
              纯聊天环境只能交付完整 JSON，并标注“未经仓库校验器验证”。
            </p>
          </aside>

          <p className="course-design-library-note">
            14 个已验证实验仍保存在「项目 → 实验库」，需要现成梯形图时可以直接载入。
          </p>
        </div>

        <footer className="course-design-actions">
          <p className="course-design-feedback" role="status" aria-live="polite">
            {copyState === 'done'
              ? '提示词已复制，去粘贴给本机 Agent。'
              : copyState === 'failed'
                ? '复制失败，请点提示词框后按 Ctrl+A 全选。'
                : '复制后直接粘贴给 Agent，让它开始执行。'}
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
                  ? '已复制提示词'
                  : copyState === 'failed'
                    ? '重新复制提示词'
                    : '复制 AI 提示词'}
              </span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
