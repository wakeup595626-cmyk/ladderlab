import { describe, expect, it } from 'vitest'
import type { Program } from '../engine/types'
import { parseProgramText, serializeProgram } from './io'
import {
  decodeProgramShare,
  encodeProgramShare,
  isShareProgramHash,
  SHARE_LINK_SOFT_LIMIT,
} from './shareLink'

const sample: Program = {
  schema: 1,
  name: '分享测试',
  profile: 'v21',
  tags: [
    { id: 't-a', name: 'Start', address: '%I0.0', kind: 'BOOL', initial: false, comment: '启动' },
    { id: 't-b', name: 'Lamp', address: '%Q0.0', kind: 'BOOL', initial: false, comment: '灯' },
  ],
  rungs: [
    {
      id: 'r1',
      label: '启动点亮',
      nodes: [{ type: 'contact', id: 'c1', kind: 'NO', tag: 'Start' }],
      output: { id: 'o1', kind: 'COIL', tag: 'Lamp' },
    },
  ],
}

describe('分享链接', () => {
  it('能原样往返一份工程', async () => {
    const hash = await encodeProgramShare(sample)
    expect(isShareProgramHash(hash)).toBe(true)
    const restored = await decodeProgramShare(hash)
    expect(restored.name).toBe(sample.name)
    expect(restored.tags).toEqual(sample.tags)
    expect(restored.rungs[0].output.tag).toBe('Lamp')
  })

  it('压缩后明显短于原始 JSON', async () => {
    const hash = await encodeProgramShare(sample)
    expect(hash.length).toBeLessThan(serializeProgram(sample).length)
  })

  it('能读取明文回退格式', async () => {
    const bytes = new TextEncoder().encode(serializeProgram(sample))
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const body = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const restored = await decodeProgramShare(`#p=0.${body}`)
    expect(restored.name).toBe(sample.name)
  })

  it('拒绝空片段和损坏的链接', async () => {
    expect(isShareProgramHash('#p=')).toBe(false)
    await expect(decodeProgramShare('#p=1.not-base64!!')).rejects.toThrow()
    await expect(decodeProgramShare('#other')).rejects.toThrow('不是 LadderLab 的分享链接')
  })

  it('能装下真实课程实验而不超过聊天软件的软上限', async () => {
    const { buildCourseLab } = await import('../engine/courseLabs')
    const elevator = buildCourseLab('course-4')
    expect(elevator).not.toBeNull()
    const hash = await encodeProgramShare(elevator as Program)
    const restored = await decodeProgramShare(hash)
    expect(restored.rungs.length).toBe((elevator as Program).rungs.length)
    expect(hash.length).toBeLessThan(SHARE_LINK_SOFT_LIMIT)
  })

  it('导入前会走一遍和文件相同的严格校验', async () => {
    const bad = { ...sample, schema: 2 }
    const bytes = new TextEncoder().encode(JSON.stringify(bad))
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const body = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    await expect(decodeProgramShare(`#p=0.${body}`)).rejects.toThrow('分享链接里的工程无法导入')
    expect(() => parseProgramText(JSON.stringify(bad))).toThrow()
  })
})
