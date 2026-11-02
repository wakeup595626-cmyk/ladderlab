import { useMemo, useRef, useState } from 'react'
import { contentRungs } from '../engine/rungInvariant'
import type { Program, TagDef } from '../engine/types'
import { copyText } from '../lib/clipboard'
import {
  COURSE_DESIGNS,
  generateCourseDesign,
  makeAgentPrompt,
  matchCourseDesign,
  type CourseDesignTemplate,
} from '../lib/courseDesign'
import { useModalFocus } from '../lib/useModalFocus'
import { usePresence } from '../lib/usePresence'
import { BoltIcon, CheckCircleIcon, CloseIcon, CopyIcon } from './Icons'
import './CourseDesignDialog.css'

interface CourseDesignDialogProps {
  open: boolean
  onClose: () => void
  onGenerated: (program: Program, template: CourseDesignTemplate) => void | Promise<void>
}

const QUICK_EXAMPLES = ['三层电梯', '四路抢答器', '推土机', '八路流水灯', '电机正反转']

const CATEGORY_ORDER = ['课程实验', '机器课设', '基础示例'] as const

function TagTable({ title, tags }: { title: string; tags: TagDef[] }) {
  if (tags.length === 0) return null
  return (
    <section className="course-design-tag-group">
      <h4>{title}<span>{tags.length}</span></h4>
      <div className="course-design-table-wrap">
        <table className="course-design-table">
          <thead>
            <tr><th>地址</th><th>变量</th><th>类型</th><th>说明</th></tr>
          </thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id}>
                <td><code>{tag.address}</code></td>
                <td>{tag.name}</td>
                <td>{tag.kind}</td>
                <td>{tag.comment || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function CourseDesignDialog({ open, onClose, onGenerated }: CourseDesignDialogProps) {
  const { present, closing } = usePresence(open, 180)
  if (!present) return null
  return (
    <CourseDesignDialogContent
      open={open}
      closing={closing}
      onClose={onClose}
      onGenerated={onGenerated}
    />
  )
}

interface CourseDesignDialogContentProps extends Omit<CourseDesignDialogProps, 'open'> {
  open: boolean
  closing: boolean
}

function CourseDesignDialogContent({
  open,
  closing,
  onClose,
  onGenerated,
}: CourseDesignDialogContentProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useModalFocus<HTMLElement>(open, onClose, promptRef)

  const match = useMemo(() => matchCourseDesign(query), [query])
  const template = match.status === 'ok'
    ? match.template
    : match.status === 'ambiguous'
      ? match.candidates.find((item) => item.id === selectedId) ?? match.candidates[0]
      : null
  const generated = useMemo<{ program: Program | null; error: string }>(() => {
    if (!template) return { program: null, error: '' }
    try {
      return { program: generateCourseDesign(template), error: '' }
    } catch (reason) {
      return {
        program: null,
        error: reason instanceof Error ? reason.message : '内置模板没有通过仓库编译器',
      }
    }
  }, [template])
  const agentPrompt = useMemo(() => makeAgentPrompt(query), [query])
  const visibleRungs = generated.program ? contentRungs(generated.program) : []
  const inputTags = generated.program?.tags.filter((tag) => tag.address.startsWith('%I')) ?? []
  const outputTags = generated.program?.tags.filter((tag) => tag.address.startsWith('%Q')) ?? []
  const internalTags = generated.program?.tags.filter(
    (tag) => !tag.address.startsWith('%I') && !tag.address.startsWith('%Q'),
  ) ?? []
  const simulationSteps = template?.simulationSteps ?? [
    '先按 Reset 或停止输入，确认程序回到安全初始状态。',
    '按题目顺序逐项操作输入，并对照输出和内部变量检查每一步。',
    '最后执行停止、复位和边界条件，确认不会误动作或卡死。',
  ]

  const updateQuery = (next: string) => {
    setQuery(next)
    setSelectedId('')
    setError('')
    setCopyState('idle')
  }

  const copyPrompt = async () => {
    setCopyState(await copyText(agentPrompt) ? 'done' : 'failed')
  }

  const generate = async () => {
    if (!template || !generated.program || generating) return
    setGenerating(true)
    setError('')
    try {
      await onGenerated(generated.program, template)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '载入课设失败，请稍后再试')
    } finally {
      setGenerating(false)
    }
  }

  const copyPromptButton = (
    <div className="course-design-copy-row">
      <button type="button" className="course-design-copy" onClick={() => void copyPrompt()}>
        <CopyIcon size={16} />
        <span>
          {copyState === 'done'
            ? '任务单已复制'
            : copyState === 'failed'
              ? '复制失败，请手动选择'
              : '复制 Agent 任务单'}
        </span>
      </button>
    </div>
  )

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
              <h2 id="course-design-title">一键课设</h2>
              <p id="course-design-description">只生成通过仓库编译器的内置模板；不调用网络大模型。</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button course-design-close"
            onClick={onClose}
            aria-label="关闭一键课设"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <label className="course-design-field">
          <span>课设题目或动作要求</span>
          <textarea
            ref={promptRef}
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void generate()
              }
            }}
            placeholder="例如：三层电梯，有楼层呼叫、上下行指示和开门延时"
            rows={3}
            spellCheck={false}
          />
        </label>

        <div className="course-design-examples" aria-label="快捷题目">
          <span>试试：</span>
          {QUICK_EXAMPLES.map((example) => (
            <button type="button" key={example} onClick={() => updateQuery(example)}>
              {example}
            </button>
          ))}
        </div>

        <div className="course-design-result" aria-live="polite">
          {match.status === 'ok' && (
            <div className="course-design-match is-ok">
              <CheckCircleIcon size={18} />
              <span>已匹配内置模板</span>
              <strong>{match.template.title}</strong>
            </div>
          )}
          {match.status === 'ambiguous' && (
            <div className="course-design-match is-choice">
              <strong>{match.message}</strong>
              <div className="course-design-candidates" role="radiogroup" aria-label="选择内置模板">
                {match.candidates.map((candidate) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={template?.id === candidate.id}
                    className={template?.id === candidate.id ? 'is-selected' : ''}
                    key={candidate.id}
                    onClick={() => {
                      setSelectedId(candidate.id)
                      setError('')
                    }}
                  >
                    <span>{candidate.title}</span>
                    <small>{candidate.category}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {match.status === 'unsupported' && (
            <div className="course-design-unsupported">
              <strong>这个题目没有可直接生成的内置模板</strong>
              <p>{match.message}</p>
            </div>
          )}
          {match.status === 'incompatible' && (
            <div className="course-design-unsupported is-incompatible">
              <strong>题目规格与内置模板不一致</strong>
              <p>{match.message}</p>
              <p className="course-design-support-range">
                相近模板：{match.template.title}
                {match.template.parameter
                  ? ` · 支持 ${match.template.parameter.min}～${match.template.parameter.max} ${match.template.parameter.unit}`
                  : ''}
              </p>
            </div>
          )}
        </div>

        {template && (
          <div className="course-design-preview">
            <div className="course-design-preview-head">
              <div>
                <span>{template.category}</span>
                <h3>{template.title}</h3>
                {template.parameter && (
                  <span className="course-design-spec">
                    当前规格：{template.parameter.value} {template.parameter.unit}
                    {' · '}可生成 {template.parameter.min}～{template.parameter.max} {template.parameter.unit}
                  </span>
                )}
                <p>{template.description}</p>
              </div>
              <span className="course-design-compiled">
                <CheckCircleIcon size={15} />
                编译通过
              </span>
            </div>

            {generated.program ? (
              <>
                <dl className="course-design-metrics">
                  <div><dt>程序段</dt><dd>{visibleRungs.length}</dd></div>
                  <div><dt>变量</dt><dd>{generated.program.tags.length}</dd></div>
                  <div><dt>格式</dt><dd>{generated.program.profile.toUpperCase()}</dd></div>
                </dl>
                <div className="course-design-details">
                  <section className="course-design-rungs">
                    <h4>完整程序段<span>{visibleRungs.length}</span></h4>
                    <ol>
                      {visibleRungs.map((rung) => <li key={rung.id}>{rung.label}</li>)}
                    </ol>
                  </section>
                  <section className="course-design-simulation">
                    <h4>仿真操作步骤</h4>
                    <ol>{simulationSteps.map((step) => <li key={step}>{step}</li>)}</ol>
                  </section>
                </div>
                <div className="course-design-io">
                  <div className="course-design-io-head">
                    <h4>完整 I/O 与内部变量</h4>
                    <span>{generated.program.tags.length} 个变量</span>
                  </div>
                  <TagTable title="输入" tags={inputTags} />
                  <TagTable title="输出" tags={outputTags} />
                  <TagTable title="内部变量" tags={internalTags} />
                </div>
                <p className="course-design-export-hint">
                  载入后可从右上角「导出」保存 PNG / SVG / 分页 PDF；梯形图仍可继续编辑和仿真。
                </p>
              </>
            ) : (
              <p className="course-design-error" role="alert">{generated.error}</p>
            )}
          </div>
        )}

        {(match.status === 'unsupported' || match.status === 'incompatible' || template) && (
          <details
            className="course-design-agent"
            open={match.status === 'unsupported' || match.status === 'incompatible'}
          >
            <summary>
              {match.status === 'unsupported'
                ? '交给能执行命令的 Agent 定制'
                : match.status === 'incompatible'
                  ? '复制任务单，让 Agent 按真实规格定制'
                : '没有完全符合？复制 Agent 定制任务单'}
            </summary>
            <p>
              Agent 应先读仓库说明，自己生成、校验并推演逻辑；用户不需要手敲命令。
              无 Node 或文件系统时，只能交付标注「未经仓库校验器验证」的 JSON。
            </p>
            <textarea
              value={agentPrompt}
              readOnly
              aria-label="Agent 定制任务单"
              onFocus={(event) => event.currentTarget.select()}
            />
            {copyPromptButton}
          </details>
        )}

        <details className="course-design-library">
          <summary>查看全部 {COURSE_DESIGNS.length} 个可离线生成的模板</summary>
          <div className="course-design-library-groups">
            {CATEGORY_ORDER.map((category) => {
              const entries = COURSE_DESIGNS.filter((item) => item.category === category)
              if (entries.length === 0) return null
              return (
                <section key={category} aria-label={category}>
                  <h3>{category}</h3>
                  <div>
                    {entries.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          updateQuery(item.title)
                          setSelectedId(item.id)
                        }}
                        title={item.description}
                      >
                        {item.title}
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </details>

        {error && <p className="course-design-error" role="alert">{error}</p>}

        <footer className="course-design-actions">
          <button type="button" className="course-design-cancel" onClick={onClose}>取消</button>
          <button
            type="button"
            className="course-design-generate"
            disabled={!template || !generated.program || generating}
            aria-busy={generating}
            onClick={() => void generate()}
          >
            <BoltIcon size={16} />
            <span>{generating ? '正在载入…' : '生成并载入梯形图'}</span>
          </button>
        </footer>
      </section>
    </div>
  )
}
