#!/usr/bin/env node
/**
 * 分享链接的字节格式。CLI、校验器和测试都从这里取，避免各写一份悄悄走偏。
 *
 * 必须与 src/lib/shareLink.ts 保持一致：deflate-raw + base64url，标记为 '1'。
 */
import { deflateRawSync } from 'node:zlib'

export const DEFAULT_SITE = 'https://wakeup595626-cmyk.github.io/ladderlab/'
export const SOFT_LIMIT = 12000

/**
 * 与 src/lib/shareLink.ts 的 encodeProgramShare 逐字节对应：
 * 两空格缩进 → deflate-raw → base64url（无填充）→ #p=1.<载荷>
 */
export function buildShareHash(program) {
  const payload = deflateRawSync(Buffer.from(JSON.stringify(program, null, 2), 'utf8'), { level: 9 })
  return `#p=1.${Buffer.from(payload).toString('base64url')}`
}

export function buildShareUrl(program, site = DEFAULT_SITE) {
  return `${site.replace(/#.*$/, '').replace(/\/?$/, '/')}${buildShareHash(program)}`
}
