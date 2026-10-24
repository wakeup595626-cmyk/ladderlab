import { useState } from 'react'
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
}

type InspectorTab = 'properties' | 'tags' | 'diagnostics'

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

      <p className="panel-note">蓝色数值可直接在仿真中操作。名称失焦后才会提交，避免输入过程误改引用。</p>

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
}: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('properties')
  const rung = selection ? program.rungs.find((item) => item.id === selection.rungId) : undefined
  const node = selection?.path ? getNodeAtPath(program, selection.rungId, selection.path) : null
  const activeProfile = getProfile(program.profile)

  const diagnostics = [...compileResult.errors, ...compileResult.warnings]

  return (
    <aside className="inspector">
      <div className="inspector-tabs" role="tablist">
        <button
          type="button"
          className={tab === 'properties' ? 'active' : ''}
          onClick={() => setTab('properties')}
        >
          属性
        </button>
        <button
          type="button"
          className={tab === 'tags' ? 'active' : ''}
          onClick={() => setTab('tags')}
        >
          变量表 <span>{program.tags.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'diagnostics' ? 'active' : ''}
          onClick={() => setTab('diagnostics')}
        >
          诊断 <span className={compileResult.errors.length ? 'badge-error' : ''}>{diagnostics.length}</span>
        </button>
      </div>

      <div className="inspector-body">
        {tab === 'properties' && (
          <PropertiesPanel
            program={program}
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
    const supports = (kind: OutputKind) => supportsOutput(program.profile, kind)
    const setOutput = (patch: Parameters<typeof updateOutput>[2]) => onProgram(updateOutput(program, selectedRung.id, patch))
    const isTimer = output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR'

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
