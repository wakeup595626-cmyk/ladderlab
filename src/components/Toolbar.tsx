import { getProfile, PROFILES } from '../engine/profiles'
import type { ProfileId } from '../engine/types'
import {
  BookIcon,
  ExportIcon,
  ImportIcon,
  LadderIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  ResetIcon,
  StepIcon,
  UndoIcon,
} from './Icons'

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
  onGuide: () => void
}

function Logo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <LadderIcon size={21} />
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
  onGuide,
}: ToolbarProps) {
  const activeProfile = getProfile(profile)

  return (
    <header className="toolbar">
      <div className="brand">
        <Logo />
        <div className="brand-copy">
          <strong>梯形实验室</strong>
          <span>LADDERLAB</span>
        </div>
      </div>

      <div className="profile-picker" role="group" aria-label="指令集版本档案">
        {PROFILES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === profile ? 'active' : ''}
            onClick={() => onProfile(item.id)}
            title={item.description}
            aria-pressed={item.id === profile}
          >
            {item.shortName}
          </button>
        ))}
      </div>

      <label className="project-identity">
        <span className="eyebrow">工程 · {activeProfile.shortName}</span>
        <input
          className="project-name"
          value={projectName}
          onChange={(event) => onProjectName(event.target.value)}
          aria-label="工程名称"
          spellCheck={false}
        />
      </label>

      <div className="toolbar-actions">
        <div className="button-group file-actions">
          <button type="button" className="icon-button" onClick={onNew} title="新建工程" aria-label="新建工程">
            <PlusIcon size={15} />
            <span>新建</span>
          </button>
          <button type="button" className="icon-button" onClick={onImport} title="导入 JSON 工程" aria-label="导入 JSON 工程">
            <ImportIcon size={15} />
            <span>导入</span>
          </button>
          <button type="button" className="icon-button" onClick={onExport} title="导出 JSON 工程" aria-label="导出 JSON 工程">
            <ExportIcon size={15} />
            <span>导出</span>
          </button>
        </div>

        <div className="button-group history-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onUndo}
            disabled={!canUndo}
            title="撤销 (Ctrl+Z)"
            aria-label="撤销"
          >
            <UndoIcon size={15} />
            <span>撤销</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onRedo}
            disabled={!canRedo}
            title="重做 (Ctrl+Shift+Z)"
            aria-label="重做"
          >
            <RedoIcon size={15} />
            <span>重做</span>
          </button>
        </div>

        <button type="button" className="guide-button" onClick={onGuide} title="使用指南" aria-label="使用指南">
          <BookIcon size={15} />
          <span>使用指南</span>
        </button>
      </div>

      <div className="run-controls">
        <button
          type="button"
          className={running ? 'run-button running' : 'run-button'}
          onClick={onRunToggle}
          disabled={errorCount > 0}
          aria-pressed={running}
          title={errorCount > 0 ? '请先修复诊断错误' : running ? '暂停扫描' : '开始连续扫描'}
        >
          {running ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
          <span>{running ? '暂停' : '运行'}</span>
        </button>
        <button
          type="button"
          className="icon-button compact"
          onClick={onStep}
          disabled={running || errorCount > 0}
          title="执行一个扫描周期"
          aria-label="单步执行"
        >
          <StepIcon size={15} />
        </button>
        <button
          type="button"
          className="icon-button compact"
          onClick={onReset}
          title="停止并复位仿真"
          aria-label="复位仿真"
        >
          <ResetIcon size={15} />
        </button>
        <label className="speed-control">
          <span className="visually-hidden">仿真速度</span>
          <select
            className="speed-select"
            value={speed}
            onChange={(event) => onSpeed(Number(event.target.value))}
            aria-label="仿真扫描周期"
          >
            <option value={200}>慢速</option>
            <option value={50}>标准</option>
            <option value={10}>快速</option>
          </select>
        </label>
      </div>
    </header>
  )
}
