import { getProfile } from '../engine/profiles'
import type { CompileResult, ProfileId, Runtime } from '../engine/types'

interface StatusBarProps {
  profile: ProfileId
  running: boolean
  runtime: Runtime
  compileResult: CompileResult
}

function formatTime(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${(seconds % 60).toFixed(0)}s`
}

export default function StatusBar({ profile, running, runtime, compileResult }: StatusBarProps) {
  const activeProfile = getProfile(profile)
  return (
    <footer className="status-bar">
      <span className={running ? 'run-state online' : 'run-state'}>
        <i />
        {running ? '正在扫描' : '仿真暂停'}
      </span>
      <span>扫描 #{runtime.scanCount}</span>
      <span>模拟时间 {formatTime(runtime.simTime)}</span>
      <span>档案 {activeProfile.name}</span>
      <span className={compileResult.errors.length ? 'status-error' : ''}>
        {compileResult.errors.length} 错误 · {compileResult.warnings.length} 警告
      </span>
      <span className="status-spacer" />
      <span className="status-disclaimer">教学仿真器 · 非西门子官方产品 · 不兼容 S7 工程文件</span>
    </footer>
  )
}
