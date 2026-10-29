/**
 * 命令行工具和网页端必须能互相读懂对方的链接。
 *
 * 这里用 Node 的 zlib 造链接（和 scripts/share-link.mjs 同一段代码），
 * 再用网页端的 decodeProgramShare 解开，等于把“AI 生成的链接在学生浏览器里能不能用”钉死在测试里。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentRungs } from '../src/engine/rungInvariant'
import { parseProgramText, serializeProgram } from '../src/lib/io'
import { decodeProgramShare, isShareProgramHash } from '../src/lib/shareLink'
import { buildShareHash, buildShareUrl } from './share-link.mjs'

const examples = ['running-light', 'motor-forward-reverse']

describe('命令行分享链接与网页端互通', () => {
  for (const name of examples) {
    it(`能解开命令行生成的 ${name} 链接`, async () => {
      const raw = readFileSync(new URL(`../examples/${name}.ladderlab.json`, import.meta.url), 'utf8')
      const program = JSON.parse(raw)
      const hash = buildShareHash(program)

      expect(isShareProgramHash(hash)).toBe(true)
      const decoded = await decodeProgramShare(hash)
      expect(decoded.name).toBe(program.name)
      // 末尾占位段的 ID 每次规范化都会重生成，只比真实内容段。
      expect(serializeProgram({ ...decoded, rungs: contentRungs(decoded) }))
        .toBe(serializeProgram({ ...parseProgramText(raw), rungs: contentRungs(parseProgramText(raw)) }))
    })
  }

  it('拼出来的地址指向站点首页并带上片段', () => {
    const url = buildShareUrl({ schema: 1, name: 'x', profile: 'v21', tags: [], rungs: [] })
    expect(url.startsWith('https://wakeup595626-cmyk.github.io/ladderlab/#p=1.')).toBe(true)
  })
})
