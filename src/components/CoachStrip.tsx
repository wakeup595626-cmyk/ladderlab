import { CloseIcon } from './Icons'

interface CoachStripProps {
  onDismiss: () => void
  onStartDemo: () => void
}

export default function CoachStrip({ onDismiss, onStartDemo }: CoachStripProps) {
  return (
    <aside className="wb-coach" aria-label="快速上手">
      <p className="wb-coach-path">
        <span><b>1</b> 拖入或点击指令</span>
        <span><b>2</b> 点元件改参数</span>
        <span><b>3</b> 运行后切换变量</span>
      </p>
      <p className="wb-coach-compact">
        拖入或点选指令 <i aria-hidden="true">→</i> 点元件改参数 <i aria-hidden="true">→</i> 运行后切换变量
      </p>
      <div className="wb-coach-actions">
        <button type="button" className="wb-coach-demo" onClick={onStartDemo}>载入启保停示例</button>
        <button type="button" className="wb-coach-dismiss" onClick={onDismiss} aria-label="关闭快速上手">
          <span>知道了</span>
          <CloseIcon size={15} />
        </button>
      </div>
    </aside>
  )
}
