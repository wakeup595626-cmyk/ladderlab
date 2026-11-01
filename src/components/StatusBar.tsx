import type { CompileResult } from '../engine/types'

interface StatusBarProps {
  running: boolean
  simTime: number
  compileResult: CompileResult
  lastDraftSavedAt: number | null
  savePending: boolean
  saveError: string | null
  saveBlocked: boolean
}

const savedTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export default function StatusBar({
  running,
  simTime,
  compileResult,
  lastDraftSavedAt,
  savePending,
  saveError,
  saveBlocked,
}: StatusBarProps) {
  const savedTime = lastDraftSavedAt ? savedTimeFormatter.format(lastDraftSavedAt) : null
  const saveState = saveBlocked
    ? {
        className: 'save-state is-blocked',
        text: '草稿自动保存已暂停',
        title: '请先处理页面顶部的恢复或多标签冲突提示；处理前不会覆盖原数据',
      }
    : saveError
      ? { className: 'save-state is-error', text: '草稿保存失败', title: saveError }
      : savePending
        ? { className: 'save-state is-pending', text: '正在保存草稿…', title: '编辑内容正在写入本机浏览器草稿' }
      : savedTime
        ? {
            className: 'save-state is-saved',
            text: `草稿已自动保存 ${savedTime}`,
            title: `最近一次草稿保存：${savedTime}；命名项目请点顶栏「保存」`,
          }
        : { className: 'save-state', text: '等待草稿保存', title: '编辑后会短暂延迟写入本机浏览器；命名项目需点顶栏「保存」' }

  return (
    <footer className="status-bar wb-statusbar">
      <span className={running ? 'run-state online' : 'run-state'} role="status" aria-live="polite">
        <i />
        {running ? '仿真运行中' : '仿真暂停'}
      </span>
      {running && (
        <span className="run-clock" aria-hidden="true">
          已扫描 {(simTime / 1000).toFixed(1)} s
        </span>
      )}
      {compileResult.errors.length > 0 && (
        <span className="status-error">{compileResult.errors.length} 个错误</span>
      )}
      {/* PRODUCT.md 的品牌承诺：这句话必须在主界面持续可见，
          不能只藏在「关于」弹窗里。桌面与手机都保留完整三部分。 */}
      <span className="status-disclaimer">
        教学仿真器 · 非西门子官方产品 · 不兼容 S7 工程文件
      </span>
      <span className="status-spacer" />
      <span className={saveState.className} title={saveState.title}>
        {saveState.text}
      </span>
    </footer>
  )
}
