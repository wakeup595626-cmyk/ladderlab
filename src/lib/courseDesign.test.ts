import { describe, expect, it } from 'vitest'
import { compile } from '../engine/compile'
import { parseProgramText, serializeProgram } from './io'
import {
  COURSE_DESIGNS,
  COURSE_DESIGN_REPO,
  generateCourseDesign,
  makeAgentPrompt,
  matchCourseDesign,
  normalizeCourseText,
} from './courseDesign'

function matchedId(text: string): string | null {
  const match = matchCourseDesign(text)
  return match.status === 'ok' ? match.template.id : null
}

describe('内置实验题目匹配', () => {
  it('把常见课设题目映射到确定性模板', () => {
    expect(matchedId('三层电梯')).toBe('course-4')
    expect(matchedId('四路抢答器')).toBe('course-1')
    expect(matchedId('推土机')).toBe('bulldozer')
    expect(matchedId('八路流水灯')).toBe('running-light')
    expect(matchedId('电机正反转')).toBe('forward-reverse')
  })

  it('同一模板命中多个关键词时仍只算一个模板', () => {
    const match = matchCourseDesign('四路抢答器，带抢答互锁')
    expect(match.status).toBe('ok')
    if (match.status !== 'ok') return
    expect(match.template.id).toBe('course-1')
    expect(match.matchedKeywords).toEqual(['抢答器', '抢答'])
  })

  it('按题目生成准确的电梯层数、抢答路数和流水灯路数', () => {
    expect(matchedId('两层电梯')).toBe('course-4@2')
    expect(matchedId('三层电梯')).toBe('course-4')
    expect(matchedId('四层电梯')).toBe('course-4@4')
    expect(matchedId('十层电梯')).toBe('course-4@10')
    expect(matchedId('三人抢答器')).toBe('course-1@3')
    expect(matchedId('四路抢答器')).toBe('course-1')
    expect(matchedId('六路流水灯')).toBe('running-light@6')
    expect(matchedId('八路流水灯')).toBe('running-light')
  })

  it('覆盖抢答器 2～8 路、电梯 2～10 层、流水灯 2～8 路的完整参数范围', () => {
    const cn = (value: number) => ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][value]
    for (const value of [2, 3, 4, 5, 6, 7, 8]) {
      expect(matchedId(`${cn(value)}路抢答器`)).toBe(value === 4 ? 'course-1' : `course-1@${value}`)
      expect(matchedId(`${value}路抢答器`)).toBe(value === 4 ? 'course-1' : `course-1@${value}`)
      expect(matchedId(`${cn(value)}路流水灯`)).toBe(value === 8 ? 'running-light' : `running-light@${value}`)
      expect(matchedId(`八路流水灯`)).toBe('running-light')
    }
    for (const value of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(matchedId(`${cn(value)}层电梯`)).toBe(value === 3 ? 'course-4' : `course-4@${value}`)
      expect(matchedId(`${value}层电梯`)).toBe(value === 3 ? 'course-4' : `course-4@${value}`)
    }
    // 全角数字经 NFKC 归一化后仍应识别成同一个规格。
    expect(matchedId('６路流水灯')).toBe('running-light@6')
    expect(matchedId('８层电梯')).toBe('course-4@8')
  })

  it('泛化词“自锁”不会把正反转题目拉成歧义，单独使用时仍命中基础示例', () => {
    expect(matchedId('正反转自锁')).toBe('forward-reverse')
    expect(matchedId('电机自锁')).toBe('motor-hold')
    expect(matchedId('启保停')).toBe('motor-hold')
  })

  it('同时提出两个独立功能时仍然要求用户选择', () => {
    const match = matchCourseDesign('抢答器定时计数')
    expect(match.status).toBe('ambiguous')
    if (match.status !== 'ambiguous') return
    expect(match.candidates.map((item) => item.id).sort()).toEqual(['course-1', 'course-2'])
  })

  it('全半角、大小写、空白和标点不影响识别', () => {
    expect(normalizeCourseText('  三 层－电梯！ ')).toBe('三层电梯')
    expect(matchedId('三层／电梯')).toBe('course-4')
  })

  it('同时命中多个模板时要求用户选择，不擅自猜测', () => {
    const match = matchCourseDesign('三层电梯和四路抢答器')
    expect(match.status).toBe('ambiguous')
    if (match.status !== 'ambiguous') return
    expect(match.candidates.map((item) => item.id).sort()).toEqual(['course-1', 'course-4'])
  })

  it('未命中和空题目都进入 Agent 定制路径', () => {
    expect(matchCourseDesign('今天天气不错').status).toBe('unsupported')
    expect(matchCourseDesign('   ').status).toBe('unsupported')
  })

  it('超出生成器范围时明确拒绝，不静默改成相近模板', () => {
    for (const [text, value] of [
      ['十一层电梯', 11],
      ['九路流水灯', 9],
      ['一人抢答器', 1],
    ] as const) {
      const match = matchCourseDesign(text)
      expect(match.status).toBe('incompatible')
      if (match.status !== 'incompatible') continue
      expect(match.requestedValue).toBe(value)
      expect(match.message).toContain('只支持')
    }
  })

  it('同一题目出现冲突规格时要求用户重新明确', () => {
    const match = matchCourseDesign('四层电梯和三层电梯')
    expect(match.status).toBe('incompatible')
    if (match.status !== 'incompatible') return
    expect(match.requestedValues).toEqual([3, 4])
    expect(match.message).toContain('冲突')
  })
})

describe('内置课设生成值', () => {
  it('公开 6 个课程实验、3 个机器课设和 5 个基础示例', () => {
    expect(COURSE_DESIGNS).toHaveLength(14)
    expect(COURSE_DESIGNS.filter((item) => item.category === '课程实验')).toHaveLength(6)
    expect(COURSE_DESIGNS.filter((item) => item.category === '机器课设')).toHaveLength(3)
    expect(COURSE_DESIGNS.filter((item) => item.category === '基础示例')).toHaveLength(5)
  })

  it.each(COURSE_DESIGNS)('$title 生成后编译双零且 JSON 无损往返', (template) => {
    const program = generateCourseDesign(template)
    const result = compile(program)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(program.rungs.length).toBeGreaterThan(0)
    expect(parseProgramText(serializeProgram(program))).toEqual(program)
  })

  it.each([
    ['四层电梯', 'course-4@4'],
    ['两层电梯', 'course-4@2'],
    ['三人抢答器', 'course-1@3'],
    ['六路流水灯', 'running-light@6'],
  ])('%s 的动态规格也能编译双零并往返', (text, expectedId) => {
    const match = matchCourseDesign(text)
    expect(match.status).toBe('ok')
    if (match.status !== 'ok') return
    expect(match.template.id).toBe(expectedId)
    const program = generateCourseDesign(match.template)
    const result = compile(program)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(parseProgramText(serializeProgram(program))).toEqual(program)
  })
})

describe('Agent 定制任务单', () => {
  it('包含仓库、原始需求、自检与分享命令以及诚实验证边界', () => {
    const prompt = makeAgentPrompt('做一个带前后限位的推土机')
    expect(prompt).toContain(COURSE_DESIGN_REPO)
    expect(prompt).toContain('AGENT_START_HERE.md')
    expect(prompt).toContain('做一个带前后限位的推土机')
    expect(prompt).toContain('请直接执行')
    expect(prompt).toContain('不要只给方案')
    expect(prompt).toContain('src/engine/machineLabs.ts')
    expect(prompt).toContain('node scripts/check-project.mjs')
    expect(prompt).toContain('node scripts/share-link.mjs')
    expect(prompt).toContain('未校验不得声称完成')
    expect(prompt).toContain('未经仓库校验器验证')
    expect(prompt).toContain('用户不需要手敲命令')
    expect(prompt).toContain('不要生成 TIA Portal')
  })
})
