import { getProfile } from '../engine/profiles'
import type { CompileResult, ProfileId, Runtime } from '../engine/types'

interface StatusBarProps {
  profile: ProfileId
  running: boolean
  runtime: Runtime
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

function formatTime(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${(seconds % 60).toFixed(0)}s`
}

export default function StatusBar({
  profile,
  running,
  runtime,
  compileResult,
  lastSavedAt,
  savePending,
  saveError,
  saveBlocked,
}: StatusBarProps) {
  const activeProfile = getProfile(profile)
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
    <footer className="status-bar">
      <span className={running ? 'run-state online' : 'run-state'}>
        <i />
        {running ? '正在扫描' : '仿真暂停'}
      </span>
      <span className="status-scan">扫描 #{runtime.scanCount}</span>
      <span>模拟时间 {formatTime(runtime.simTime)}</span>
      <span>档案 {activeProfile.name}</span>
      <span className={compileResult.errors.length ? 'status-error' : ''}>
        {compileResult.errors.length} 错误 · {compileResult.warnings.length} 警告
      </span>
      <span className={saveState.className} title={saveState.title}>
        {saveState.text}
      </span>
      <span className="status-spacer" />
      <span className="status-disclaimer">教学仿真器 · 非西门子官方产品 · 不兼容 S7 工程文件</span>
    </footer>
  )
}
