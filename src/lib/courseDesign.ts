import { compile } from '../engine/compile'
import {
  buildCourseLab,
  buildElevatorProgram,
  buildQuizProgram,
  COURSE_LABS,
  ELEVATOR_MAX_FLOORS,
  ELEVATOR_MIN_FLOORS,
  QUIZ_MAX,
  QUIZ_MIN,
} from '../engine/courseLabs'
import {
  buildMachineLab,
  buildRunningLightProgram,
  MACHINE_LABS,
  RUNNING_LIGHT_MAX,
  RUNNING_LIGHT_MIN,
} from '../engine/machineLabs'
import { ensureTrailingBlankRung } from '../engine/rungInvariant'
import { SAMPLES } from '../engine/samples'
import type { Program } from '../engine/types'

export const COURSE_DESIGN_REPO = 'https://github.com/wakeup595626-cmyk/ladderlab'

export type CourseParameterKind = 'quiz' | 'elevator' | 'running-light'

export interface CourseParameterSpec {
  kind: CourseParameterKind
  value: number
  min: number
  max: number
  unit: string
}

export interface CourseDesignTemplate {
  id: string
  title: string
  category: string
  description: string
  triggers: string[]
  parameter?: CourseParameterSpec
  simulationSteps?: string[]
  build: () => Program
}

export type CourseDesignMatch =
  | { status: 'ok'; template: CourseDesignTemplate; matchedKeywords: string[] }
  | { status: 'unsupported'; message: string }
  | { status: 'ambiguous'; candidates: CourseDesignTemplate[]; message: string }
  | {
      status: 'incompatible'
      template: CourseDesignTemplate
      message: string
      requestedValue?: number
      requestedValues: number[]
    }

const COURSE_TRIGGERS: Record<string, string[]> = {
  'course-1': ['抢答器', '抢答'],
  'course-2': ['定时器与计数器', '定时计数'],
  'course-3': ['交通灯', '红绿灯', '十字路口', '信号灯'],
  'course-4': ['电梯', '三层电梯', '楼层呼叫'],
  'course-5': ['音乐喷泉', '喷泉'],
  'course-6': ['装配流水线', '装配线', '流水线'],
}

const MACHINE_TRIGGERS: Record<string, string[]> = {
  bulldozer: ['推土机', '铲刀'],
  'forward-reverse': ['电机正反转', '正反转', '正转反转'],
  'running-light': ['流水灯', '跑马灯', '八路流水灯'],
}

const SAMPLE_TRIGGERS: Record<string, string[]> = {
  'motor-hold': ['启保停', '起保停', '电机自锁', '自锁'],
  sequence: ['顺序启动', '延时启动', '风机水泵'],
  counter: ['计数包装', '满箱计数'],
  flasher: ['闪烁回路', '闪烁电路', '振荡电路'],
  edge: ['边沿计数', '上升沿计数', '脉冲计数'],
}

function stripCourseNumber(name: string): string {
  return name.replace(/^\d{2}\s*/, '')
}

export const COURSE_DESIGNS: CourseDesignTemplate[] = [
  ...COURSE_LABS.map((lab) => ({
    id: lab.id,
    title: stripCourseNumber(lab.name),
    category: '课程实验',
    description: lab.description,
    triggers: COURSE_TRIGGERS[lab.id] ?? [stripCourseNumber(lab.name)],
    parameter: lab.id === 'course-1'
      ? { kind: 'quiz', value: 4, min: QUIZ_MIN, max: QUIZ_MAX, unit: '路' }
      : lab.id === 'course-4'
        ? {
            kind: 'elevator',
            value: 3,
            min: ELEVATOR_MIN_FLOORS,
            max: ELEVATOR_MAX_FLOORS,
            unit: '层',
          }
        : undefined,
    simulationSteps: lab.id === 'course-1'
      ? parameterSteps('quiz', 4)
      : lab.id === 'course-4'
        ? parameterSteps('elevator', 3)
        : undefined,
    build: () => {
      const program = buildCourseLab(lab.id)
      if (!program) throw new Error(`内置课程实验“${lab.id}”不存在`)
      return program
    },
  })),
  ...MACHINE_LABS.map((lab) => ({
    id: lab.id,
    title: lab.name,
    category: '机器课设',
    description: lab.description,
    triggers: MACHINE_TRIGGERS[lab.id] ?? [lab.name],
    parameter: lab.id === 'running-light'
      ? { kind: 'running-light', value: 8, min: RUNNING_LIGHT_MIN, max: RUNNING_LIGHT_MAX, unit: '路' }
      : undefined,
    simulationSteps: lab.id === 'running-light' ? parameterSteps('running-light', 8) : undefined,
    build: () => {
      const program = buildMachineLab(lab.id)
      if (!program) throw new Error(`内置机器课设“${lab.id}”不存在`)
      return program
    },
  })),
  ...SAMPLES.map((sample) => ({
    id: sample.id,
    title: sample.name,
    category: '基础示例',
    description: sample.description,
    triggers: SAMPLE_TRIGGERS[sample.id] ?? [sample.name],
    build: sample.build,
  })),
]

const PARAMETER_UNITS: Record<CourseParameterKind, string[]> = {
  quiz: ['路', '人', '位'],
  elevator: ['层'],
  'running-light': ['路', '位'],
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  if (value.includes('十')) {
    const [left, right, ...rest] = value.split('十')
    if (rest.length > 0) return null
    const tens = left ? CHINESE_DIGITS[left] : 1
    const ones = right ? CHINESE_DIGITS[right] : 0
    if (tens === undefined || ones === undefined) return null
    return tens * 10 + ones
  }
  if (value.length !== 1) return null
  return CHINESE_DIGITS[value] ?? null
}

function chineseCount(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (value === 2) return '两'
  if (value < 10) return digits[value]
  if (value === 10) return '十'
  if (value < 20) return `十${digits[value - 10]}`
  const tens = Math.floor(value / 10)
  const ones = value % 10
  return `${digits[tens]}十${ones ? digits[ones] : ''}`
}

function requestedParameterValues(text: string, spec: CourseParameterSpec): number[] {
  const units = PARAMETER_UNITS[spec.kind].join('')
  const pattern = new RegExp(`(\\d+|[零〇一二两三四五六七八九十]+)[${units}]`, 'g')
  const values = new Set<number>()
  for (const match of text.matchAll(pattern)) {
    const value = parseChineseNumber(match[1])
    if (value !== null) values.add(value)
  }
  return [...values].sort((left, right) => left - right)
}

function parameterSteps(kind: CourseParameterKind, value: number): string[] {
  if (kind === 'elevator') {
    return [
      '初始只闭合 SQ1，确认电梯停在一层。',
      `点动 S${value}，确认 Cabin${value} 记忆、Up 和 UP 输出接通。`,
      `闭合 SQ${value}，确认到层后 Cabin${value} 清除、L${value} 点亮，顶层不再继续上行。`,
      `按下 U${value - 1} 外呼，确认电梯能从当前位置返回并清除对应呼梯记忆。`,
      '按 Reset 清除全部请求，再逐个检查其他楼层。',
    ]
  }
  if (kind === 'quiz') {
    return [
      '按 Reset，确认各选手灯、互锁和答题段全部熄灭。',
      '闭合并保持 P1，确认 L1 锁存、其他选手再按也无效。',
      '松开 P1 后再按 P2，确认仍保持第一位选手。',
      '按 Reset 后改按 P2，确认 P2 能成为新的首位。',
    ]
  }
  return [
    `按 Reset，确认 RunningLight1～${value} 全部熄灭。`,
    '点动 Start，确认灯按顺序逐路移动，不会同时乱亮。',
    `转到最高位 RunningLight${value} 后回卷到 RunningLight1。`,
    '按 Stop，确认脉冲停止且全部灯熄灭。',
  ]
}

function materializeParameterizedTemplate(
  template: CourseDesignTemplate,
  spec: CourseParameterSpec,
  value: number,
): CourseDesignTemplate {
  const title = spec.kind === 'elevator'
    ? `${chineseCount(value)}层电梯`
    : spec.kind === 'quiz'
      ? `${chineseCount(value)}路抢答器`
      : `${chineseCount(value)}路流水灯`
  const build = spec.kind === 'elevator'
    ? () => buildElevatorProgram(value)
    : spec.kind === 'quiz'
      ? () => buildQuizProgram(value)
      : () => buildRunningLightProgram(value)
  return {
    ...template,
    id: `${template.id}@${value}`,
    title,
    description: `${template.description} 当前按题目生成 ${value} ${spec.unit}规格。`,
    parameter: { ...spec, value },
    simulationSteps: parameterSteps(spec.kind, value),
    build,
  }
}

/** 全半角、大小写、空白和标点都不应该影响题目识别。 */
export function normalizeCourseText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * 只描述控制方式的泛化词，不单独决定用哪个模板。
 * “正反转自锁”应落到电机正反转，而不是和“电机自锁”基础示例并列成歧义；
 * 但题目里只有“电机自锁”时，仍然要能命中基础示例。
 */
const WEAK_TRIGGERS = new Set(['自锁'])

function collectHits(normalized: string, includeWeak: boolean) {
  return COURSE_DESIGNS
    .map((template) => {
      const matchedKeywords = template.triggers
        .filter((trigger) => (includeWeak || !WEAK_TRIGGERS.has(trigger))
          && normalized.includes(normalizeCourseText(trigger)))
        .sort((left, right) => right.length - left.length)
      return { template, matchedKeywords }
    })
    .filter((hit) => hit.matchedKeywords.length > 0)
}

export function matchCourseDesign(text: string): CourseDesignMatch {
  const normalized = normalizeCourseText(text)
  if (!normalized) {
    return { status: 'unsupported', message: '先输入课设题目，例如“三层电梯”或“四路抢答器”。' }
  }

  const strongHits = collectHits(normalized, false)
  const hits = strongHits.length > 0 ? strongHits : collectHits(normalized, true)

  if (hits.length === 0) {
    return {
      status: 'unsupported',
      message: '没有找到完全对应的内置模板。可以复制下面的 Agent 任务单，让能执行命令的助手按这个题目定制。',
    }
  }
  if (hits.length === 1) {
    const { template, matchedKeywords } = hits[0]
    const spec = template.parameter
    if (!spec) return { status: 'ok', template, matchedKeywords }

    const requestedValues = requestedParameterValues(normalized, spec)
    if (requestedValues.length > 1) {
      return {
        status: 'incompatible',
        template,
        requestedValues,
        message: `题目同时出现 ${requestedValues.join('、')} ${spec.unit}，规格互相冲突。请只保留一个明确的 ${spec.unit}数；内置模板每次只生成一种规格。`,
      }
    }
    if (requestedValues.length === 0) {
      return { status: 'ok', template, matchedKeywords }
    }

    const requestedValue = requestedValues[0]
    if (requestedValue < spec.min || requestedValue > spec.max) {
      return {
        status: 'incompatible',
        template,
        requestedValue,
        requestedValues,
        message: `题目要求“${template.title}”的 ${requestedValue} ${spec.unit}，但当前内置生成器只支持 ${spec.min}～${spec.max} ${spec.unit}。请改成范围内规格，或使用下方 Agent 任务单定制。`,
      }
    }
    return {
      status: 'ok',
      template: requestedValue === spec.value
        ? template
        : materializeParameterizedTemplate(template, spec, requestedValue),
      matchedKeywords,
    }
  }
  return {
    status: 'ambiguous',
    candidates: hits.map((hit) => hit.template),
    message: `题目同时命中 ${hits.length} 个内置模板，请选择一个再生成：${hits
      .map((hit) => `${hit.template.title}（${hit.matchedKeywords[0]}）`)
      .join('、')}`,
  }
}

/** 生成后立刻过仓库编译器；内置模板必须零错误零警告，否则不交给用户。 */
export function generateCourseDesign(templateOrId: string | CourseDesignTemplate): Program {
  const template = typeof templateOrId === 'string'
    ? COURSE_DESIGNS.find((item) => item.id === templateOrId)
    : templateOrId
  if (!template) throw new Error(`未知的内置课设模板：${String(templateOrId)}`)

  const program = ensureTrailingBlankRung(template.build())
  const result = compile(program)
  if (result.errors.length || result.warnings.length) {
    const details = [...result.errors, ...result.warnings]
      .slice(0, 6)
      .map((item) => `${item.severity === 'error' ? '错误' : '警告'}：${item.message}`)
      .join('；')
    throw new Error(`内置模板“${template.title}”没有通过仓库编译器：${details}`)
  }
  return program
}

export function makeAgentPrompt(text: string): string {
  const requirement = text.trim() || '（请在这里填写课设题目和动作要求）'
  return `请把下面这个 PLC 课设做成一份可以直接导入 LadderLab 的梯形图工程。\n\n`
    + `仓库：${COURSE_DESIGN_REPO}\n\n`
    + `原始需求：\n${requirement}\n\n`
    + '工作要求：\n'
    + '1. 先完整阅读仓库根目录的 AGENT_START_HERE.md、AGENTS.md 和 docs/AI_GUIDE.md，按里面的工程格式与硬性限制执行。\n'
    + '2. 先列出完整 I/O 表（输入、输出、内部存储，含地址、变量名、作用），再写状态转换表；不要先写代码后补说明。\n'
    + '3. 优先复用 src/engine/courseLabs.ts、src/engine/machineLabs.ts 和 examples/ 里已经验证过的结构，能复用就复用，不要重画。\n'
    + '4. 生成完整的 .ladderlab.json（schema、profile、tags、rungs 齐全），变量名、程序段 ID、元件 ID 全部唯一。\n'
    + '5. 在仓库根目录自己执行命令，不要让用户手动操作：先 npm install，再运行\n'
    + '   node scripts/check-project.mjs <你的文件>.ladderlab.json\n'
    + '   必须看到 ✔ 且退出码为 0。没有通过就按报错逐条修；不要改校验器，也不要删掉用户要求的动作。\n'
    + '6. 在仿真里推演：初始 → 启动 → 过程 → 到点动作 → 停止 / 复位，确认动作顺序和互锁正确。编译通过不等于逻辑正确。\n'
    + '7. 通过后执行 node scripts/share-link.mjs <你的文件>.ladderlab.json，把可点开的分享链接、I/O 表、每段程序的作用和仿真步骤一起交付。\n'
    + '8. 未校验不得声称完成。没跑到校验器的 ✔，不得声称“做好了”或“验证过了”。如果环境不能运行 Node，就直接交付完整 JSON，并明确标注“未经仓库校验器验证”。\n\n'
    + '交付时请先给结论和分享链接，再给 I/O 表、程序段说明和仿真步骤。'
}
