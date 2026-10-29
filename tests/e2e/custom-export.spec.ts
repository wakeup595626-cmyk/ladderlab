/**
 * 自定义工程导出验收：真实浏览器场景 + 可复用的 SVG 白盒断言。
 *
 * 本文件被 tests/e2e/custom-export.e2e.ts 引用（由 Playwright 注册执行），
 * 同时自带一个 Vitest 单元测试，避免 `*.spec.ts` 在 `npm test` 里因为没有用例
 * 而报 “No test suite found”。所有场景函数只接收 Page，不注册任何测试。
 */
import { test as vitestTest } from 'vitest'
import type { Page } from '@playwright/test'

export interface RungSpec {
  title: string
  /** 主线路上的常开触点，按从左到右的顺序。 */
  contacts: string[]
  output: { kind: 'COIL' | 'SET' | 'RESET'; tag: string }
}

/**
 * 自定义工程：第 1 步既能正常移交第 2 步，也能在 SkipRequest 下越级跳到第 3 步。
 * 三个 StepN 变量会被顺序功能图识别成步骤位（Step1/Step2/Step3），
 * 因此这张 SFC 只能由本工程现算，内置实验的固定模板里没有这些名字。
 * 后两步各自复位第 1 步，构成真实的单令牌交接；只置位不复位的工程会
 * 故意降级成「组合逻辑」单步图（见 src/engine/sfc.custom.test.ts），
 * 这里不拿它冒充顺序步链。
 */
export const CUSTOM_PROGRAM = {
  name: '越级跳步验收工程',
  rungs: [
    { title: '启动进入第一步', contacts: ['StartCycle'], output: { kind: 'SET', tag: 'Step1' } },
    { title: '第一步移交第二步', contacts: ['Step1'], output: { kind: 'SET', tag: 'Step2' } },
    { title: '跳过第二步', contacts: ['Step1', 'SkipRequest'], output: { kind: 'SET', tag: 'Step3' } },
    { title: '第二步结束复位第一步', contacts: ['Step2'], output: { kind: 'RESET', tag: 'Step1' } },
    { title: '第三步结束复位第一步', contacts: ['Step3'], output: { kind: 'RESET', tag: 'Step1' } },
    { title: '第二步驱动输送带', contacts: ['Step2'], output: { kind: 'COIL', tag: 'ConveyorRun' } },
    { title: '第三步点亮报警灯', contacts: ['Step3'], output: { kind: 'COIL', tag: 'AlarmLamp' } },
  ] satisfies RungSpec[],
}

/** 六个内置实验的招牌文字：自定义工程的任何一张导出图里都不该出现。 */
export const BUILT_IN_LAB_TEXTS = [
  '四路抢答器',
  '定时器与计数器',
  '十字路口交通灯',
  '三层电梯',
  '音乐喷泉',
  '装配流水线',
]

export interface SvgAudit {
  bytes: number
  rootTag: string
  /** 根节点上的 role；三种导出都必须为空。 */
  rootRole: string
  /** 根节点后紧跟的 <title> 文本；三种导出都必须为空。 */
  rootTitle: string
  width: string
  height: string
  viewBox: string
  rectCount: number
  textCount: number
  texts: string[]
  issues: string[]
}

function attribute(tag: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
}

/**
 * 白盒审查一份导出的 SVG：单一根节点、纯矢量、无交互/无障碍残留、白底。
 * 返回结构化结果，由调用方决定哪些项目必须成立。
 */
export function auditSvg(text: string): SvgAudit {
  const issues: string[] = []
  const bytes = new TextEncoder().encode(text).length
  const rootTag = /<svg\b[^>]*>/.exec(text)?.[0] ?? ''
  const rootCount = (text.match(/<svg\b/g) ?? []).length
  if (!text.startsWith('<?xml')) issues.push('缺少 <?xml 声明')
  if (rootCount !== 1) issues.push(`根节点 <svg> 出现 ${rootCount} 次（应只有 1 个）`)
  if (!rootTag.includes('xmlns="http://www.w3.org/2000/svg"')) issues.push('根节点缺少 xmlns')
  if (!/<\/svg>\s*$/.test(text)) issues.push('文件末尾没有闭合的 </svg>')
  if (text.includes('<foreignObject')) issues.push('含 <foreignObject>，不是纯矢量')
  if (text.includes('<image')) issues.push('含 <image> 位图引用')
  if (text.includes('data:image/')) issues.push('内嵌了 data:image 位图')
  if (!/fill="#ffffff"/i.test(text)) issues.push('找不到白色底 fill="#ffffff"')

  const rootRole = attribute(rootTag, 'role')
  const bodyAfterRoot = rootTag ? text.slice(text.indexOf(rootTag) + rootTag.length) : text
  const rootTitleMatch = /^\s*<title\b[^>]*>([\s\S]*?)<\/title>/.exec(bodyAfterRoot)
  const rootTitle = rootTitleMatch ? rootTitleMatch[1].replace(/<[^>]+>/g, '').trim() : ''

  // 三种导出共用同一份根节点契约（与顺序功能图一致）：只声明画布尺寸，
  // 不带 role，也不带根级 <title>。
  if (rootRole) issues.push(`根节点不应带 role，实际是 ${rootRole}`)
  if (rootTitleMatch) issues.push('根节点不应带根级 <title>')

  // 根级 <title> 已经单独报过，子树检查只负责残留的嵌套 <title>。
  let subtree = rootTag ? text.replace(rootTag, '') : text
  if (rootTitleMatch) subtree = subtree.replace(rootTitleMatch[0], '')

  if (/\sclass="/.test(subtree)) issues.push('残留 class 属性')
  if (/\saria-[a-z]+="/.test(subtree)) issues.push('残留 aria-* 属性')
  if (/\sdata-[a-z-]+="/.test(subtree)) issues.push('残留 data-* 属性')
  if (/\stabindex="/.test(subtree)) issues.push('残留 tabindex 属性')
  if (/\srole="/.test(subtree)) issues.push('残留 role 属性')
  if (subtree.includes('<title')) issues.push('残留 <title> 元素')

  const texts = Array.from(text.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g))
    .map((match) => match[1].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)

  return {
    bytes,
    rootTag,
    rootRole,
    rootTitle,
    width: attribute(rootTag, 'width'),
    height: attribute(rootTag, 'height'),
    viewBox: attribute(rootTag, 'viewBox'),
    rectCount: (text.match(/<rect\b/g) ?? []).length,
    textCount: texts.length,
    texts,
    issues,
  }
}

/** 图上必须能读到这些文字（完整程序 / 纯梯形图 / 顺序功能图各自的证据集）。 */
export function missingTexts(audit: SvgAudit, expected: string[]): string[] {
  const mesh = audit.texts.join('\n')
  return expected.filter((item) => !mesh.includes(item))
}

/** 图上不许出现内置实验的招牌文字。 */
export function builtInLeaks(audit: SvgAudit): string[] {
  const mesh = audit.texts.join('\n')
  return BUILT_IN_LAB_TEXTS.filter((item) => mesh.includes(item))
}

/** 通过顶栏把工程改名（新建后是「未命名项目」）。 */
export async function renameProject(page: Page, name: string): Promise<void> {
  const input = page.locator('#project-name')
  await input.waitFor({ state: 'visible' })
  await input.fill(name)
  await input.press('Enter')
}

/** 从首页新建一个空白工程：主线改成先在对话框里命名，再直接建出来。 */
export async function createBlankProject(page: Page, name = '未命名工程'): Promise<void> {
  await page.getByRole('button', { name: '新建空白工程' }).click()
  const dialog = page.getByRole('dialog', { name: '新建工程' })
  await dialog.waitFor({ state: 'visible' })
  await dialog.locator('#new-project-name').fill(name)
  await dialog.getByRole('button', { name: '新建', exact: true }).click()
  await page.locator('#project-name').waitFor({ state: 'visible' })
}

/**
 * 当前正在编辑的程序段。第 1 个元件插进末尾的占位段；编辑器随后会自动追加
 * 一个新的占位段，因此同一段里的后续元件要回到最后一个已激活的程序段。
 */
function currentRung(page: Page, index: number) {
  return index === 0
    ? page.locator('.ll-rung.is-placeholder').last()
    : page.locator('.ll-rung:not(.is-placeholder)').last()
}

/** 最后一个已经有内容的程序段。 */
function lastRung(page: Page) {
  return page.locator('.ll-rung:not(.is-placeholder)').last()
}

/**
 * 参数编辑浮层只在焦点落在它内部时响应 Esc；输入框回车提交后焦点已经回落到
 * body，所以这里统一用浮层自带的关闭按钮收起，避免浮层盖住画布上的插入点。
 */
async function closePanel(page: Page): Promise<void> {
  const panel = page.locator('.qe-panel')
  if (await panel.count()) {
    await panel.getByRole('button', { name: '关闭参数编辑' }).click()
    await panel.waitFor({ state: 'detached' })
  }
}

/**
 * 画布容器是 scroll-behavior: smooth，聚焦靠后的程序段会触发惯性滚动；
 * 插入菜单监听 scroll 并立即关闭，所以必须等视口停稳再开菜单。
 */
async function settleScroll(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const pane = document.querySelector('.program-pane')
        const read = () => (pane ? pane.scrollTop : window.scrollY)
        let last = read()
        let stable = 0
        const tick = () => {
          const now = read()
          if (now === last) stable += 1
          else {
            stable = 0
            last = now
          }
          if (stable >= 3) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
}

/** 在占位程序段的第 index+1 个插入点插入一个常开触点并写入变量名。 */
async function insertContact(page: Page, index: number, tag: string): Promise<void> {
  const plus = currentRung(page, index).getByRole('button', {
    name: new RegExp(`第 ${index + 1} 个插入点`),
  })
  // 空白段的 44px 导线命中区会盖住唯一的插入点，鼠标点击会被拦截；
  // 插入点自身支持 Enter/Space 激活，因此走键盘路径。
  await plus.focus()
  await settleScroll(page)
  await plus.press('Enter')
  const menu = page.getByRole('menu', { name: /插入菜单/ })
  await menu.waitFor({ state: 'visible' })
  await menu.getByRole('menuitem', { name: '常开触点' }).click()

  const operand = page.locator('.qe-panel').getByLabel('操作数')
  await operand.waitFor({ state: 'visible' })
  await operand.fill(tag)
  await operand.press('Enter')
  await closePanel(page)
}

/** 点选刚画好的那个程序段的输出，改成置位/线圈并写入变量名。 */
async function setOutput(page: Page, spec: RungSpec['output']): Promise<void> {
  await lastRung(page).locator('[data-output-id]').click()
  const panel = page.locator('.qe-panel')
  await panel.getByLabel('指令类型').selectOption({
    label: spec.kind === 'SET' ? '置位线圈' : spec.kind === 'RESET' ? '复位线圈' : '线圈',
  })
  const target = panel.getByLabel('输出变量')
  await target.fill(spec.tag)
  await target.press('Enter')
  await closePanel(page)
}

/** 写程序段标题（标题输入框失焦即提交）。 */
async function setRungTitle(page: Page, title: string): Promise<void> {
  const input = lastRung(page).locator('.ll-rung-name')
  await input.fill(title)
  await input.press('Enter')
}

/** 完全用画布 UI 拼出 CUSTOM_PROGRAM，返回每一步的说明用于失败时定位。 */
export async function authorCustomProgram(page: Page): Promise<void> {
  await renameProject(page, CUSTOM_PROGRAM.name)
  for (const spec of CUSTOM_PROGRAM.rungs) {
    for (let index = 0; index < spec.contacts.length; index += 1) {
      await insertContact(page, index, spec.contacts[index])
    }
    await setOutput(page, spec.output)
    await setRungTitle(page, spec.title)
  }
}

if (process.env.VITEST) {
  vitestTest('auditSvg 能抓出位图、交互残留与缺白底', () => {
    const good = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">',
      '<rect x="0" y="0" width="10" height="10" fill="#ffffff"/>',
      '<text x="1" y="5">Step1</text>',
      '</svg>',
    ].join('')
    const clean = auditSvg(good)
    if (clean.issues.length !== 0) throw new Error(`干净样本被误判: ${clean.issues.join('; ')}`)
    if (clean.texts.join('') !== 'Step1') throw new Error('没有正确提取 <text> 文字')
    if (clean.viewBox !== '0 0 10 10') throw new Error('没有读出 viewBox')

    const dirty = good
      .replace('fill="#ffffff"', 'fill="url(#p)"')
      .replace('<text x="1" y="5">', '<image href="data:image/png;base64,AA"/><text class="a" aria-hidden="true" x="1" y="5">')
    const problems = auditSvg(dirty).issues.join('|')
    for (const expected of ['<image>', 'data:image', 'class', 'aria-', '白色底']) {
      if (!problems.includes(expected)) throw new Error(`漏报 ${expected}: ${problems}`)
    }

    if (missingTexts(clean, ['Step1']).length !== 0) throw new Error('missingTexts 误报')
    if (missingTexts(clean, ['Step9'])[0] !== 'Step9') throw new Error('missingTexts 漏报')
    if (builtInLeaks(clean).length !== 0) throw new Error('builtInLeaks 误报')

    // 三种导出共用同一份根节点契约：role 与根级 <title> 都必须被拒绝。
    const labeled = good
      .replace('<svg xmlns', '<svg role="img" xmlns')
      .replace('<rect x="0"', '<title>越级跳步验收工程</title><rect x="0"')
    const rejected = auditSvg(labeled)
    if (!rejected.issues.includes('根节点不应带 role，实际是 img')) {
      throw new Error(`没有拒绝根节点 role: ${rejected.issues.join('; ')}`)
    }
    if (!rejected.issues.includes('根节点不应带根级 <title>')) {
      throw new Error(`没有拒绝根级 <title>: ${rejected.issues.join('; ')}`)
    }
    if (rejected.rootRole !== 'img') throw new Error('没读出根节点 role')
    if (rejected.rootTitle !== '越级跳步验收工程') throw new Error('没读出根级 <title>')
    if (rejected.issues.length !== 2) {
      throw new Error(`根级标注应只报 2 条 issue: ${rejected.issues.join('; ')}`)
    }
    const nestedTitle = labeled.replace('<text', '<g><title>x</title></g><text')
    if (!auditSvg(nestedTitle).issues.includes('残留 <title> 元素')) {
      throw new Error('子树里的 <title> 被放过')
    }
  })
}
