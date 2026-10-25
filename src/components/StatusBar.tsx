import type { CompileResult } from '../engine/types'

interface StatusBarProps {
  running: boolean
  compileResult: CompileResult
  lastSavedAt: number | null
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
  compileResult,
  lastSavedAt,
  savePending,
  saveError,
  saveBlocked,
}: StatusBarProps) {
  const savedTime = lastSavedAt ? savedTimeFormatter.format(lastSavedAt) : null
  const saveState = saveBlocked
    ? {
        className: 'save-state is-blocked',
        text: '自动保存已暂停',
        title: '请先处理页面顶部的恢复或多标签冲突提示；处理前不会覆盖原数据',
      }
    : saveError
      ? { className: 'save-state is-error', text: '自动保存失败', title: saveError }
      : savePending
        ? { className: 'save-state is-pending', text: '正在保存…', title: '编辑内容正在写入本机浏览器' }
      : savedTime
        ? {
            className: 'save-state is-saved',
            text: `已保存 ${savedTime}`,
            title: `最近一次保存：${savedTime}`,
          }
        : { className: 'save-state', text: '等待自动保存', title: '编辑后会短暂延迟再写入本机浏览器' }

  return (
    <footer className="status-bar wb-statusbar">
      <span className={running ? 'run-state online' : 'run-state'}>
        <i />
        {running ? '正在扫描' : '仿真暂停'}
      </span>
      {compileResult.errors.length > 0 && (
        <span className="status-error">{compileResult.errors.length} 个错误</span>
      )}
      <span className="status-spacer" />
      <span className={saveState.className} title={saveState.title}>
        {saveState.text}
      </span>
    </footer>
  )
}
