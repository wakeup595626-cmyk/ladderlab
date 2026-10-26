import { useRef } from 'react'
import { useModalFocus } from '../lib/useModalFocus'
import { ArrowRightIcon, CloseIcon } from './Icons'

interface GuideProps {
  open: boolean
  onClose: () => void
  onStartDemo: () => void
}

const STEPS = [
  {
    title: '拖入或点击指令',
    body: '在顶部指令带点一下常开、常闭或线圈即可插入，也可以直接拖到程序段里。',
  },
  {
    title: '单击元件改参数',
    body: '点触点、线圈或定时器，就地改类型、变量名、常开/常闭和 PT，像在博途里一样。',
  },
  {
    title: '运行并切换输入',
    body: '点「运行」，再打开「变量表」把输入位切成 TRUE；绿色导线就是当前通电的能流。',
  },
] as const

export default function Guide({ open, onClose, onStartDemo }: GuideProps) {
  const primaryRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose, primaryRef)

  if (!open) return null

  return (
    <div
      className="guide-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="guide-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        aria-describedby="guide-intro"
        tabIndex={-1}
      >
        <button type="button" className="guide-close" onClick={onClose} aria-label="关闭使用指南">
          <CloseIcon size={18} />
        </button>

        <header className="guide-header">
          <span className="guide-label">LadderLab 快速上手</span>
          <h2 id="guide-title">三步跑通一张梯形图。</h2>
          <p id="guide-intro">
            拖入、改参数、运行。浏览器里就能完成，不用学另一套规则。
          </p>
        </header>

        <ol className="guide-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="guide-step">
              <span className="guide-step-number" aria-hidden="true">{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="guide-actions">
          <button ref={primaryRef} type="button" className="guide-primary" onClick={onStartDemo}>
            载入启保停示例
            <ArrowRightIcon size={18} />
          </button>
          <button type="button" className="guide-secondary" onClick={onClose}>
            我先自己看看
          </button>
          <span className="guide-note">随时可以从「更多」菜单重新打开</span>
        </div>

        <p className="guide-footnote">
          教学仿真器 · 非西门子官方产品 · 不兼容 S7 工程文件。所有编辑与仿真都在浏览器本地完成。
        </p>
      </div>
    </div>
  )
}
