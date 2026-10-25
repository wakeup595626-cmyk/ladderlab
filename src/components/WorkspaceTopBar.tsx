import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { PROFILES } from '../engine/profiles'
import type { ProfileId } from '../engine/types'
import {
  FolderIcon,
  HelpIcon,
  InfoIcon,
  LadderIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  RedoIcon,
  ResetIcon,
  StepIcon,
  UndoIcon,
} from './Icons'

export interface WorkspaceTopBarProps {
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
  onOpenProject: () => void
  onGuide: () => void
  onAbout: () => void
}

export default function WorkspaceTopBar({
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
  onOpenProject,
  onGuide,
  onAbout,
}: WorkspaceTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const menuItems = () => Array.from(
    menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') ?? [],
  )

  useEffect(() => {
    if (!menuOpen) return

    // 打开后把焦点放进第一项，这样键盘用户不必再用 Tab 摸进菜单。
    const focusTimer = window.setTimeout(() => menuItems()[0]?.focus(), 0)

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return
      setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 菜单只是页面里的一层浮层：Esc 先关它，不要连带关闭变量表。
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = menuItems()
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
    else if (event.key === 'End') next = items.length - 1
    items[next]?.focus()
  }

  const chooseMenuAction = (action: () => void) => {
    setMenuOpen(false)
    // 菜单项即将卸载，先把焦点交还触发器，弹层关闭后才能回到原处。
    menuButtonRef.current?.focus()
    action()
  }

  return (
    <header className="topbar wb-topbar">
      <div className="brand wb-brand" aria-label="梯形实验室 LadderLab">
        <span className="brand-mark" aria-hidden="true">
          <LadderIcon size={20} />
        </span>
        <span className="wb-brand-name">
          <strong>梯形实验室</strong>
        </span>
      </div>

      <label className="wb-project-name" htmlFor="project-name">
        <span className="visually-hidden">工程名称</span>
        <input
          id="project-name"
          value={projectName}
          onChange={(event) => onProjectName(event.target.value)}
          spellCheck={false}
        />
      </label>

      <div className="wb-topbar-actions">
        <button
          type="button"
          className="wb-project-button"
          onClick={onOpenProject}
          aria-label="打开项目"
          title="项目、变量表和实验库"
        >
          <FolderIcon size={17} />
          <span>项目</span>
        </button>

        <button
          type="button"
          className={`run-toggle wb-run-toggle${running ? ' is-running' : ''}`}
          onClick={onRunToggle}
          disabled={errorCount > 0}
          aria-pressed={running}
          aria-label={running ? '暂停仿真' : '运行仿真'}
          title={errorCount > 0 ? `存在 ${errorCount} 个错误，请先查看诊断` : running ? '暂停连续扫描' : '开始连续扫描'}
        >
          {running ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
          <span>{running ? '暂停' : '运行'}</span>
        </button>

        <div className="overflow wb-more" ref={menuRef}>
          <button
            type="button"
            className="icon-button"
            ref={menuButtonRef}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="更多操作"
            title="更多操作"
            aria-expanded={menuOpen}
            aria-controls="topbar-more-menu"
            aria-haspopup="menu"
          >
            <MoreIcon size={19} />
          </button>

          {menuOpen && (
            <div
              className="topbar-menu wb-more-menu"
              id="topbar-more-menu"
              role="menu"
              aria-label="更多操作"
              onKeyDown={handleMenuKeyDown}
            >
              <div className="wb-menu-group" role="group" aria-label="仿真">
                <span className="wb-menu-label">仿真</span>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onStep)} disabled={running || errorCount > 0}>
                  <StepIcon size={16} />
                  <span>单步执行</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onReset)}>
                  <ResetIcon size={16} />
                  <span>复位仿真</span>
                </button>
                <div className="wb-speed-row" role="group" aria-label="扫描速度">
                  <span>速度</span>
                  {[200, 50, 10].map((value) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={speed === value}
                      className={speed === value ? 'is-active' : ''}
                      key={value}
                      onClick={() => chooseMenuAction(() => onSpeed(value))}
                    >
                      {value === 200 ? '慢' : value === 50 ? '标准' : '快'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wb-menu-group" role="group" aria-label="编辑">
                <span className="wb-menu-label">编辑</span>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onUndo)} disabled={!canUndo}>
                  <UndoIcon size={16} />
                  <span>撤销</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onRedo)} disabled={!canRedo}>
                  <RedoIcon size={16} />
                  <span>重做</span>
                </button>
                <div className="wb-speed-row" role="group" aria-label="指令集版本">
                  <span>指令集</span>
                  {PROFILES.map((item) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={profile === item.id}
                      className={profile === item.id ? 'is-active' : ''}
                      key={item.id}
                      onClick={() => chooseMenuAction(() => onProfile(item.id))}
                      title={item.description}
                    >
                      {item.shortName}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wb-menu-group" role="group" aria-label="帮助">
                <span className="wb-menu-label">帮助</span>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onGuide)}>
                  <HelpIcon size={16} />
                  <span>三步上手</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onAbout)}>
                  <InfoIcon size={16} />
                  <span>关于与数据说明</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
