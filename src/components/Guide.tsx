import { useEffect, useRef } from 'react'
import {
  ArrowRightIcon,
  BoltIcon,
  CloseIcon,
  LayersIcon,
  PointerIcon,
  ToggleIcon,
} from './Icons'

interface GuideProps {
  open: boolean
  onClose: () => void
  onStartDemo: () => void
}

const STEPS = [
  {
    Icon: LayersIcon,
    title: '从一个示例开始',
    body: '点左侧「启保停」，马上得到一张能运行的电机自锁电路，也可以继续改。',
  },
  {
    Icon: PointerIcon,
    title: '点一下就能改',
    body: '点梯形图里的触点或线圈，属性面板会显示它的变量、类型和参数。',
  },
  {
    Icon: ToggleIcon,
    title: '拨动一个输入',
    body: '切到「变量表」，点 StartBtn 的 FALSE，把它变成 TRUE，就当按下了按钮。',
  },
  {
    Icon: BoltIcon,
    title: '按运行看能流',
    body: '点右上角蓝色「运行」。通电的导线会变绿，你能直接看到电走到了哪里。',
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
          <span className="guide-eyebrow">
            <span className="guide-badge-dot" />
            LadderLab 快速上手
          </span>
          <h2 id="guide-title">先让一台电机转起来。</h2>
          <p id="guide-intro">
            不用先学完整套博途。跟着下面四步做一遍，你就知道这个网页仿真器怎么用了。
          </p>
        </header>

        <ol className="guide-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="guide-step">
              <span className="guide-step-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="guide-step-icon">
                <step.Icon size={20} />
              </span>
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
          这是面向教学的离线梯形图仿真器，不连接真实 PLC，也不导入西门子 S7 / TIA 工程文件。
        </p>
      </div>
    </div>
  )
}
