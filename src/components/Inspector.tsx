import { getProfile, supportsContact, supportsOutput } from '../engine/profiles'
import type {
  CompileResult,
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  Runtime,
  Selection,
} from '../engine/types'
import {
  addTag,
  changeContactKind,
  changeOutputKind,
  collapseParallel,
  deleteNode,
  deleteTag,
  getNodeAtPath,
  tagUsage,
  updateContact,
  updateOutput,
  updateTag,
  wrapInParallel,
} from '../state/programOps'

interface InspectorProps {
  program: Program
  runtime: Runtime
  selection: Selection | null
  compileResult: CompileResult
  onProgram: (program: Program) => void
  onSelect: (selection: Selection | null) => void
  onToggleBool: (name: string) => void
  onSetInt: (name: string, value: number) => void
  onNotify: (message: string) => void
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
}

export type InspectorTab = 'properties' | 'tags' | 'diagnostics'

const CONTACT_NAMES: Record<ContactKind, string> = {
  NO: '常开触点',
  NC: '常闭触点',
  P: '上升沿触点',
  N: '下降沿触点',
  CMP: '比较触点',
}

const OUTPUT_NAMES: Record<OutputKind, string> = {
  COIL: '线圈',
  SET: '置位线圈',
  RESET: '复位线圈',
  TON: '接通延时 TON',
  TOF: '断开延时 TOF',
  TONR: '累计定时 TONR',
  CTU: '加计数器 CTU',
  MOVE: '整数传送 MOVE',
  ADD: '整数加法 ADD',
  SUB: '整数减法 SUB',
  SHL: '左移位 SHL',
  ROL: '字节循环左移 ROL',
  PATTERN: '教学灯字序列 PATTERN',
}

function isTimerKind(kind: OutputKind): boolean {
  return kind === 'TON' || kind === 'TOF' || kind === 'TONR'
}

function findPath(chain: LadderNode[], nodeId: string): number[] | null {
  for (let index = 0; index < chain.length; index += 1) {
    const node = chain[index]
    if (node.id === nodeId) return [index]
    if (node.type === 'parallel') {
      for (let branch = 0; branch < node.branches.length; branch += 1) {
        const nested = findPath(node.branches[branch], nodeId)
        if (nested) return [index, branch, ...nested]
      }
    }
  }
  return null
}

function selectionPath(program: Program, nodeId: string): number[] | null {
  for (const rung of program.rungs) {
    const path = findPath(rung.nodes, nodeId)
    if (path) return path
  }
  return null
}

function ContactProperties({
  program,
  selectedRung,
  node,
  profile,
  onProgram,
  onSelect,
  onNotify,
}: {
  program: Program
  selectedRung: Program['rungs'][number]
  node: Extract<LadderNode, { type: 'contact' }>
  profile: string
  onProgram: (program: Program) => void
  onSelect: (selection: Selection | null) => void
  onNotify: (message: string) => void
}) {
  const path = findPath(selectedRung.nodes, node.id)
  const boolTags = program.tags.filter((tag) => tag.kind === 'BOOL')
  const intTags = program.tags.filter((tag) => tag.kind === 'INT')
  const instances = program.rungs
    .map((rung) => rung.output)
    .filter((output) => output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR' || output.kind === 'CTU')
  const boolRefs = [
    ...boolTags.map((tag) => tag.name),
    ...instances.map((output) => `${output.tag}.Q`),
  ]
  const compareRefs = [
    ...intTags.map((tag) => tag.name),
    ...instances.filter((output) => output.kind === 'CTU').map((output) => `${output.tag}.CV`),
  ]
  const setKind = (kind: ContactKind) => {
    if (kind === 'CMP' || node.kind === 'CMP') {
      onProgram(changeContactKind(program, selectedRung.id, path!, kind))
    } else {
      onProgram(updateContact(program, selectedRung.id, node.id, { kind }))
    }
  }

  return (
    <div className="property-form">
      <div className="property-heading">
        <span className="property-type">位逻辑触点</span>
        <h3>{CONTACT_NAMES[node.kind]}</h3>
        <p>{selectedRung.label || '未命名梯级'}</p>
      </div>

      <label className="field">
        <span>触点类型</span>
        <select value={node.kind} onChange={(event) => setKind(event.target.value as ContactKind)}>
          {(Object.keys(CONTACT_NAMES) as ContactKind[]).map((kind) => (
            <option key={kind} value={kind} disabled={!supportsContact(program.profile, kind)}>
              {CONTACT_NAMES[kind]}{supportsContact(program.profile, kind) ? '' : `（${profile} 不支持）`}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{node.kind === 'CMP' ? '比较对象' : '变量 / 实例位'}</span>
        <select
          value={node.tag}
          onChange={(event) => onProgram(updateContact(program, selectedRung.id, node.id, { tag: event.target.value }))}
        >
          <option value="">— 请选择 —</option>
          {(node.kind === 'CMP' ? compareRefs : boolRefs).map((ref) => (
            <option value={ref} key={ref}>{ref}</option>
          ))}
          {node.tag && !(node.kind === 'CMP' ? compareRefs : boolRefs).includes(node.tag) && (
            <option value={node.tag}>{node.tag}（未解析引用）</option>
          )}
        </select>
      </label>

      {node.kind === 'CMP' && (
        <div className="field-row">
          <label className="field">
            <span>比较</span>
            <select
              value={node.compare?.op ?? '>='}
              onChange={(event) =>
                onProgram(updateContact(program, selectedRung.id, node.id, { compareOp: event.target.value }))
              }
            >
              {['==', '<>', '>', '>=', '<', '<='].map((op) => <option key={op}>{op}</option>)}
            </select>
          </label>
          <label className="field">
            <span>目标值</span>
            <input
              type="number"
              value={node.compare?.value ?? 1}
              onChange={(event) =>
                onProgram(updateContact(program, selectedRung.id, node.id, { compareValue: Number(event.target.value) }))
              }
            />
          </label>
        </div>
      )}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            onProgram(wrapInParallel(program, selectedRung.id, path!))
            onNotify('已创建并联分支')
          }}
        >
          改为并联
        </button>
        <button
          type="button"
          className="secondary-button danger"
          onClick={() => {
            if (path) onProgram(deleteNode(program, selectedRung.id, path))
            onSelect({ rungId: selectedRung.id, path: null })
            onNotify('触点已删除')
          }}
        >
          删除触点
        </button>
      </div>
    </div>
  )
}

function TagsPanel({
  program,
  runtime,
  onProgram,
  onToggleBool,
  onSetInt,
}: {
  program: Program
  runtime: Runtime
  onProgram: (program: Program) => void
  onToggleBool: (name: string) => void
  onSetInt: (name: string, value: number) => void
}) {
  const instances = program.rungs
    .map((rung) => rung.output)
    .filter((output) => runtime.timers[output.tag] || runtime.counters[output.tag])

  return (
    <div className="tags-panel">
      <div className="tags-toolbar">
        <div>
          <span className="eyebrow">符号与地址</span>
          <h3>PLC 变量表</h3>
        </div>
        <div className="button-row compact-row">
          <button type="button" className="secondary-button" onClick={() => onProgram(addTag(program, 'BOOL'))}>
            + BOOL
          </button>
          <button type="button" className="secondary-button" onClick={() => onProgram(addTag(program, 'INT'))}>
            + INT
          </button>
        </div>
      </div>

      <p className="panel-note">名称和地址在离开输入框后生效。点运行值可以在 FALSE / TRUE 之间切换，模拟按钮或开关。</p>

      <div className="tag-list" aria-label="PLC 变量表">
        {program.tags.map((tag) => {
          const usage = tagUsage(program, tag.name)
          return (
            <article className="tag-card" key={tag.id}>
              <div className="tag-card-head">
                <input
                  key={`${tag.id}-name-${tag.name}`}
                  className="table-input mono tag-name-input"
                  defaultValue={tag.name}
                  aria-label="变量名称"
                  onBlur={(event) => {
                    const name = event.target.value.trim()
                    if (name && name !== tag.name) onProgram(updateTag(program, tag.id, { name }))
                  }}
                  spellCheck={false}
                />
                <span className="type-pill">{tag.kind}</span>
                <button
                  type="button"
                  className="delete-mini"
                  disabled={usage > 0}
                  onClick={() => onProgram(deleteTag(program, tag.id))}
                  title={usage > 0 ? `被引用 ${usage} 次，不能删除` : '删除变量'}
                >
                  ×
                </button>
              </div>
              <input
                key={`${tag.id}-comment-${tag.comment}`}
                className="table-input comment-input"
                defaultValue={tag.comment}
                placeholder="添加注释"
                aria-label="变量注释"
                onBlur={(event) => onProgram(updateTag(program, tag.id, { comment: event.target.value }))}
              />
              <div className="tag-card-fields">
                <label>
                  <span>地址</span>
                  <input
                    key={`${tag.id}-address-${tag.address}`}
                    className="table-input mono address-input"
                    defaultValue={tag.address}
                    onBlur={(event) => onProgram(updateTag(program, tag.id, { address: event.target.value.toUpperCase() }))}
                    spellCheck={false}
                  />
                </label>
                <label>
                  <span>初值</span>
                  {tag.kind === 'BOOL' ? (
                    <select
                      className="table-input"
                      defaultValue={tag.initial ? 'true' : 'false'}
                      onChange={(event) => onProgram(updateTag(program, tag.id, { initial: event.target.value === 'true' }))}
                    >
                      <option value="false">FALSE</option>
                      <option value="true">TRUE</option>
                    </select>
                  ) : (
                    <input
                      key={`${tag.id}-initial-${tag.initial}`}
                      className="table-input mono"
                      type="number"
                      defaultValue={Number(tag.initial)}
                      onBlur={(event) => onProgram(updateTag(program, tag.id, { initial: Number(event.target.value) }))}
                    />
                  )}
                </label>
                <label>
                  <span>运行值</span>
                  {tag.kind === 'BOOL' ? (
                    <button
                      type="button"
                      className={runtime.bools[tag.name] ? 'live-value on' : 'live-value'}
                      onClick={() => onToggleBool(tag.name)}
                      title="点击切换仿真值"
                    >
                      {readDisplay(program, runtime, tag.name)}
                    </button>
                  ) : (
                    <input
                      key={`${tag.id}-runtime-${runtime.ints[tag.name] ?? 0}`}
                      className="table-input mono runtime-input"
                      type="number"
                      defaultValue={runtime.ints[tag.name] ?? 0}
                      onBlur={(event) => onSetInt(tag.name, Number(event.target.value) || 0)}
                    />
                  )}
                </label>
              </div>
            </article>
          )
        })}
      </div>

      <div className="tags-help">
        <strong>运行值不会写回真实 PLC</strong>
        <span>它只改变当前浏览器里的仿真输入。复位后，变量会回到“初值”。</span>
      </div>

      {instances.length > 0 && (
        <section className="instance-section">
          <h3>指令实例</h3>
          <div className="instance-list">
            {instances.map((output) => {
              const timer = runtime.timers[output.tag]
              const counter = runtime.counters[output.tag]
              return (
                <div className="instance-card" key={output.id}>
                  <strong className="mono">{output.tag}</strong>
                  <span>{output.kind}</span>
                  <b className={timer?.q || counter?.q ? 'on' : ''}>
                    {timer?.q || counter?.q ? 'TRUE' : 'FALSE'}
                  </b>
                  <small className="mono">
                    {timer ? `ET ${timer.et} / ${output.pt ?? 0} ms` : `CV ${counter?.cv ?? 0} / ${output.pv ?? 0}`}
                  </small>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function DiagnosticsPanel({
  program,
  compileResult,
  onSelect,
}: {
  program: Program
  compileResult: CompileResult
  onSelect: (selection: Selection | null) => void
}) {
  const items = [...compileResult.errors, ...compileResult.warnings]

  return (
    <div className="diagnostics-panel">
      <div className="panel-heading compact-heading">
        <div>
          <span className="eyebrow">编译检查</span>
          <h3>诊断信息</h3>
        </div>
        <span className={compileResult.errors.length ? 'compile-state error' : 'compile-state'}>
          {compileResult.errors.length ? '有错误' : '可运行'}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="empty-diagnostics">
          <span>✓</span>
          <strong>没有发现问题</strong>
          <p>可以运行仿真。修改工程后会自动重新检查。</p>
        </div>
      ) : (
        <div className="diagnostic-list">
          {items.map((item) => {
            const rung = program.rungs.find((value) => value.id === item.rungId)
            const path = rung && item.nodeId ? findPath(rung.nodes, item.nodeId) : null
            return (
              <button
                type="button"
                className={`diagnostic ${item.severity}`}
                key={item.id}
                onClick={() => {
                  if (!item.rungId) return
                  onSelect({ rungId: item.rungId, path })
                }}
                disabled={!item.rungId}
              >
                <span className="diagnostic-severity">{item.severity === 'error' ? '错误' : '警告'}</span>
                <span>{item.message}</span>
                {item.rungId && <small>定位 →</small>}
              </button>
            )
          })}
        </div>
      )}

      <div className="diagnostic-help">
        <h4>V14 / V21 档案</h4>
        <p>版本档案控制可用指令。工程文件是本项目的 JSON 格式，不会伪装成博途工程。</p>
      </div>
    </div>
  )
}

function readDisplay(program: Program, runtime: Runtime, name: string): string {
  const tag = program.tags.find((item) => item.name === name)
  if (tag?.kind === 'INT') return String(runtime.ints[name] ?? 0)
  return runtime.bools[name] ? 'TRUE' : 'FALSE'
}

export default function Inspector({
  program,
  runtime,
  selection,
  compileResult,
  onProgram,
  onSelect,
  onToggleBool,
  onSetInt,
  onNotify,
  tab,
  onTabChange,
}: InspectorProps) {
  const rung = selection ? program.rungs.find((item) => item.id === selection.rungId) : undefined
  const node = selection?.path ? getNodeAtPath(program, selection.rungId, selection.path) : null
  const activeProfile = getProfile(program.profile)

  const diagnostics = [...compileResult.errors, ...compileResult.warnings]
  const editingLabel = node
    ? node.type === 'contact'
      ? `${CONTACT_NAMES[node.kind]} · ${node.tag || '未绑定'}`
      : `并联分支 · ${node.branches.length} 条支路`
    : rung
      ? `梯级输出 · ${OUTPUT_NAMES[rung.output.kind]} · ${rung.output.tag || '未绑定'}`
      : '尚未选择元件'

  const context =
    tab === 'tags'
      ? { label: 'PLC 变量表', value: `${program.tags.length} 个变量 · 运行值可手动切换` }
      : tab === 'diagnostics'
        ? {
            label: '编译诊断',
            value: `${compileResult.errors.length} 个错误 · ${compileResult.warnings.length} 个警告`,
          }
        : { label: '正在编辑', value: editingLabel }

  return (
    <aside className="inspector">
      <div className="inspector-context">
        <span className="context-label">{context.label}</span>
        <strong title={context.value}>{context.value}</strong>
      </div>
      <div className="inspector-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'properties'}
          className={tab === 'properties' ? 'active' : ''}
          onClick={() => onTabChange('properties')}
        >
          属性
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tags'}
          className={tab === 'tags' ? 'active' : ''}
          onClick={() => onTabChange('tags')}
        >
          变量表 <span>{program.tags.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'diagnostics'}
          className={tab === 'diagnostics' ? 'active' : ''}
          onClick={() => onTabChange('diagnostics')}
        >
          诊断 <span className={compileResult.errors.length ? 'badge-error' : ''}>{diagnostics.length}</span>
        </button>
      </div>

      <div className="inspector-body">
        {tab === 'properties' && (
          <PropertiesPanel
            program={program}
            runtime={runtime}
            selectedRung={rung}
            selectedNode={node}
            isOutput={Boolean(selection && selection.path === null)}
            profile={activeProfile.shortName}
            onProgram={onProgram}
            onSelect={onSelect}
            onNotify={onNotify}
          />
        )}
        {tab === 'tags' && (
          <TagsPanel
            program={program}
            runtime={runtime}
            onProgram={onProgram}
            onToggleBool={onToggleBool}
            onSetInt={onSetInt}
          />
        )}
        {tab === 'diagnostics' && (
          <DiagnosticsPanel
            program={program}
            compileResult={compileResult}
            onSelect={onSelect}
          />
        )}
      </div>
    </aside>
  )
}

interface PropertiesPanelProps {
  program: Program
  runtime: Runtime
  selectedRung: Program['rungs'][number] | undefined
  selectedNode: LadderNode | null
  isOutput: boolean
  profile: string
  onProgram: (program: Program) => void
  onSelect: (selection: Selection | null) => void
  onNotify: (message: string) => void
}

function PropertiesPanel({
  program,
  runtime,
  selectedRung,
  selectedNode,
  isOutput,
  profile,
  onProgram,
  onSelect,
  onNotify,
}: PropertiesPanelProps) {
  if (!selectedRung) {
    return (
      <div className="empty-inspector">
        <span className="empty-icon">⌁</span>
        <h3>选择一个元件</h3>
        <p>点击梯形图中的触点、并联块或输出，在这里修改参数。运行后可观察绿色能流。</p>
        <div className="tip-card">
          <strong>当前档案：{profile}</strong>
          <span>档案只模拟指令集差异，不导入真实 TIA 工程。</span>
        </div>
      </div>
    )
  }

  if (isOutput || !selectedNode) {
    const output = selectedRung.output
    const boolTags = program.tags.filter((tag) => tag.kind === 'BOOL')
    const intTags = program.tags.filter((tag) => tag.kind === 'INT')
    const supports = (kind: OutputKind) => supportsOutput(program.profile, kind)
    const setOutput = (patch: Parameters<typeof updateOutput>[2]) => onProgram(updateOutput(program, selectedRung.id, patch))
    const isTimer = isTimerKind(output.kind)
    const isInteger = ['MOVE', 'ADD', 'SUB', 'SHL', 'ROL', 'PATTERN'].includes(output.kind)
    const referenceField = (label: string, field: 'qTag' | 'valueTag' | 'pulseTag' | 'stepTag', kind: 'BOOL' | 'INT', allowInstances = false) => (
      <label className="field">
        <span>{label}</span>
        <select value={output[field] ?? ''} onChange={(event) => setOutput({ [field]: event.target.value })}>
          <option value="">不连接</option>
          {program.tags.filter((tag) => tag.kind === kind).map((tag) => (
            <option key={tag.id} value={tag.name}>{tag.name} · {tag.address}</option>
          ))}
          {kind === 'BOOL' && allowInstances && program.rungs.filter((rung) => isTimerKind(rung.output.kind) || rung.output.kind === 'CTU').map((rung) => (
            <option key={rung.output.id} value={`${rung.output.tag}.Q`}>{rung.output.tag}.Q</option>
          ))}
        </select>
      </label>
    )

    return (
      <div className="property-form">
        <div className="property-heading">
          <span className="property-type">输出 / 指令</span>
          <h3>{OUTPUT_NAMES[output.kind]}</h3>
          <p>{selectedRung.label || '未命名梯级'}</p>
        </div>

        <label className="field">
          <span>指令类型</span>
          <select
            value={output.kind}
            onChange={(event) => {
              const kind = event.target.value as OutputKind
              onProgram(changeOutputKind(program, selectedRung.id, kind))
              onNotify(`输出已切换为 ${OUTPUT_NAMES[kind]}`)
            }}
          >
            {(Object.keys(OUTPUT_NAMES) as OutputKind[]).map((kind) => (
              <option key={kind} value={kind} disabled={!supports(kind)}>
                {OUTPUT_NAMES[kind]}{supports(kind) ? '' : `（${profile} 不支持）`}
              </option>
            ))}
          </select>
        </label>

        {isTimer || output.kind === 'CTU' ? (
          <label className="field">
            <span>{output.kind === 'CTU' ? '计数器实例' : '定时器实例'}</span>
            <input
              className="mono"
              value={output.tag}
              onChange={(event) => setOutput({ tag: event.target.value })}
              spellCheck={false}
            />
            <small>在触点里使用 <b>{output.tag || '实例'}.Q</b> 读取状态。</small>
          </label>
        ) : isInteger ? (
          <label className="field">
            <span>目标 INT 变量</span>
            <select value={output.tag} onChange={(event) => setOutput({ tag: event.target.value })}>
              <option value="">— 选择 INT 变量 —</option>
              {intTags.map((tag) => (
                <option key={tag.id} value={tag.name}>{tag.name} · {tag.address}</option>
              ))}
            </select>
            <small className="mono">当前值：{runtime.ints[output.tag] ?? 0}</small>
          </label>
        ) : (
          <label className="field">
            <span>输出变量</span>
            <select value={output.tag} onChange={(event) => setOutput({ tag: event.target.value })}>
              <option value="">— 选择 BOOL 变量 —</option>
              {boolTags.map((tag) => (
                <option key={tag.id} value={tag.name}>{tag.name} · {tag.address}</option>
              ))}
            </select>
          </label>
        )}

        {isTimer && (
          <label className="field">
            <span>预设时间 PT（ms）</span>
            <input
              type="number"
              min={1}
              step={100}
              value={output.pt ?? 3000}
              onChange={(event) => setOutput({ pt: Math.max(1, Number(event.target.value)) })}
            />
          </label>
        )}

        {output.kind === 'TONR' && (
          <label className="field">
            <span>复位变量</span>
            <select value={output.resetTag ?? ''} onChange={(event) => setOutput({ resetTag: event.target.value })}>
              <option value="">不复位</option>
              {boolTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
            </select>
          </label>
        )}

        {output.kind === 'CTU' && (
          <>
            <label className="field">
              <span>预设值 PV</span>
              <input
                type="number"
                min={1}
                step={1}
                value={output.pv ?? 5}
                onChange={(event) => setOutput({ pv: Math.max(1, Math.round(Number(event.target.value))) })}
              />
            </label>
            <label className="field">
              <span>复位变量 RE</span>
              <select value={output.resetTag ?? ''} onChange={(event) => setOutput({ resetTag: event.target.value })}>
                <option value="">不复位</option>
                {boolTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
              </select>
            </label>
          </>
        )}

        {(isTimer || output.kind === 'CTU') && (
          <>
            {referenceField('Q 状态写入 BOOL（可选）', 'qTag', 'BOOL')}
            {referenceField('ET / CV 写入 INT（可选）', 'valueTag', 'INT')}
          </>
        )}

        {isInteger && output.kind !== 'PATTERN' && (
          <>
            {output.kind === 'MOVE' && (
              <label className="field">
                <span>源 INT 变量（可选）</span>
                <select value={output.sourceTag ?? ''} onChange={(event) => setOutput({ sourceTag: event.target.value })}>
                  <option value="">使用下方常量</option>
                  {intTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
                </select>
              </label>
            )}
            {output.kind !== 'MOVE' && referenceField('操作数 INT 变量（可选）', 'valueTag', 'INT')}
            <label className="field">
              <span>{output.kind === 'MOVE' ? '整数常量' : output.kind === 'SHL' || output.kind === 'ROL' ? '移位次数' : '操作数常量'}</span>
              <input type="number" step={1} min={output.kind === 'SHL' || output.kind === 'ROL' ? 0 : undefined} max={output.kind === 'SHL' || output.kind === 'ROL' ? 31 : undefined} value={output.value ?? 0} onChange={(event) => setOutput({ value: Number(event.target.value) })} />
              {output.kind !== 'MOVE' && <small>未连接操作数变量时使用此常量；目标变量同时是运算的源值。</small>}
            </label>
          </>
        )}

        {output.kind === 'PATTERN' && (
          <>
            {referenceField('节拍 BOOL / 实例 .Q（上升沿前进一步）', 'pulseTag', 'BOOL', true)}
            {referenceField('当前步号 INT（可选）', 'stepTag', 'INT')}
            <label className="field">
              <span>灯字序列（0～255，逗号分隔）</span>
              <textarea key={output.pattern?.join(',')} className="mono" rows={3} defaultValue={output.pattern?.join(', ') ?? ''} onBlur={(event) => setOutput({ pattern: event.target.value.split(/[,，\s]+/).filter(Boolean).map(Number) })} />
              <small>教学扩展指令，不是西门子标准 PATTERN 指令。停止时输出 0，保留下一拍位置。</small>
            </label>
          </>
        )}

        <p className="form-note">可前往“变量表”点击输入位，模拟按钮和开关。</p>
      </div>
    )
  }

  if (selectedNode.type === 'parallel') {
    return (
      <div className="property-form">
        <div className="property-heading">
          <span className="property-type">并联分支</span>
          <h3>{selectedNode.branches.length} 条支路</h3>
          <p>{selectedRung.label || '未命名梯级'}</p>
        </div>
        <p className="form-note">任一并联支路接通，能流就会继续向右传递。</p>
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onProgram(wrapInParallel(program, selectedRung.id, selectionPath(program, selectedNode.id)!))
              onNotify('已添加一条并联支路')
            }}
          >
            添加并联支路
          </button>
          <button
            type="button"
            className="secondary-button danger"
            onClick={() => {
              onProgram(collapseParallel(program, selectedRung.id, selectionPath(program, selectedNode.id)!))
              onNotify('已只保留第一条支路')
            }}
          >
            收起并联
          </button>
        </div>
      </div>
    )
  }

  return (
    <ContactProperties
      program={program}
      selectedRung={selectedRung}
      node={selectedNode}
      profile={profile}
      onProgram={onProgram}
      onSelect={onSelect}
      onNotify={onNotify}
    />
  )
}
