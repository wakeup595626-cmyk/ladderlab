import type { Program } from '../engine/types'
import { MAX_IMPORT_BYTES, parseProgramStructureText, serializeProgram } from './io'
import type { ParsedProgramStructure } from './io'

/**
 * 分享链接：把整份工程压进 URL 片段，AI 生成工程后给学生一个可以直接点开的地址。
 *
 * GitHub Pages 是纯静态托管，收不到任何写入请求，所以“AI 把工程送到网站上”
 * 只能靠链接本身携带内容。片段（# 之后）不会发给服务器，也不占用请求长度，
 * 天然适合装载荷。
 */
const HASH_PREFIX = '#p='
const FORMAT_DEFLATE = '1'
const FORMAT_PLAIN = '0'

/**
 * 超过这个长度，微信、QQ 一类的聊天窗口可能截断或拒绝发送链接，
 * 界面应提示改用文件导入。
 */
export const SHARE_LINK_SOFT_LIMIT = 12000
/** deflate-raw 在不可压缩内容上可能略大于原始数据，给压缩载荷留一点余量。 */
const MAX_COMPRESSED_BYTES = MAX_IMPORT_BYTES + 64 * 1024
/** base64url 去掉填充符后，字符串长度不会超过这个值。 */
const MAX_SHARE_BODY_CHARS = Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4

class SharePayloadTooLargeError extends Error {
  constructor() {
    super('sharing payload is too large')
    this.name = 'SharePayloadTooLargeError'
  }
}

export function isShareProgramHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX) && hash.length > HASH_PREFIX.length + 2
}

/**
 * 拼出可以直接发出去的完整地址：站点路径 + 分享片段。
 * 丢掉原来的查询参数，避免把别人手上的旧参数一起传下去。
 */
export function buildShareUrl(location: { origin: string; pathname: string }, hash: string): string {
  return `${location.origin}${location.pathname}${hash}`
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function hasCompressionStream(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readAtMost(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > limit) {
        try {
          await reader.cancel()
        } catch {
          // 超限本身才是要报告的错误，取消流失败不应覆盖它。
        }
        throw new SharePayloadTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return readAtMost(stream, MAX_IMPORT_BYTES)
}

/** 后台标签页或旧浏览器没有 CompressionStream 时退回明文，链接会长一些但照样能用。 */
export async function encodeProgramShare(program: Program): Promise<string> {
  const bytes = new TextEncoder().encode(serializeProgram(program))
  if (hasCompressionStream()) {
    try {
      return `${HASH_PREFIX}${FORMAT_DEFLATE}.${toBase64Url(await deflate(bytes))}`
    } catch {
      // 压缩失败就退回明文，不能让分享功能整体不可用。
    }
  }
  return `${HASH_PREFIX}${FORMAT_PLAIN}.${toBase64Url(bytes)}`
}

/** 分享链接是编辑器入口之一，结构正确但变量待修正的工程也必须能读回。 */
export async function decodeProgramShareStructure(hash: string): Promise<ParsedProgramStructure> {
  if (!isShareProgramHash(hash)) throw new Error('这不是 LadderLab 的分享链接。')
  const payload = hash.slice(HASH_PREFIX.length)
  const split = payload.indexOf('.')
  if (split <= 0) throw new Error('分享链接格式不完整，可能在复制时被截断了。')
  const format = payload.slice(0, split)
  const body = payload.slice(split + 1)
  if (body.length > MAX_SHARE_BODY_CHARS) {
    throw new Error(`分享链接里的工程超过 ${MAX_IMPORT_BYTES / (1024 * 1024)} MB 上限，请改用文件导入。`)
  }

  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(body)
  } catch {
    throw new Error('分享链接内容已损坏，可能在复制时被截断了。')
  }

  let text: string
  if (format === FORMAT_DEFLATE) {
    if (!hasCompressionStream()) throw new Error('这个浏览器不支持解压分享链接，请改用文件导入。')
    try {
      text = new TextDecoder().decode(await inflate(bytes))
    } catch (reason) {
      if (reason instanceof SharePayloadTooLargeError) {
        throw new Error(`分享链接里的工程超过 ${MAX_IMPORT_BYTES / (1024 * 1024)} MB 上限，请改用文件导入。`)
      }
      throw new Error('分享链接解压失败，可能在复制时被截断了。')
    }
  } else if (format === FORMAT_PLAIN) {
    if (bytes.byteLength > MAX_IMPORT_BYTES) {
      throw new Error(`分享链接里的工程超过 ${MAX_IMPORT_BYTES / (1024 * 1024)} MB 上限，请改用文件导入。`)
    }
    text = new TextDecoder().decode(bytes)
  } else {
    throw new Error('不认识的分享链接格式。')
  }

  try {
    return parseProgramStructureText(text)
  } catch (reason) {
    throw new Error(`分享链接里的工程无法导入：${reason instanceof Error ? reason.message : '格式不正确'}`)
  }
}

/** 保留严格解码入口，供只接受完整工程的调用方和既有测试使用。 */
export async function decodeProgramShare(hash: string): Promise<Program> {
  const { program, issues } = await decodeProgramShareStructure(hash)
  if (issues.length > 0) {
    throw new Error(`分享链接里的工程无法导入：${issues[0]?.message ?? '工程仍有待修正的问题'}`)
  }
  return program
}
