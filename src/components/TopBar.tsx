import { useEffect, useRef, useState } from 'react'
import { PROFILES } from '../engine/profiles'
import type { ProfileId } from '../engine/types'
import {
  BookIcon,
  ExportIcon,
  HelpIcon,
  ImportIcon,
  LadderIcon,
  MenuIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  ResetIcon,
  SlidersIcon,
  StepIcon,
  UndoIcon,
} from './Icons'

export interface TopBarProps {
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
  onOpenLibrary: () => void
  onToggleSidebar: () => void
  onToggleInspector: () => void
  inspectorOpen?: boolean
}

export default function TopBar({
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
  onOpenLibrary,
  onToggleSidebar,
  onToggleInspector,
  inspectorOpen = false,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return
      setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const chooseMenuAction = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="mobile-menu icon-button"
          onClick={onToggleSidebar}
          aria-label="打开项目与指令"
          title="打开项目与指令"
        >
          <MenuIcon size={19} />
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <LadderIcon size={20} />
          </span>
          <div className="brand-copy">
            <strong>梯形实验室</strong>
            <small>LadderLab</small>
          </div>
        </div>
      </div>

      <div className="topbar-project">
        <label className="visually-hidden" htmlFor="project-name">工程名称</label>
        <input
          id="project-name"
          value={projectName}
          onChange={(event) => onProjectName(event.target.value)}
          spellCheck={false}
        />
        <div className="profile-switch" role="group" aria-label="指令集版本">
          {PROFILES.map((item) => (
            <button
              type="button"
              className={item.id === profile ? 'is-active' : ''}
              key={item.id}
              onClick={() => onProfile(item.id)}
              aria-pressed={item.id === profile}
              aria-label={`切换到 ${item.name}`}
              title={`${item.name}：${item.description}`}
            >
              {item.shortName}
            </button>
          ))}
        </div>
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="撤销"
          title="撤销 (Ctrl+Z)"
        >
          <UndoIcon size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="重做"
          title="重做 (Ctrl+Shift+Z)"
        >
          <RedoIcon size={17} />
        </button>
        <button
          type="button"
          className="icon-button inspector-toggle"
          onClick={onToggleInspector}
          aria-label="切换属性面板"
          title="切换属性面板"
          aria-pressed={inspectorOpen}
        >
          <SlidersIcon size={17} />
        </button>
      </div>

      <div className="run-group">
        <button
          type="button"
          className={`run-toggle${running ? ' is-running' : ''}`}
          onClick={onRunToggle}
          disabled={errorCount > 0}
          aria-pressed={running}
          aria-label={running ? '暂停仿真' : '运行仿真'}
          title={errorCount > 0 ? `存在 ${errorCount} 个错误，请先修复` : running ? '暂停连续扫描' : '开始连续扫描'}
        >
          {running ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
          <span>{running ? '暂停' : '运行'}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onStep}
          disabled={running || errorCount > 0}
          aria-label="单步执行"
          title={running ? '请先暂停连续扫描' : errorCount > 0 ? `存在 ${errorCount} 个错误，请先修复` : '执行一个扫描周期'}
        >
          <StepIcon size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onReset}
          aria-label="复位仿真"
          title="停止并复位仿真"
        >
          <ResetIcon size={17} />
        </button>
        <label className="speed-control">
          <span className="visually-hidden">仿真速度</span>
          <select
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

      <div className="overflow" ref={menuRef}>
        <button
          type="button"
          className="icon-button"
          ref={menuButtonRef}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="更多工程操作"
          title="更多工程操作"
          aria-expanded={menuOpen}
          aria-controls="topbar-more-menu"
          aria-haspopup="menu"
        >
          <MoreIcon size={19} />
        </button>

        {menuOpen && (
          <div className="topbar-menu" id="topbar-more-menu" role="menu" aria-label="工程操作">
            <button type="button" role="menuitem" onClick={() => chooseMenuAction(onNew)} aria-label="新建工程" title="新建工程">
              <PlusIcon size={16} />
              <span>新建工程</span>
            </button>
            <button type="button" role="menuitem" onClick={() => chooseMenuAction(onImport)} aria-label="导入 JSON" title="导入 JSON">
              <ImportIcon size={16} />
              <span>导入 JSON</span>
            </button>
            <button type="button" role="menuitem" onClick={() => chooseMenuAction(onExport)} aria-label="导出 JSON" title="导出 JSON">
              <ExportIcon size={16} />
              <span>导出 JSON</span>
            </button>
            <button type="button" role="menuitem" onClick={() => chooseMenuAction(onOpenLibrary)} aria-label="实验库" title="实验库">
              <BookIcon size={16} />
              <span>实验库</span>
            </button>
            <button type="button" role="menuitem" onClick={() => chooseMenuAction(onGuide)} aria-label="使用指南" title="使用指南">
              <HelpIcon size={16} />
              <span>使用指南</span>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
