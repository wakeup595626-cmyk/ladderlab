import { describe, expect, it } from 'vitest'
import { compile } from '../engine/compile'
import { parseProgramText } from './io'

/**
 * examples/ 既是给人看的样例，也是 AI 生成工程的“验收靶子”。
 * 任何一个样例文件在导入校验或编译阶段出问题，这里就会红。
 */
const examples = import.meta.glob('../../examples/*.ladderlab.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

describe('AI 样例工程', () => {
  it('examples 目录里至少有一个样例', () => {
    expect(Object.keys(examples).length).toBeGreaterThan(0)
  })

  for (const [path, text] of Object.entries(examples)) {
    it(`${path} 能通过导入校验并编译零错误`, () => {
      const program = parseProgramText(text)
      expect(program.rungs.length).toBeGreaterThan(1)
      expect(compile(program).errors).toEqual([])
    })
  }
})
