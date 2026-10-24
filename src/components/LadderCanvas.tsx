import type { ReactNode } from 'react'
import type {
  ContactNode,
  LadderNode,
  OutputElement,
  Program,
  Runtime,
  Selection,
  TagDef,
} from '../engine/types'
import './LadderCanvas.css'

export interface LadderCanvasProps {
  program: Program
  runtime: Runtime
  selection: Selection | null
  onSelect: (selection: Selection) => void
  onDeleteNode: (rungId: string, path: number[]) => void
  onWrapParallel: (rungId: string, path: number[]) => void
  onCollapseParallel: (rungId: string, path: number[]) => void
  onDuplicateRung: (rungId: string) => void
  onDeleteRung: (rungId: string) => void
  onMoveRung: (rungId: string, delta: -1 | 1) => void
  onAddRung: () => void
}

interface Size {
  width: number
  height: number
}

interface DrawContext {
  runtime: Runtime
  tags: TagDef[]
  selection: Selection | null
  rungId: string
  onSelect: (selection: Selection) => void
}

const CONTACT_WIDTH = 148
const COMPARE_WIDTH = 184
const CONTACT_HEIGHT = 76
const CHAIN_GAP = 22
const PARALLEL_SIDE = 32
const PARALLEL_GAP = 18
const EMPTY_CHAIN_WIDTH = 72
const EMPTY_CHAIN_HEIGHT = 52
const COIL_WIDTH = 132
const COIL_HEIGHT = 86
const BOX_WIDTH = 236
const BOX_HEIGHT = 136

const CONTACT_LABELS: Record<ContactNode['kind'], string> = {
  NO: '常开',
  NC: '常闭',
  P: '上升沿',
  N: '下降沿',
  CMP: '比较',
}

const OUTPUT_LABELS: Record<OutputElement['kind'], string> = {
  COIL: '线圈',
  SET: '置位',
  RESET: '复位',
  TON: '接通延时',
  TOF: '断开延时',
  TONR: '累计延时',
  CTU: '加计数',
}

function contactSize(node: ContactNode): Size {
  return {
    width: node.kind === 'CMP' ? COMPARE_WIDTH : CONTACT_WIDTH,
    height: CONTACT_HEIGHT,
  }
}

function outputSize(output: OutputElement): Size {
  return output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET'
    ? { width: COIL_WIDTH, height: COIL_HEIGHT }
    : { width: BOX_WIDTH, height: BOX_HEIGHT }
}

function measureChain(chain: LadderNode[]): Size {
  if (chain.length === 0) return { width: EMPTY_CHAIN_WIDTH, height: EMPTY_CHAIN_HEIGHT }
  let width = 0
  let height = 0
  for (const node of chain) {
    const size = measureNode(node)
    width += size.width
    height = Math.max(height, size.height)
  }
  return {
    width: width + CHAIN_GAP * (chain.length - 1),
    height,
  }
}

function measureNode(node: LadderNode): Size {
  if (node.type === 'contact') return contactSize(node)
  if (node.branches.length === 0) return { width: EMPTY_CHAIN_WIDTH + PARALLEL_SIDE * 2, height: EMPTY_CHAIN_HEIGHT }
  const branches = node.branches.map(measureChain)
  return {
    width: Math.max(...branches.map((branch) => branch.width)) + PARALLEL_SIDE * 2,
    height: branches.reduce((sum, branch) => sum + branch.height, 0) + PARALLEL_GAP * (branches.length - 1),
  }
}

function pathsEqual(left: number[] | null, right: number[] | null): boolean {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isSelected(context: DrawContext, path: number[] | null): boolean {
  return context.selection?.rungId === context.rungId && pathsEqual(context.selection.path, path)
}

function shorten(value: string, limit = 19): string {
  const chars = Array.from(value)
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : value
}

function findAddress(tags: TagDef[], reference: string): string {
  const base = reference.split('.')[0]
  return tags.find((tag) => tag.name === base)?.address ?? ''
}

function formatMilliseconds(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 2)} s`
  return `${Math.round(value)} ms`
}

function readOutputQ(output: OutputElement, runtime: Runtime): boolean {
  if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR') {
    return runtime.timers[output.tag]?.q ?? false
  }
  if (output.kind === 'CTU') return runtime.counters[output.tag]?.q ?? false
  if (output.kind === 'SET' || output.kind === 'RESET') return runtime.bools[output.tag] ?? false
  return runtime.outputPower[output.id] ?? false
}

function activateWithKeyboard(
  event: React.KeyboardEvent<SVGGElement>,
  action: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

function renderContact(node: ContactNode, context: DrawContext, path: number[]): ReactNode {
  const size = contactSize(node)
  const selected = isSelected(context, path)
  const powered = context.runtime.nodePower[node.id] === true
  const address = findAddress(context.tags, node.tag)
  const centerX = size.width / 2
  const centerY = size.height / 2
  const select = () => context.onSelect({ rungId: context.rungId, path })

  return (
    <g
      key={`${node.id}-${path.join('.')}`}
      className={[
        'll-node',
        'll-contact',
        powered ? 'is-powered' : '',
        selected ? 'is-selected' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={`${CONTACT_LABELS[node.kind]}触点，变量 ${node.tag || '未绑定'}，点击选中`}
      onClick={(event) => {
        event.stopPropagation()
        select()
      }}
      onKeyDown={(event) => activateWithKeyboard(event, select)}
    >
      <title>{`${CONTACT_LABELS[node.kind]} ${node.tag || '未绑定'}${address ? ` · ${address}` : ''}`}</title>
      <rect className="ll-node-hit" x="2" y="3" width={size.width - 4} height={size.height - 6} rx="8" />
      <path className="ll-wire" d={`M 0 ${centerY} H ${size.width}`} />

      {node.kind === 'CMP' ? (
        <g>
          <rect className="ll-compare-box" x="10" y="27" width={size.width - 20} height="36" rx="5" />
          <text className="ll-compare-value" x={centerX} y="50" textAnchor="middle">
            {`${node.tag || '未绑定'} ${node.compare?.op ?? '>='} ${node.compare?.value ?? 0}`}
          </text>
        </g>
      ) : (
        <g>
          <line className="ll-contact-bar" x1={centerX - 10} y1={centerY - 15} x2={centerX - 10} y2={centerY + 15} />
          <line className="ll-contact-bar" x1={centerX + 10} y1={centerY - 15} x2={centerX + 10} y2={centerY + 15} />
          {node.kind === 'NC' && (
            <line className="ll-contact-slash" x1={centerX - 16} y1={centerY + 16} x2={centerX + 16} y2={centerY - 16} />
          )}
          {node.kind === 'P' && (
            <text className="ll-edge-mark" x={centerX + 23} y={centerY - 15}>P</text>
          )}
          {node.kind === 'N' && (
            <text className="ll-edge-mark" x={centerX + 23} y={centerY + 24}>N</text>
          )}
        </g>
      )}

      <text className="ll-tag-name" x={centerX} y="17" textAnchor="middle">{shorten(node.tag || '未绑定')}</text>
      <text className="ll-kind-label" x="8" y={size.height - 8}>#{CONTACT_LABELS[node.kind]}</text>
      <text className="ll-address" x={size.width - 8} y={size.height - 8} textAnchor="end">{address}</text>
      <rect className="ll-selection-box" x="2" y="3" width={size.width - 4} height={size.height - 6} rx="8" />
    </g>
  )
}

function renderParallel(node: Extract<LadderNode, { type: 'parallel' }>, context: DrawContext, path: number[]): ReactNode {
  const size = measureNode(node)
  const branchSizes = node.branches.map(measureChain)
  const selected = isSelected(context, path)
  const splitX = PARALLEL_SIDE / 2
  const collectX = size.width - PARALLEL_SIDE / 2
  const entryY = size.height / 2
  let branchY = 0
  const placements = branchSizes.map((branch) => {
    const y = branchY
    branchY += branch.height + PARALLEL_GAP
    return { y, centerY: y + branch.height / 2 }
  })
  const firstCenter = placements[0]?.centerY ?? entryY
  const lastCenter = placements[placements.length - 1]?.centerY ?? entryY
  const wireParts = [`M 0 ${entryY} H ${splitX}`, `M ${splitX} ${firstCenter} V ${lastCenter}`]
  placements.forEach((placement) => {
    wireParts.push(`M ${splitX} ${placement.centerY} H ${PARALLEL_SIDE}`)
    wireParts.push(`M ${collectX} ${placement.centerY} H ${size.width - PARALLEL_SIDE}`)
  })
  wireParts.push(`M ${collectX} ${firstCenter} V ${lastCenter}`, `M ${collectX} ${entryY} H ${size.width}`)
  const select = () => context.onSelect({ rungId: context.rungId, path })

  return (
    <g
      key={`${node.id}-${path.join('.')}`}
      className={`ll-node ll-parallel${selected ? ' is-selected' : ''}`}
    >
      <title>并联分支，点击 OR 标记选中</title>
      <path className="ll-wire" d={wireParts.join(' ')} />
      <g
        className="ll-or-badge"
        role="button"
        tabIndex={0}
        aria-label="选中并联分支"
        onClick={(event) => {
          event.stopPropagation()
          select()
        }}
        onKeyDown={(event) => activateWithKeyboard(event, select)}
      >
        <rect x={splitX + 5} y="2" width="34" height="18" rx="5" />
        <text x={splitX + 22} y="15" textAnchor="middle">OR</text>
      </g>
      {node.branches.map((branch, index) => {
        const placement = placements[index]
        return (
          <g
            key={`${node.id}-branch-${index}`}
            transform={`translate(${PARALLEL_SIDE}, ${placement.y})`}
          >
            {renderChain(branch, context, [...path, index])}
          </g>
        )
      })}
      <rect className="ll-selection-box" x="5" y="2" width={size.width - 10} height={size.height - 4} rx="7" />
    </g>
  )
}

function renderNode(node: LadderNode, context: DrawContext, path: number[]): ReactNode {
  return node.type === 'contact'
    ? renderContact(node, context, path)
    : renderParallel(node, context, path)
}

function renderChain(chain: LadderNode[], context: DrawContext, pathPrefix: number[]): ReactNode {
  const size = measureChain(chain)
  if (chain.length === 0) {
    return (
      <g className="ll-empty-branch">
        <line className="ll-wire" x1="0" y1={size.height / 2} x2={size.width} y2={size.height / 2} />
        <text x={size.width / 2} y={size.height / 2 - 8} textAnchor="middle">空</text>
      </g>
    )
  }

  const parts: ReactNode[] = []
  let cursorX = 0
  let previousEnd = 0
  chain.forEach((node, index) => {
    const nodeSize = measureNode(node)
    const nodeY = (size.height - nodeSize.height) / 2
    if (index > 0) {
      parts.push(
        <line
          key={`connector-${index}`}
          className="ll-wire"
          x1={previousEnd}
          y1={size.height / 2}
          x2={cursorX}
          y2={size.height / 2}
        />,
      )
    }
    parts.push(
      <g key={`${node.id}-${index}`} transform={`translate(${cursorX}, ${nodeY})`}>
        {renderNode(node, context, [...pathPrefix, index])}
      </g>,
    )
    previousEnd = cursorX + nodeSize.width
    cursorX = previousEnd + CHAIN_GAP
  })
  return <g>{parts}</g>
}

function renderOutput(output: OutputElement, context: DrawContext, rungId: string): ReactNode {
  const size = outputSize(output)
  const selected = isSelected(context, null)
  const powered = context.runtime.outputPower[output.id] === true
  const q = readOutputQ(output, context.runtime)
  const address = findAddress(context.tags, output.tag)
  const centerY = size.height / 2
  const select = () => context.onSelect({ rungId, path: null })

  return (
    <g
      className={[
        'll-node',
        'll-output',
        powered ? 'is-powered' : '',
        q ? 'is-true' : '',
        selected ? 'is-selected' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={`${OUTPUT_LABELS[output.kind]}输出，${output.tag || '未绑定'}，点击编辑`}
      onClick={(event) => {
        event.stopPropagation()
        select()
      }}
      onKeyDown={(event) => activateWithKeyboard(event, select)}
    >
      <title>{`${OUTPUT_LABELS[output.kind]} ${output.tag || '未绑定'}${q ? ' · Q=TRUE' : ' · Q=FALSE'}`}</title>
      <rect className="ll-node-hit" x="2" y="3" width={size.width - 4} height={size.height - 6} rx="8" />

      {output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET' ? (
        <g>
          <path className="ll-wire" d={`M 0 ${centerY} H ${size.width}`} />
          <path className="ll-coil-arc" d="M 56 21 Q 44 43 56 65" />
          <path className="ll-coil-arc" d="M 80 21 Q 92 43 80 65" />
          <text className="ll-coil-mark" x="68" y={centerY + 4} textAnchor="middle">
            {output.kind === 'SET' ? 'S' : output.kind === 'RESET' ? 'R' : ''}
          </text>
        </g>
      ) : (
        <g>
          <path className="ll-wire" d={`M 0 ${centerY} H 14`} />
          <rect className="ll-instruction-box" x="12" y="6" width={size.width - 12} height={size.height - 12} rx="7" />
          <text className="ll-box-title" x="24" y="25">{output.kind}</text>
          <text className="ll-box-instance" x={size.width - 20} y="25" textAnchor="end">{output.tag || '未命名'}</text>
          <line className="ll-box-divider" x1="20" y1="33" x2={size.width - 8} y2="33" />
          <text className="ll-pin-label" x="24" y="56">IN</text>
          <circle className={`ll-pin-led${powered ? ' is-on' : ''}`} cx="52" cy={centerY - 5} r="5" />
          <text className="ll-pin-label" x={size.width - 22} y="56" textAnchor="end">Q</text>
          <circle className={`ll-pin-led${q ? ' is-on' : ''}`} cx={size.width - 38} cy={centerY - 5} r="5" />
          {output.kind === 'CTU' ? (
            <g>
              <text className="ll-box-data" x="24" y="80">{`PV   ${output.pv ?? 1}`}</text>
              <text className="ll-box-data" x="24" y="101">{`CV   ${context.runtime.counters[output.tag]?.cv ?? 0}`}</text>
              <text className="ll-box-data" x="24" y="121">{`R    ${output.resetTag || '—'}`}</text>
            </g>
          ) : (
            <g>
              <text className="ll-box-data" x="24" y="80">{`PT   ${formatMilliseconds(output.pt ?? 0)}`}</text>
              <text className="ll-box-data" x="24" y="101">{`ET   ${formatMilliseconds(context.runtime.timers[output.tag]?.et ?? 0)}`}</text>
              {output.kind === 'TONR' && (
                <text className="ll-box-data" x="24" y="121">{`R    ${output.resetTag || '—'}`}</text>
              )}
            </g>
          )}
        </g>
      )}

      {(output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET') && (
        <text className="ll-output-name" x={size.width / 2} y="16" textAnchor="middle">{shorten(output.tag || '未绑定')}</text>
      )}
      <text className="ll-kind-label" x="8" y={size.height - 8}>#{OUTPUT_LABELS[output.kind]}</text>
      <text className="ll-address" x={size.width - 8} y={size.height - 8} textAnchor="end">{address}</text>
      <rect className="ll-selection-box" x="2" y="3" width={size.width - 4} height={size.height - 6} rx="8" />
    </g>
  )
}

function findSelectedNode(rung: Program['rungs'][number], selection: Selection | null): LadderNode | null {
  if (!selection || selection.rungId !== rung.id || selection.path === null) return null
  let chain = rung.nodes
  let node: LadderNode | null = null
  for (let index = 0; index < selection.path.length; index += 2) {
    node = chain[selection.path[index]] ?? null
    if (!node) return null
    if (index + 1 < selection.path.length) {
      if (node.type !== 'parallel') return null
      chain = node.branches[selection.path[index + 1]] ?? []
    }
  }
  return node
}

function describeNode(node: LadderNode): string {
  return node.type === 'contact'
    ? `${CONTACT_LABELS[node.kind]}触点 · ${node.tag || '未绑定'}`
    : `并联分支 · ${node.branches.length} 条支路`
}

function RungCard({
  rung,
  index,
  total,
  context,
  onDeleteNode,
  onWrapParallel,
  onCollapseParallel,
  onDuplicateRung,
  onDeleteRung,
  onMoveRung,
}: {
  rung: Program['rungs'][number]
  index: number
  total: number
  context: DrawContext
  onDeleteNode: (rungId: string, path: number[]) => void
  onWrapParallel: (rungId: string, path: number[]) => void
  onCollapseParallel: (rungId: string, path: number[]) => void
  onDuplicateRung: (rungId: string) => void
  onDeleteRung: (rungId: string) => void
  onMoveRung: (rungId: string, delta: -1 | 1) => void
}) {
  const chainMetrics = measureChain(rung.nodes)
  const outputMetrics = outputSize(rung.output)
  const contentHeight = Math.max(chainMetrics.height, outputMetrics.height)
  const diagramHeight = contentHeight + 42
  const chainX = 44
  const outputX = chainX + chainMetrics.width + 44
  const diagramWidth = outputX + outputMetrics.width + 38
  const powered = context.runtime.rungPower[rung.id] === true
  const selectedNode = findSelectedNode(rung, context.selection)
  const selectedPath = context.selection?.rungId === rung.id ? context.selection.path : null
  const chainY = (diagramHeight - chainMetrics.height) / 2
  const outputY = (diagramHeight - outputMetrics.height) / 2

  return (
    <article className={`ll-rung${powered ? ' is-powered' : ''}`} aria-label={`梯级 ${index + 1}：${rung.label || '未命名'}`}>
      <header className="ll-rung-header">
        <div className="ll-rung-title">
          <span className="ll-rung-number">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3>{rung.label || '未命名梯级'}</h3>
            <div className="ll-rung-meta">
              <span className={`ll-power-state${powered ? ' is-on' : ''}`}>
                <i />{powered ? '回路通电' : '回路断开'}
              </span>
              <span>{OUTPUT_LABELS[rung.output.kind]}</span>
            </div>
          </div>
        </div>
        <div className="ll-rung-tools" aria-label="梯级操作">
          <button type="button" title="上移梯级" disabled={index === 0} onClick={() => onMoveRung(rung.id, -1)}>↑</button>
          <button type="button" title="下移梯级" disabled={index === total - 1} onClick={() => onMoveRung(rung.id, 1)}>↓</button>
          <button type="button" title="复制梯级" onClick={() => onDuplicateRung(rung.id)}>⧉</button>
          <button type="button" className="is-danger" title="删除梯级" onClick={() => onDeleteRung(rung.id)}>×</button>
        </div>
      </header>

      {selectedPath !== null && selectedNode && (
        <div className="ll-inline-actions">
          <span>已选：{describeNode(selectedNode)}</span>
          <button type="button" onClick={() => selectedPath && onWrapParallel(rung.id, selectedPath)}>并联新支路</button>
          {selectedNode.type === 'parallel' && (
            <button type="button" onClick={() => selectedPath && onCollapseParallel(rung.id, selectedPath)}>收起为单支路</button>
          )}
          <button type="button" className="is-danger" onClick={() => selectedPath && onDeleteNode(rung.id, selectedPath)}>删除元件</button>
        </div>
      )}

      <div className="ll-svg-scroll">
        <svg
          className="ll-diagram"
          width={diagramWidth}
          height={diagramHeight}
          viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
          role="group"
          aria-label={`${rung.label || '梯级'} 梯形图`}
        >
          <line className="ll-rail" x1="20" y1="12" x2="20" y2={diagramHeight - 12} />
          <line className={`ll-power-wire${powered ? ' is-on' : ''}`} x1="20" y1={diagramHeight / 2} x2={chainX} y2={diagramHeight / 2} />
          <g transform={`translate(${chainX}, ${chainY})`}>{renderChain(rung.nodes, context, [])}</g>
          <line
            className={`ll-power-wire${powered ? ' is-on' : ''}`}
            x1={chainX + chainMetrics.width}
            y1={diagramHeight / 2}
            x2={outputX}
            y2={diagramHeight / 2}
          />
          <g transform={`translate(${outputX}, ${outputY})`}>{renderOutput(rung.output, context, rung.id)}</g>
          <line className="ll-rail" x1={diagramWidth - 20} y1="12" x2={diagramWidth - 20} y2={diagramHeight - 12} />
          <line
            className={`ll-power-wire${powered ? ' is-on' : ''}`}
            x1={outputX + outputMetrics.width}
            y1={diagramHeight / 2}
            x2={diagramWidth - 20}
            y2={diagramHeight / 2}
          />
        </svg>
      </div>
    </article>
  )
}

export default function LadderCanvas({
  program,
  runtime,
  selection,
  onSelect,
  onDeleteNode,
  onWrapParallel,
  onCollapseParallel,
  onDuplicateRung,
  onDeleteRung,
  onMoveRung,
  onAddRung,
}: LadderCanvasProps) {
  const context: DrawContext = {
    runtime,
    tags: program.tags,
    selection,
    rungId: '',
    onSelect,
  }

  return (
    <div className="ll-canvas">
      {program.rungs.length === 0 ? (
        <div className="ll-empty-board">
          <div className="ll-empty-symbol">—[ ]—( )</div>
          <h3>程序里还没有梯级</h3>
          <p>添加第一条梯级，然后从左侧指令面板插入触点。</p>
          <button type="button" onClick={onAddRung}>＋ 添加梯级</button>
        </div>
      ) : (
        program.rungs.map((rung, index) => (
          <RungCard
            key={rung.id}
            rung={rung}
            index={index}
            total={program.rungs.length}
            context={{ ...context, rungId: rung.id }}
            onDeleteNode={onDeleteNode}
            onWrapParallel={onWrapParallel}
            onCollapseParallel={onCollapseParallel}
            onDuplicateRung={onDuplicateRung}
            onDeleteRung={onDeleteRung}
            onMoveRung={onMoveRung}
          />
        ))
      )}
      {program.rungs.length > 0 && (
        <button type="button" className="ll-add-rung" onClick={onAddRung}>
          <span>＋</span> 添加梯级
        </button>
      )}
    </div>
  )
}
