import { CloseIcon } from './Icons'

interface CoachStripProps {
  onDismiss: () => void
  onStartDemo: () => void
}

export default function CoachStrip({ onDismiss, onStartDemo }: CoachStripProps) {
  return (
    <aside className="wb-coach" aria-label="快速上手">
      <p className="wb-coach-path">
        <span><b>1</b> 在线路上点 + 插入元件</span>
        <span><b>2</b> 点元件改参数</span>
        <span><b>3</b> 运行后切换变量</span>
      </p>
      <p className="wb-coach-compact">
        点线路上的 + 加元件，点元件即可改参数
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
