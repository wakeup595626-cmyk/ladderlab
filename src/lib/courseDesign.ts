import { compile } from '../engine/compile'
import { buildCourseLab, COURSE_LABS } from '../engine/courseLabs'
import { buildMachineLab, MACHINE_LABS } from '../engine/machineLabs'
import { ensureTrailingBlankRung } from '../engine/rungInvariant'
import { SAMPLES } from '../engine/samples'
import type { Program } from '../engine/types'

export const COURSE_DESIGN_REPO = 'https://github.com/wakeup595626-cmyk/ladderlab'

export interface CourseDesignTemplate {
  id: string
  title: string
  category: string
  description: string
  triggers: string[]
  build: () => Program
}

export type CourseDesignMatch =
  | { status: 'ok'; template: CourseDesignTemplate; matchedKeywords: string[] }
  | { status: 'unsupported'; message: string }
  | { status: 'ambiguous'; candidates: CourseDesignTemplate[]; message: string }

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

/** 全半角、大小写、空白和标点都不应该影响题目识别。 */
export function normalizeCourseText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function matchCourseDesign(text: string): CourseDesignMatch {
  const normalized = normalizeCourseText(text)
  if (!normalized) {
    return { status: 'unsupported', message: '先输入课设题目，例如“三层电梯”或“四路抢答器”。' }
  }

  const hits = COURSE_DESIGNS
    .map((template) => {
      const matchedKeywords = template.triggers
        .filter((trigger) => normalized.includes(normalizeCourseText(trigger)))
        .sort((left, right) => right.length - left.length)
      return { template, matchedKeywords }
    })
    .filter((hit) => hit.matchedKeywords.length > 0)

  if (hits.length === 0) {
    return {
      status: 'unsupported',
      message: '没有找到完全对应的内置模板。可以复制下面的 Agent 任务单，让能执行命令的助手按这个题目定制。',
    }
  }
  if (hits.length === 1) {
    return { status: 'ok', template: hits[0].template, matchedKeywords: hits[0].matchedKeywords }
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
    + '1. 先完整阅读仓库根目录的 AGENTS.md 和 docs/AI_GUIDE.md，按里面的工程格式与硬性限制执行。\n'
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
