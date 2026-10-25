import { useEffect, useRef } from 'react'
import { ArrowRightIcon, CloseIcon } from './Icons'

interface GuideProps {
  open: boolean
  onClose: () => void
  onStartDemo: () => void
}

const STEPS = [
  {
    title: '从左侧拖入指令',
    body: '把常开、常闭或线圈拖到梯形图的插入点。已经放在图中的元件也可以继续拖动换位。',
  },
  {
    title: '单击元件改参数',
    body: '点触点、线圈或定时器，直接修改类型、变量名、PT、PV 等参数，不需要另找一套菜单。',
  },
  {
    title: '在变量表里拨输入',
    body: '打开变量表，把输入位从 FALSE 切成 TRUE，就相当于按下了现场按钮。',
  },
  {
    title: '运行观察能流',
    body: '点顶栏「运行」。通电的导线变绿，定时器和计数器的当前值也会同步更新。',
  },
] as const

export default function Guide({ open, onClose, onStartDemo }: GuideProps) {
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 80)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(timer)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="guide-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="guide-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        aria-describedby="guide-intro"
      >
        <button type="button" className="guide-close" onClick={onClose} aria-label="关闭使用指南">
          <CloseIcon size={18} />
        </button>

        <header className="guide-header">
          <span className="guide-label">LadderLab 快速上手</span>
          <h2 id="guide-title">像在博途里一样编辑梯形图。</h2>
          <p id="guide-intro">
            沿用工程软件的操作习惯：拖入、换位、单击改参数。四步就能跑通一张梯形图。
          </p>
        </header>

        <ol className="guide-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="guide-step">
              <span className="guide-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="guide-actions">
          <button ref={primaryRef} type="button" className="guide-primary" onClick={onStartDemo}>
            载入启保停并运行
            <ArrowRightIcon size={18} />
          </button>
          <button type="button" className="guide-secondary" onClick={onClose}>
            我先自己看看
          </button>
          <span className="guide-note">随时可以从右上角「使用指南」重新打开</span>
        </div>

        <p className="guide-footnote">
          教学仿真器 · 非西门子官方产品 · 不兼容 S7 工程文件。所有编辑与仿真都在浏览器本地完成。
        </p>
      </div>
    </div>
  )
}
