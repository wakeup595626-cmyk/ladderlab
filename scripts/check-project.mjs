#!/usr/bin/env node
/**
 * 交付前自检：把一份（或多份）工程按「网页导入 → 编译 → 导出 → 分享链接」
 * 的完整链路跑一遍，零错误才算通过。
 *
 *   node scripts/check-project.mjs examples/running-light.ladderlab.json
 *   node scripts/check-project.mjs examples            # 整个目录
 *   node scripts/check-project.mjs                    # 默认就是 examples/
 *   node scripts/check-project.mjs 我的电梯.ladderlab.json --json
 *
 * 退出码：0 = 全部通过，1 = 有错误（AI 可以直接用退出码判断）。
 */
import { isAbsolute, relative } from 'node:path'

import { closeValidator, expandInputPaths, validateProgramFile } from './lib/validate-project.mjs'

function usage(message) {
  if (message) console.error(`错误：${message}`)
  console.error('用法：node scripts/check-project.mjs [工程.json | 目录 ...] [--json] [--url]')
  console.error('')
  console.error('  --json   输出机器可读的 JSON（给 Agent 解析用）')
  console.error('  --url    通过时顺带打印分享链接')
  console.error('  不给路径时默认检查 examples/ 目录')
  process.exit(1)
}

function pretty(file) {
  if (!file) return '(未知文件)'
  const path = isAbsolute(file) ? relative(process.cwd(), file) : file
  return path.startsWith('..') ? file : path
}

function printResult(result) {
  const stats = result.name
    ? `${result.name} · ${result.profile} · ${result.rungs} 段 · ${result.tags} 个变量 · ${result.nodes} 个元件`
    : ''

  console.log(`${result.ok ? '✔' : '✘'} ${pretty(result.file)}`)
  if (stats) console.log(`  ${stats}`)
  if (result.ok && result.shareUrlLength > 0) {
    const flag = result.shareUrlLength > 12000 ? '（偏长，建议改发文件）' : ''
    console.log(`  分享链接 ${result.shareUrlLength} 字符${flag}`)
  }

  for (const item of result.errors) {
    console.log(`  [${item.stage}] ${item.message}`)
    if (item.where) console.log(`         位置：${item.where}`)
    if (item.hint) console.log(`         改法：${item.hint}`)
  }
  for (const item of result.warnings) {
    console.log(`  提示 [${item.stage}] ${item.message}`)
    if (item.where) console.log(`         位置：${item.where}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const inputs = []
  let asJson = false
  let withUrl = false

  for (const arg of args) {
    if (arg === '--json') asJson = true
    else if (arg === '--url') withUrl = true
    else if (arg === '-h' || arg === '--help') usage()
    else if (arg.startsWith('--')) usage(`不认识的参数 ${arg}`)
    else inputs.push(arg)
  }

  const files = expandInputPaths(inputs)
  if (files.length === 0) {
    if (asJson) console.log(JSON.stringify({ ok: false, files: [], error: '没有找到任何 .ladderlab.json' }))
    else console.error('没有找到任何 .ladderlab.json')
    process.exitCode = 1
    return
  }

  const results = []
  for (const file of files) {
    results.push(await validateProgramFile(file))
  }

  const failed = results.filter((result) => !result.ok)

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: failed.length === 0,
          total: results.length,
          passed: results.length - failed.length,
          failed: failed.length,
          files: results,
        },
        null,
        2,
      ),
    )
  } else {
    for (const [index, result] of results.entries()) {
      if (index > 0) console.log('')
      printResult(result)
      if (result.ok && withUrl && result.shareUrl) console.log(`\n${result.shareUrl}`)
    }
    console.log('')
    console.log(`汇总：${results.length} 个文件，${results.length - failed.length} 个通过，${failed.length} 个失败`)
  }

  if (failed.length > 0) process.exitCode = 1
}

try {
  await main()
} catch (error) {
  console.error(`校验器启动失败：${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  await closeValidator()
}
