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
    body: '先在梯形图里点要插入位置的“+”，再点收藏的触点；它会从那里按顺序往后串，分支里的“+”也只加到当前支路。也可直接拖到插入点。',
  },
  {
    title: '单击元件改参数',
    body: '点触点、线圈或定时器，就地改类型、变量名、常开/常闭和 PT，像在博途里一样。',
  },
  {
    title: '运行并切换输入',
    body: '点「运行」，再打开「变量表」把输入位切成 TRUE；程序段标题栏会显示当前回路的通断。',
  },
] as const

const SHORTCUTS = [
  ['撤销上一步', 'Ctrl/⌘ + Z'],
  ['重做下一步', 'Ctrl + Y / Ctrl + Shift + Z'],
  ['保存当前工程', 'Ctrl/⌘ + S'],
  ['复制、剪切、粘贴', 'Ctrl/⌘ + C / X / V'],
  ['给选中元件加分支', 'Shift + F8'],
  ['删除选中元件或程序段', 'Delete / Backspace'],
  ['取消取点、关闭浮层', 'Esc'],
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

        <div className="guide-body">
          <header className="guide-header" role="none">
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

          <section className="guide-shortcuts" aria-labelledby="guide-shortcuts-title">
            <h3 id="guide-shortcuts-title">常用快捷键</h3>
            <dl>
              {SHORTCUTS.map(([label, keys]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd><kbd>{keys}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>

          <p className="guide-footnote">
            教学仿真器 · 非西门子官方产品 · 不兼容 S7 工程文件。所有编辑与仿真都在浏览器本地完成。
          </p>
        </div>

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

      </div>
    </div>
  )
}
