import { describe, expect, it, vi } from 'vitest'
import type { Program } from '../engine/types'
import { MAX_IMPORT_BYTES, parseProgramText, serializeProgram } from './io'
import {
  buildShareUrl,
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
    // 非空但损坏的载荷仍要进入解码流程；页面才能保留地址并给出可理解的错误，
    // 而不是把它当成普通锚点悄悄忽略。
    expect(isShareProgramHash('#p=1.not-base64!!')).toBe(true)
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

  it('拼出的地址忽略查询参数，只保留站点路径和工程片段', async () => {
    const hash = await encodeProgramShare(sample)
    expect(buildShareUrl({ origin: 'https://example.com', pathname: '/ladderlab/' }, hash))
      .toBe(`https://example.com/ladderlab/${hash}`)
  })
})

const MAX_COMPRESSED_BYTES = MAX_IMPORT_BYTES + 64 * 1024
const MAX_SHARE_BODY_CHARS = Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4

function base64UrlOf(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('分享链接的体积上限', () => {
  it('明文载荷超过 5 MB 时拒绝，并指向文件导入', async () => {
    // 6,990,508 个 base64 字符解出 5,242,881 字节，刚好越过 5 MB 一个字节。
    const body = 'A'.repeat(Math.ceil((MAX_IMPORT_BYTES + 1) / 3) * 4)
    expect(body.length).toBeLessThan(MAX_SHARE_BODY_CHARS)
    await expect(decodeProgramShare(`#p=0.${body}`)).rejects.toThrow('超过 5 MB 上限')
  })

  it('恰好 5 MB 的明文载荷不会被体积上限误伤', async () => {
    // 6,990,507 个 base64 字符正好解出 5,242,880 字节，应当进入后续的工程解析并因内容不合法失败。
    const body = 'A'.repeat(Math.floor(MAX_IMPORT_BYTES / 3) * 4 + 3)
    await expect(decodeProgramShare(`#p=0.${body}`)).rejects.toThrow('分享链接里的工程无法导入')
  })

  it('链接正文超出可承载长度时在 base64 解码前拒绝', async () => {
    const body = 'A'.repeat(MAX_SHARE_BODY_CHARS + 4)
    const decodeSpy = vi.spyOn(globalThis, 'atob')
    try {
      await expect(decodeProgramShare(`#p=1.${body}`)).rejects.toThrow('超过 5 MB 上限')
      expect(decodeSpy).not.toHaveBeenCalled()
    } finally {
      decodeSpy.mockRestore()
    }
  })

  it('压缩载荷解压后超限时立刻取消上游，不会把整份数据读完', async () => {
    const megabyte = new Uint8Array(1024 * 1024)
    let pulled = 0
    let cancelled = false
    class FakeDecompressionStream {
      readable: ReadableStream<Uint8Array>
      writable: WritableStream<Uint8Array>
      constructor() {
        this.writable = new WritableStream<Uint8Array>({ write() {} })
        this.readable = new ReadableStream<Uint8Array>({
          pull: (controller) => {
            pulled += 1
            if (pulled > 64) {
              controller.close()
              return
            }
            controller.enqueue(megabyte)
          },
          cancel: () => {
            cancelled = true
          },
        })
      }
    }
    vi.stubGlobal('DecompressionStream', FakeDecompressionStream)
    try {
      const body = base64UrlOf(new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]))
      await expect(decodeProgramShare(`#p=1.${body}`)).rejects.toThrow('超过 5 MB 上限')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(cancelled).toBe(true)
    // 5 MB 上限：读满 5 块后，第 6 块越界即中止，剩下的块不再拉取。
    expect(pulled).toBe(6)
  })

  it('真实 deflate 压缩包解压后超限时同样被拦下', async () => {
    const huge = new Uint8Array(MAX_IMPORT_BYTES * 8)
    const compressed = new Uint8Array(
      await new Response(new Blob([huge]).stream().pipeThrough(new CompressionStream('deflate-raw')))
        .arrayBuffer(),
    )
    expect(compressed.byteLength).toBeLessThan(MAX_SHARE_BODY_CHARS / 4)
    await expect(decodeProgramShare(`#p=1.${base64UrlOf(compressed)}`)).rejects.toThrow('超过 5 MB 上限')
  })
})
