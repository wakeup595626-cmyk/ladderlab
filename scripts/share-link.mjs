#!/usr/bin/env node
/**
 * 把一份 .ladderlab.json 工程压成可以直接点开的分享链接。
 *
 *   node scripts/share-link.mjs examples/running-light.ladderlab.json
 *
 * 输出形如 https://wakeup595626-cmyk.github.io/ladderlab/#p=1.<base64url>
 * 页面打开后会弹窗询问是否导入，确认后才写入，不会覆盖未保存的草稿。
 *
 * 格式必须与 src/lib/shareLink.ts 保持一致：deflate-raw + base64url，标记为 '1'。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const DEFAULT_SITE = 'https://wakeup595626-cmyk.github.io/ladderlab/'
const SOFT_LIMIT = 12000

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

function usage(message) {
  if (message) console.error(`错误：${message}`)
  console.error('用法：node scripts/share-link.mjs <工程.json> [--site <站点地址>] [--out <输出文件>]')
  process.exit(1)
}

function main() {

const args = process.argv.slice(2)
let input
let site = process.env.LADDERLAB_SITE || DEFAULT_SITE
let out

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--site') {
    site = args[++index] ?? usage('--site 后面要跟地址')
  } else if (arg === '--out') {
    out = args[++index] ?? usage('--out 后面要跟文件名')
  } else if (arg === '-h' || arg === '--help') {
    usage()
  } else if (arg.startsWith('--')) {
    usage(`不认识的参数 ${arg}`)
  } else if (!input) {
    input = arg
  } else {
    usage('一次只能处理一个工程文件')
  }
}

if (!input) usage('缺少工程文件')

let text
try {
  text = readFileSync(resolve(input), 'utf8').replace(/^\uFEFF/, '')
} catch (reason) {
  usage(`读不到 ${input}：${reason.message}`)
}

let program
try {
  program = JSON.parse(text)
} catch (reason) {
  usage(`${basename(input)} 不是有效的 JSON：${reason.message}`)
}

// 只在命令行做粗筛，完整校验（变量引用、编译器限制）由 npm test / 页面导入负责。
if (!program || typeof program !== 'object' || Array.isArray(program)) usage('工程根节点必须是对象')
if (program.schema !== 1) usage('schema 必须是 1')
if (program.profile !== 'v14' && program.profile !== 'v21') usage('profile 必须是 v14 或 v21')
if (!Array.isArray(program.tags)) usage('tags 必须是数组')
if (!Array.isArray(program.rungs)) usage('rungs 必须是数组')

const url = buildShareUrl(program, site)

const name = typeof program.name === 'string' && program.name.trim() ? program.name.trim() : basename(input, '.json')
const rungs = program.rungs.filter((rung) => Array.isArray(rung?.nodes) && rung.nodes.length > 0).length

if (out) {
  writeFileSync(resolve(out), `${url}\n`, 'utf8')
  console.error(`已写入 ${out}`)
}

console.log(url)
console.error(`${name}：${rungs} 段梯形图，链接 ${url.length} 字符`)
if (url.length > SOFT_LIMIT) {
  console.error('警告：链接超过 12000 字符，微信/QQ 可能发不出去，建议改用文件导入。')
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
