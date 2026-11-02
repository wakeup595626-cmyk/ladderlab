#!/usr/bin/env node
/**
 * 把一份 .ladderlab.json 工程压成可以直接点开的分享链接。
 *
 *   node scripts/share-link.mjs examples/running-light.ladderlab.json
 *   node scripts/share-link.mjs examples/电梯.ladderlab.json --out 链接.txt
 *
 * 输出形如 https://wakeup595626-cmyk.github.io/ladderlab/#p=1.<base64url>
 * 页面打开后会弹窗询问是否导入，确认后才写入，不会覆盖未保存的草稿。
 *
 * 默认先调用 scripts/lib/validate-project.mjs 走一遍网页导入用的真实解析器和
 * 编译器，避免把一条「打得开、导不进」的链接交出去。确需跳过时加 --no-check。
 *
 * 链接的字节格式在 scripts/lib/share-format.mjs，这里只负责命令行和校验。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildShareUrl, DEFAULT_SITE, SOFT_LIMIT } from './lib/share-format.mjs'

// 契约测试从本文件导入，保持这两个入口不变。
export { buildShareHash, buildShareUrl, DEFAULT_SITE, SOFT_LIMIT } from './lib/share-format.mjs'

function usage(message) {
  if (message) console.error(`错误：${message}`)
  console.error('用法：node scripts/share-link.mjs <工程.json> [--site <站点地址>] [--out <输出文件>] [--no-check]')
  console.error('')
  console.error('默认先用 src/ 里的真实解析器和编译器校验一遍；')
  console.error('加 --no-check 可以跳过（只建议在调试校验器本身时用）。')
  process.exit(1)
}

function parseArgs(argv) {
  const options = {
    input: '',
    site: process.env.LADDERLAB_SITE || DEFAULT_SITE,
    out: '',
    check: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--site') {
      options.site = argv[++index] ?? usage('--site 后面要跟地址')
    } else if (arg === '--out') {
      options.out = argv[++index] ?? usage('--out 后面要跟文件名')
    } else if (arg === '--no-check') {
      options.check = false
    } else if (arg === '-h' || arg === '--help') {
      usage()
    } else if (arg.startsWith('--')) {
      usage(`不认识的参数 ${arg}`)
    } else if (!options.input) {
      options.input = arg
    } else {
      usage('一次只能处理一个工程文件')
    }
  }

  if (!options.input) usage('缺少工程文件')
  return options
}

/** 没有加载校验器时只做最粗的字段检查，够挡住完全跑偏的文件。 */
function coarseCheck(program, label) {
  if (!program || typeof program !== 'object' || Array.isArray(program)) usage(`${label} 的工程根节点必须是对象`)
  if (program.schema !== 1) usage(`${label} 的 schema 必须是 1`)
  if (program.profile !== 'v14' && program.profile !== 'v21') usage(`${label} 的 profile 必须是 v14 或 v21`)
  if (!Array.isArray(program.tags)) usage(`${label} 的 tags 必须是数组`)
  if (!Array.isArray(program.rungs)) usage(`${label} 的 rungs 必须是数组`)
}

/**
 * 跑校验并打印结果。
 * @returns {Promise<boolean>} 校验是否通过
 */
async function verify(text, file) {
  const { validateProgramText } = await import('./lib/validate-project.mjs')
  const result = await validateProgramText(text, { file })

  if (!result.ok) {
    console.error(`✘ ${basename(file)} 没有通过校验，先修好再生成链接：`)
    for (const item of result.errors) {
      const where = item.where ? `（${item.where}）` : ''
      console.error(`  - [${item.stage}] ${item.message}${where}`)
      if (item.hint) console.error(`    改法：${item.hint}`)
    }
    console.error('更详细的列表：node scripts/check-project.mjs ' + file)
    console.error('只想先看链接、稍后再修？加 --no-check 跳过校验（不建议交付）。')
    return false
  }

  for (const item of result.warnings) console.error(`提示：${item.message}`)
  console.error(`校验通过：${result.rungs} 段 · ${result.tags} 个变量 · ${result.nodes} 个元件`)
  return true
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const absolute = resolve(options.input)

  let text
  try {
    text = readFileSync(absolute, 'utf8').replace(/^\uFEFF/, '')
  } catch (reason) {
    usage(`读不到 ${options.input}：${reason.message}`)
  }

  let program
  try {
    program = JSON.parse(text)
  } catch (reason) {
    usage(`${basename(options.input)} 不是有效的 JSON：${reason.message}`)
  }

  let validatorLoaded = false
  if (options.check) {
    validatorLoaded = true
    if (!(await verify(text, absolute))) {
      process.exitCode = 1
      return validatorLoaded
    }
  } else {
    coarseCheck(program, basename(options.input))
    console.error('提示：已跳过校验（--no-check），链接里的工程不保证能导入。')
  }

  const url = buildShareUrl(program, options.site)
  const name = typeof program.name === 'string' && program.name.trim()
    ? program.name.trim()
    : basename(options.input, '.json')
  const rungs = program.rungs.filter((rung) => Array.isArray(rung?.nodes) && rung.nodes.length > 0).length

  if (options.out) {
    writeFileSync(resolve(options.out), `${url}\n`, 'utf8')
    console.error(`已写入 ${options.out}`)
  }

  console.log(url)
  console.error(`${name}：${rungs} 段梯形图，链接 ${url.length} 字符`)
  if (url.length > SOFT_LIMIT) {
    console.error('警告：链接超过 12000 字符，微信/QQ 可能发不出去，建议改用文件导入。')
  }
  return validatorLoaded
}

async function run() {
  let validatorLoaded = false
  try {
    validatorLoaded = await main()
  } catch (error) {
    console.error(`生成分享链接失败：${error?.message ?? error}`)
    process.exitCode = 1
  } finally {
    // 校验器内部会起一个 Vite SSR 实例，不关掉进程会一直挂着。
    if (validatorLoaded) {
      const { closeValidator } = await import('./lib/validate-project.mjs')
      await closeValidator()
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run()
