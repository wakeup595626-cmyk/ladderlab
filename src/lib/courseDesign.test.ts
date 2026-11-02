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

describe('一键课设题目匹配', () => {
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
})

describe('Agent 定制任务单', () => {
  it('包含仓库、原始需求、自检与分享命令以及诚实验证边界', () => {
    const prompt = makeAgentPrompt('做一个带前后限位的推土机')
    expect(prompt).toContain(COURSE_DESIGN_REPO)
    expect(prompt).toContain('做一个带前后限位的推土机')
    expect(prompt).toContain('node scripts/check-project.mjs')
    expect(prompt).toContain('node scripts/share-link.mjs')
    expect(prompt).toContain('未校验不得声称完成')
    expect(prompt).toContain('未经仓库校验器验证')
    expect(prompt).toContain('不要让用户手动操作')
  })
})
