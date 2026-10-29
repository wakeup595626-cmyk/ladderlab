import type { Program } from '../engine/types'
import { parseProgramText, serializeProgram } from './io'

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

export function isShareProgramHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX) && hash.length > HASH_PREFIX.length + 2
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

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
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

export async function decodeProgramShare(hash: string): Promise<Program> {
  if (!isShareProgramHash(hash)) throw new Error('这不是 LadderLab 的分享链接。')
  const payload = hash.slice(HASH_PREFIX.length)
  const split = payload.indexOf('.')
  if (split <= 0) throw new Error('分享链接格式不完整，可能在复制时被截断了。')
  const format = payload.slice(0, split)
  const body = payload.slice(split + 1)

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
    } catch {
      throw new Error('分享链接解压失败，可能在复制时被截断了。')
    }
  } else if (format === FORMAT_PLAIN) {
    text = new TextDecoder().decode(bytes)
  } else {
    throw new Error('不认识的分享链接格式。')
  }

  try {
    return parseProgramText(text)
  } catch (reason) {
    throw new Error(`分享链接里的工程无法导入：${reason instanceof Error ? reason.message : '格式不正确'}`)
  }
}
