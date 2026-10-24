import { PROFILES } from '../engine/profiles'
import type { ProfileId } from '../engine/types'

interface ToolbarProps {
  projectName: string
  profile: ProfileId
  running: boolean
  speed: number
  errorCount: number
  canUndo: boolean
  canRedo: boolean
  onProjectName: (name: string) => void
  onProfile: (profile: ProfileId) => void
  onRunToggle: () => void
  onStep: () => void
  onReset: () => void
  onSpeed: (speed: number) => void
  onUndo: () => void
  onRedo: () => void
  onNew: () => void
  onImport: () => void
  onExport: () => void
}

function Logo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M5 7v18M5 16h7m8 0h7M12 11v10m8-10v10M20 16h7M27 7v18" />
        <circle cx="12" cy="16" r="1.8" />
        <circle cx="20" cy="16" r="1.8" />
      </svg>
    </span>
  )
}

export default function Toolbar({
  projectName,
  profile,
  running,
  speed,
  errorCount,
  canUndo,
  canRedo,
  onProjectName,
  onProfile,
  onRunToggle,
  onStep,
  onReset,
  onSpeed,
  onUndo,
  onRedo,
  onNew,
  onImport,
  onExport,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <Logo />
        <div>
          <strong>梯形实验室</strong>
          <span>LadderLab</span>
        </div>
      </div>

      <div className="profile-picker" role="group" aria-label="指令集档案">
        {PROFILES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === profile ? 'active' : ''}
            onClick={() => onProfile(item.id)}
            title={item.description}
          >
            {item.shortName}
          </button>
        ))}
      </div>

      <div className="project-identity">
        <span className="eyebrow">PLC 工程</span>
        <input
          className="project-name"
          value={projectName}
          onChange={(event) => onProjectName(event.target.value)}
          aria-label="工程名称"
          spellCheck={false}
        />
      </div>

      <div className="toolbar-actions">
        <div className="button-group file-actions">
          <button type="button" className="icon-button" onClick={onNew} title="新建工程">
            <span aria-hidden="true">＋</span>
            <span>新建</span>
          </button>
          <button type="button" className="icon-button" onClick={onImport} title="导入 JSON 工程">
            <span aria-hidden="true">⇧</span>
            <span>导入</span>
          </button>
          <button type="button" className="icon-button" onClick={onExport} title="导出 JSON 工程">
            <span aria-hidden="true">⇩</span>
            <span>导出</span>
          </button>
        </div>

        <div className="button-group history-actions">
          <button
            type="button"
            className="icon-button compact"
            onClick={onUndo}
            disabled={!canUndo}
            title="撤销 (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="icon-button compact"
            onClick={onRedo}
            disabled={!canRedo}
            title="重做 (Ctrl+Shift+Z)"
          >
            ↷
          </button>
        </div>
    </div>

      <div className="run-controls">
        <button
          type="button"
          className={running ? 'run-button running' : 'run-button'}
          onClick={onRunToggle}
          disabled={errorCount > 0}
          title={errorCount > 0 ? '请先修复诊断错误' : running ? '暂停扫描' : '开始扫描'}
        >
          <span aria-hidden="true">{running ? '❚❚' : '▶'}</span>
          {running ? '暂停' : '运行'}
        </button>
        <button
          type="button"
          className="icon-button compact"
          onClick={onStep}
          disabled={running || errorCount > 0}
          title="执行一个扫描周期"
        >
          {running ? '…' : '▮▶'}
        </button>
        <button
          type="button"
          className="icon-button compact"
          onClick={onReset}
          title="停止并复位仿真"
        >
          ↺
        </button>
        <select
          className="speed-select"
          value={speed}
          onChange={(event) => onSpeed(Number(event.target.value))}
          aria-label="仿真周期"
          title="每个扫描周期的仿真时间"
        >
          <option value={200}>慢速 200 ms</option>
          <option value={50}>标准 50 ms</option>
          <option value={10}>快速 10 ms</option>
        </select>
      </div>
    </header>
  )
}
