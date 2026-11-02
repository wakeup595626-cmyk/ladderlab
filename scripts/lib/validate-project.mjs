#!/usr/bin/env node
/**
 * 用仓库里的真实源码校验一份 .ladderlab.json。
 *
 * 这里刻意不复制任何校验逻辑：通过 Vite 的 SSR 加载器直接跑 `src/lib/io.ts`
 * 和 `src/engine/compile.ts`，也就是网页导入时用的同一份代码。这样 CLI、测试
 * 和页面三边不会悄悄走偏——如果规则改了，CLI 立刻跟着改。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 只依赖纯格式模块，避免 CLI ↔ 校验器互相 import 形成顶层 await 死锁。
import { SOFT_LIMIT, buildShareUrl } from './share-format.mjs'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 常见错误 → 一句话改法。按顺序匹配，命中第一条就用。 */
const HINTS = [
  [/不是有效的 JSON|Unexpected (token|end)/i, 'JSON 不允许注释、尾逗号和中文引号；用编辑器格式化一次再核对括号。'],
  [/schema 必须是 1/, '顶层固定写 "schema": 1。'],
  [/profile 必须是/, '顶层 profile 只能是 "v14" 或 "v21"；TONR 只有 v21 支持。'],
  [/变量名不能为空|变量名“.*”不合法/, '变量名只能用字母、数字、下划线，且不能以数字开头。'],
  [/变量名“.*”重复/, '同一个变量名只能声明一次，改名或删掉多余的那条。'],
  [/地址重叠|地址.*重复/, '每个变量要有独占地址；位别名必须落在所属字节变量的同一个字节里。'],
  [/不存在的变量|变量“.*”不存在|未定义/, '触点、线圈里出现的名字必须先在 tags 里声明；定时器/计数器读 .Q，计数器当前值读 .CV。'],
  [/需要 BOOL|需要 INT|必须是 BOOL|必须是 INT/, '线圈和触点只能接 BOOL，比较触点/MOVE/算术指令的操作数只能是 INT。'],
  [/多处输出驱动|多个线圈/, '同一个变量只能由一个输出连续驱动；要交替通断就用 SET / RESET 配对。'],
  [/PT 必须|PT 是|预设时间/, 'PT 是毫秒，必须是 1～32767 的整数；超过 32 秒请级联两个定时器或用计数器。'],
  [/PV 必须|预设值 PV/, 'CTU 的 PV 必须是 1～32767 的整数。'],
  [/缺少实例名/, 'TON/TOF/TONR/CTU 的 tag 是实例名（如 T1、C1），不能留空，也不能和变量重名。'],
  [/实例名“.*”重复|与变量表重名/, '实例名全局唯一，且不能和 tags 里的变量同名。'],
  [/需要操作数变量或常量|整数常量/, 'MOVE 用 value 或 sourceTag；ADD/SUB/SHL/ROL 用 value 或 valueTag，常量范围 -32768～32767。'],
  [/PATTERN/, 'PATTERN 需要 INT 目标、BOOL 的 pulseTag、以及 0～255 的 pattern 灯字数组。'],
  [/节点|程序段|ID.*重复/, '每个 rung / node / output 的 id 在整个文件里必须唯一。'],
]

export function hintFor(message) {
  for (const [pattern, hint] of HINTS) {
    if (pattern.test(message)) return hint
  }
  return ''
}

let enginePromise = null
let engineServer = null

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      let createServer
      try {
        ;({ createServer } = await import('vite'))
      } catch (error) {
        const message = String(error?.message ?? error)
        if (/Cannot find package 'vite'|ERR_MODULE_NOT_FOUND/.test(message)) {
          throw new Error('找不到 vite：先在仓库根目录运行 npm install（Node 22.12 或更高版本），再重跑这条命令。')
        }
        throw error
      }
      const server = await createServer({
        root: REPO_ROOT,
        configFile: resolve(REPO_ROOT, 'vite.config.ts'),
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'silent',
      })
      engineServer = server
      const io = await server.ssrLoadModule('/src/lib/io.ts')
      const engine = await server.ssrLoadModule('/src/engine/compile.ts')
      return { io, engine }
    })()
  }
  return enginePromise
}

/** 关掉内部起的 Vite 实例；CLI 结束时调用，避免进程挂住。 */
export async function closeValidator() {
  const server = engineServer
  engineServer = null
  enginePromise = null
  if (server) await server.close()
}

function countContacts(nodes) {
  let total = 0
  for (const node of nodes) {
    if (node.type === 'contact') total += 1
    else for (const branch of node.branches ?? []) total += countContacts(branch)
  }
  return total
}

function rungTitle(program, rungId) {
  const index = program.rungs.findIndex((rung) => rung.id === rungId)
  if (index < 0) return ''
  const label = program.rungs[index].label || '未命名'
  return `第 ${index + 1} 段「${label}」`
}

function nodePath(nodes, targetId, prefix = '') {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    const here = `${prefix}第 ${index + 1} 个元件`
    if (node.id === targetId) return here
    if (node.type === 'parallel') {
      for (let branch = 0; branch < (node.branches?.length ?? 0); branch += 1) {
        const found = nodePath(node.branches[branch], targetId, `${here}的支路 ${branch + 1} 中`)
        if (found) return found
      }
    }
  }
  return null
}

function locate(program, problem) {
  if (!problem.rungId) return ''
  const title = rungTitle(program, problem.rungId)
  const rung = program.rungs.find((item) => item.id === problem.rungId)
  if (!rung) return title
  if (!problem.nodeId) return title
  if (rung.output?.id === problem.nodeId) {
    return `${title}的输出（${rung.output.kind}）`
  }
  const path = nodePath(rung.nodes ?? [], problem.nodeId)
  return path ? `${title}${path}` : title
}

function record(stage, problem, program) {
  const message = String(problem.message ?? problem)
  return {
    stage,
    severity: problem.severity === 'warning' ? 'warning' : 'error',
    message,
    where: program ? locate(program, problem) : '',
    hint: hintFor(message),
  }
}

function emptyResult(file, fatal) {
  return {
    file,
    ok: false,
    name: null,
    profile: null,
    rungs: 0,
    tags: 0,
    nodes: 0,
    errors: [record('导入', { message: fatal })],
    warnings: [],
    shareUrlLength: 0,
    shareUrl: '',
  }
}

/** 校验一段 JSON 文本；返回结构化结果，不抛异常。 */
export async function validateProgramText(text, options = {}) {
  const file = options.file ?? null
  const { io, engine } = await loadEngine()

  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > io.MAX_IMPORT_BYTES) {
    return emptyResult(file, `文件 ${(bytes / 1024 / 1024).toFixed(1)} MB 超过 ${io.MAX_IMPORT_BYTES / 1024 / 1024} MB 上限。`)
  }

  let program
  try {
    program = io.parseProgramText(text)
  } catch (error) {
    return emptyResult(file, error?.message ?? String(error))
  }

  const compiled = engine.compile(program)
  const errors = compiled.errors.map((problem) => record('编译', problem, program))
  const warnings = compiled.warnings.map((problem) => record('编译', problem, program))

  // 能导入 ≠ 能导出：这一步跑的是「导出前」的序列化守卫。
  try {
    io.serializeProgram(program)
  } catch (error) {
    errors.push(record('导出', { message: error?.message ?? String(error) }, program))
  }

  let shareUrl = ''
  try {
    shareUrl = buildShareUrl(program)
  } catch {
    shareUrl = ''
  }
  if (shareUrl.length > SOFT_LIMIT) {
    warnings.push(
      record(
        '分享链接',
        { message: `分享链接 ${shareUrl.length} 字符，超过 ${SOFT_LIMIT}，微信/QQ 可能发不出去，改用文件导入。` },
        program,
      ),
    )
  }

  return {
    file,
    ok: errors.length === 0,
    name: program.name,
    profile: program.profile,
    rungs: program.rungs.filter((rung) => (rung.nodes?.length ?? 0) > 0).length,
    tags: program.tags.length,
    nodes: countContacts(program.rungs.flatMap((rung) => rung.nodes ?? [])),
    errors,
    warnings,
    shareUrlLength: shareUrl.length,
    shareUrl,
  }
}

/** 校验一个文件；读不到文件时也返回结构化的失败结果。 */
export async function validateProgramFile(filePath) {
  const absolute = resolve(filePath)
  let text
  try {
    text = readFileSync(absolute, 'utf8')
  } catch (error) {
    return emptyResult(absolute, `读不到文件：${error?.message ?? error}`)
  }
  return validateProgramText(text.replace(/^\uFEFF/, ''), { file: absolute })
}

/** 展开命令行参数：目录 → 里面的全部 .ladderlab.json；缺省用 examples/。 */
export function expandInputPaths(inputs) {
  const roots = inputs.length > 0 ? inputs : [join(REPO_ROOT, 'examples')]
  const files = []
  for (const item of roots) {
    const absolute = resolve(item)
    let stat
    try {
      stat = statSync(absolute)
    } catch {
      files.push(absolute)
      continue
    }
    if (!stat.isDirectory()) {
      files.push(absolute)
      continue
    }
    for (const entry of readdirSync(absolute).sort()) {
      if (entry.endsWith('.ladderlab.json')) files.push(join(absolute, entry))
    }
  }
  return files
}
