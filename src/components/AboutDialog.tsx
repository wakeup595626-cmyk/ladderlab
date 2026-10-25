import { useRef } from 'react'
import { useModalFocus } from '../lib/useModalFocus'
import { CloseIcon } from './Icons'

interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalFocus<HTMLElement>(open, onClose, closeRef)

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
      <section
        ref={dialogRef}
        className="wb-about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        tabIndex={-1}
      >
        <header className="wb-about-head">
          <div>
            <h2 id="about-title">梯形实验室 LadderLab</h2>
            <p>浏览器内的梯形图教学仿真器。</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭关于">
            <CloseIcon size={19} />
          </button>
        </header>
        <dl className="wb-about-list">
          <div><dt>用途</dt><dd>搭梯形图、修改参数、观察扫描能流，用于课程练习与课堂演示。</dd></div>
          <div><dt>数据</dt><dd>工程只保存在当前浏览器；导出的 JSON 只属于 LadderLab。</dd></div>
          <div><dt>边界</dt><dd>不是西门子官方产品，也不导入、下载或兼容 S7 工程文件。</dd></div>
        </dl>
        <p className="wb-about-note">教学仿真器 · 非西门子官方产品 · 不兼容 S7 工程文件</p>
      </section>
    </div>
  )
}
