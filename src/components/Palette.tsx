import { getProfile, supportsContact, supportsOutput } from '../engine/profiles'
import { COURSE_LABS } from '../engine/courseLabs'
import { SAMPLES } from '../engine/samples'
import type { ContactKind, OutputKind, ProfileId } from '../engine/types'
import { ChevronRightIcon, PlusIcon } from './Icons'

interface PaletteProps {
  profile: ProfileId
  canInsert: boolean
  onInsertContact: (kind: ContactKind) => void
  onChangeOutput: (kind: OutputKind) => void
  onAddRung: () => void
  onLoadSample: (id: string) => void
}

const CONTACTS: Array<{ kind: ContactKind; symbol: string; label: string; hint: string }> = [
  { kind: 'NO', symbol: '－| |－', label: '常开触点', hint: '变量为 TRUE 时接通' },
  { kind: 'NC', symbol: '－|/|－', label: '常闭触点', hint: '变量为 FALSE 时接通' },
  { kind: 'P', symbol: '－|P|－', label: '上升沿', hint: '只在 FALSE→TRUE 时接通' },
  { kind: 'N', symbol: '－|N|－', label: '下降沿', hint: '只在 TRUE→FALSE 时接通' },
  { kind: 'CMP', symbol: '－[≥]－', label: '比较触点', hint: '比较 INT 或计数器 CV' },
]

const OUTPUTS: Array<{ kind: OutputKind; symbol: string; label: string; hint: string }> = [
  { kind: 'COIL', symbol: '( )', label: '线圈', hint: '每次扫描写入结果' },
  { kind: 'SET', symbol: '(S)', label: '置位', hint: '保持 ON 直到复位' },
  { kind: 'RESET', symbol: '(R)', label: '复位', hint: '保持 OFF 直到置位' },
  { kind: 'TON', symbol: 'TON', label: '接通延时', hint: '输入持续接通后延时' },
  { kind: 'TOF', symbol: 'TOF', label: '断开延时', hint: '输入断开后延时' },
  { kind: 'TONR', symbol: 'TONR', label: '累计定时', hint: '累计输入接通时间' },
  { kind: 'CTU', symbol: 'CTU', label: '加计数器', hint: '在上升沿累加计数' },
  { kind: 'MOVE', symbol: 'MOVE', label: '整数传送', hint: '把常量或 INT 写入目标' },
  { kind: 'ADD', symbol: 'ADD', label: '整数加法', hint: '源值加操作数，写回目标' },
  { kind: 'SUB', symbol: 'SUB', label: '整数减法', hint: '源值减操作数，写回目标' },
  { kind: 'SHL', symbol: 'SHL', label: '左移位', hint: '整数值向左移位' },
  { kind: 'ROL', symbol: 'ROL', label: '字节循环左移', hint: '8 位循环左移，用于流水工位' },
  { kind: 'PATTERN', symbol: 'SEQ', label: '教学灯字序列', hint: '教学扩展：按节拍输出 0～255' },
]

export default function Palette({
  profile,
  canInsert,
  onInsertContact,
  onChangeOutput,
  onAddRung,
  onLoadSample,
}: PaletteProps) {
  const activeProfile = getProfile(profile)
  return (
    <aside className="palette">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">插入与替换</span>
          <h2>指令</h2>
        </div>
        <span className="profile-chip">
          {activeProfile.shortName}
        </span>
      </div>

      <div className="palette-help">
        <p><b>触点</b> 会插到所选元件之后</p>
        <p><b>线圈 / 功能块</b> 会替换当前梯级输出</p>
      </div>

      <section className="palette-section sample-section">
        <div className="section-title-row">
          <h3>实验指导书 · 6 个实验</h3>
          <span>可编辑 · 可仿真</span>
        </div>
        <div className="sample-list course-lab-list">
          {COURSE_LABS.map((lab) => (
            <button
              type="button"
              className="sample-card course-lab-card"
              key={lab.id}
              onClick={() => onLoadSample(lab.id)}
              title={lab.description}
            >
              <span className="sample-name">{lab.name}</span>
              <span className="sample-badge">{lab.badge}</span>
              <span className="sample-description">{lab.description}</span>
              <ChevronRightIcon size={14} className="sample-arrow" />
            </button>
          ))}
        </div>
      </section>

      <section className="palette-section sample-section">
        <div className="section-title-row">
          <h3>快速示例</h3>
          <span>基础练习</span>
        </div>
        <div className="sample-list">
          {SAMPLES.map((sample) => (
            <button
              type="button"
              className="sample-card"
              key={sample.id}
              onClick={() => onLoadSample(sample.id)}
              title={sample.description}
            >
              <span className="sample-name">{sample.name}</span>
              <span className="sample-badge">{sample.badge}</span>
              <span className="sample-description">{sample.description}</span>
              <ChevronRightIcon size={14} className="sample-arrow" />
            </button>
          ))}
        </div>
      </section>

      <section className="palette-section">
        <h3>位逻辑触点</h3>
        <div className="instruction-grid">
          {CONTACTS.map((item) => {
            const enabled = supportsContact(profile, item.kind) && canInsert
            return (
              <button
                type="button"
                key={item.kind}
                className="instruction"
                disabled={!enabled}
                onClick={() => onInsertContact(item.kind)}
                title={enabled ? item.hint : supportsContact(profile, item.kind) ? '请先选择一个梯级' : `${item.label}在${activeProfile.shortName}档案中不可用`}
              >
                <span className="instruction-symbol">{item.symbol}</span>
                <span className="instruction-label">{item.label}</span>
                <span className="instruction-hint">{item.hint}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="palette-section">
        <h3>线圈与功能块</h3>
        <div className="instruction-grid">
          {OUTPUTS.map((item) => {
            const enabled = supportsOutput(profile, item.kind) && canInsert
            return (
              <button
                type="button"
                key={item.kind}
                className="instruction"
                disabled={!enabled}
                onClick={() => onChangeOutput(item.kind)}
                title={enabled ? `将当前输出替换为${item.label}` : supportsOutput(profile, item.kind) ? '请先选择一个梯级' : `${item.label}在${activeProfile.shortName}档案中不可用`}
              >
                <span className="instruction-symbol mono">{item.symbol}</span>
                <span className="instruction-label">{item.label}</span>
                <span className="instruction-hint">{item.hint}</span>
              </button>
            )
          })}
        </div>
      </section>

      <button type="button" className="add-rung-button" onClick={onAddRung}>
        <PlusIcon size={15} />
        新增梯级
      </button>
    </aside>
  )
}
