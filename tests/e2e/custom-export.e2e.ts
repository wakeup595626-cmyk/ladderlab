import { expect, test } from '@playwright/test'
import { openHome, downloadExport, exportButton } from './support'
import {
  auditSvg,
  authorCustomProgram,
  builtInLeaks,
  createBlankProject,
  CUSTOM_PROGRAM,
  missingTexts,
} from './custom-export.spec'

/** 导出菜单固定 8 项：工程文件、分享链接、三种 SVG、三种 PNG。 */
const EXPORT_MENU_ITEMS = [
  '工程文件（.json）',
  '复制分享链接',
  '完整程序 SVG',
  '纯梯形图 SVG',
  '顺序功能图 SVG',
  '完整程序 PNG',
  '纯梯形图 PNG',
  '顺序功能图 PNG',
]

type ExportKind = 'complete' | 'plain' | 'sfc'

interface ExportCase {
  kind: ExportKind
  item: string
  /** 图上必须读到的文字（本工程独有）。 */
  expected: string[]
  /** 按 <text> 整段精确匹配（SFC 的步骤号是单个数字，不能用子串判断）。 */
  exact?: boolean
}

const CUSTOM_TAGS = ['StartCycle', 'Step1', 'Step2', 'Step3', 'SkipRequest', 'ConveyorRun', 'AlarmLamp']

async function parseSvgXml(page: import('@playwright/test').Page, xml: string) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    const error = doc.querySelector('parsererror')?.textContent ?? ''
    const root = doc.documentElement
    return {
      error,
      rootName: root.nodeName,
      rootChildren: root.childElementCount,
      hasTitle: doc.querySelector('title') !== null,
    }
  }, xml)
}

test.describe('自定义工程导出验收', () => {
  test('越级跳步工程：三种 SVG 都是单根纯矢量，只含本工程的步骤与变量', async ({ page }) => {
    test.setTimeout(240_000)
    page.setDefaultTimeout(10_000)
    await openHome(page)
    await createBlankProject(page)
    await authorCustomProgram(page)

    await expect(page.locator('#project-name')).toHaveValue(CUSTOM_PROGRAM.name)
    await expect(page.locator('.ll-rung:not(.is-placeholder)')).toHaveCount(
      CUSTOM_PROGRAM.rungs.length,
    )

    const cases: ExportCase[] = [
      { kind: 'complete', item: '完整程序 SVG', expected: [...CUSTOM_TAGS] },
      { kind: 'plain', item: '纯梯形图 SVG', expected: [...CUSTOM_TAGS] },
      {
        kind: 'sfc',
        item: '顺序功能图 SVG',
        // 顺序功能图只写步骤号与动作/转移条件，不写「第 N 步」字样；
        // M0.0 = StartCycle、M3.0 = SkipRequest 是本工程的两条转移信号。
        expected: ['0', '1', '2', '3', 'ConveyorRun', 'M5.0=1', 'AlarmLamp', 'M6.0=1', 'M0.0', 'M3.0'],
        exact: true,
      },
    ]

    const evidence: string[] = []
    for (const spec of cases) {
      const file = await downloadExport(page, spec.item)
      const text = file.bytes.toString('utf8')
      if (text.length === 0) throw new Error(`${spec.item} 下载内容为空`)

      const audit = auditSvg(text)
      expect(`${spec.item}: ${audit.issues.join('；')}`).toBe(`${spec.item}: `)

      console.log(
        `--- ${spec.item} 文本(${audit.textCount}): ` + audit.texts.join(' | '),
      )

      const parsed = await parseSvgXml(page, text)
      if (parsed.error) throw new Error(`${spec.item} 不是合法 XML：${parsed.error.slice(0, 200)}`)
      expect(parsed.rootName).toBe('svg')
      expect(parsed.rootChildren).toBeGreaterThan(0)

      // 单根 + 数字尺寸 + viewBox 与宽高一致。
      expect(audit.rootTag).toContain('xmlns="http://www.w3.org/2000/svg"')
      const width = Number(audit.width)
      const height = Number(audit.height)
      expect(width).toBeGreaterThan(0)
      expect(height).toBeGreaterThan(0)
      expect(audit.viewBox).toBe(`0 0 ${Math.ceil(width)} ${Math.ceil(height)}`)

      const missing = spec.exact
        ? spec.expected.filter((item) => !audit.texts.includes(item))
        : missingTexts(audit, spec.expected)
      expect(`${spec.item} 缺文字: ${missing.join('、')}`).toBe(`${spec.item} 缺文字: `)

      const leaks = builtInLeaks(audit)
      expect(`${spec.item} 出现内置实验文字: ${leaks.join('、')}`).toBe(
        `${spec.item} 出现内置实验文字: `,
      )

      // 三种导出共用同一份根节点契约：不带 role，也不带根级 <title>，
      // 保证同一份图在浏览器、Word、Illustrator 里的语义一致。
      expect(audit.rootRole).toBe('')
      expect(audit.rootTitle).toBe('')
      expect(parsed.hasTitle).toBe(false)
      expect(text).not.toContain('role=')
      expect(text).not.toContain('<title')

      evidence.push(
        [
          spec.item,
          `${audit.bytes} B`,
          `${audit.width}×${audit.height}`,
          `viewBox=${audit.viewBox}`,
          `rect=${audit.rectCount}`,
          `text=${audit.textCount}`,
          `文字: ${audit.texts.join(' / ')}`,
        ].join(' | '),
      )
    }

    console.log('--- 导出证据 ---\n' + evidence.join('\n'))
  })

  test('导出菜单：8 项齐全、键盘可开关、触屏每项不低于 44px', async ({ page, browser }) => {
    test.setTimeout(120_000)
    page.setDefaultTimeout(10_000)
    await openHome(page)
    await createBlankProject(page)

    const button = exportButton(page)
    await button.focus()
    await page.keyboard.press('Enter')

    const menu = page.getByRole('menu', { name: '导出' })
    await expect(menu).toBeVisible()
    const items = menu.getByRole('menuitem')
    await expect(items).toHaveCount(EXPORT_MENU_ITEMS.length)
    expect(await items.allInnerTexts()).toEqual(EXPORT_MENU_ITEMS)
    await expect(items.first()).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()
    await expect(button).toHaveAttribute('aria-expanded', 'false')

    // 粗指针环境：每个菜单项保留 44px 的手指点击高度。
    const touchContext = await browser.newContext({
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    })
    try {
      const touchPage = await touchContext.newPage()
      await openHome(touchPage)
      await createBlankProject(touchPage)
      expect(
        await touchPage.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
      ).toBe(true)

      await exportButton(touchPage).click()
      const touchMenu = touchPage.getByRole('menu', { name: '导出' })
      await expect(touchMenu).toBeVisible()
      const measure = () =>
        touchMenu.getByRole('menuitem').evaluateAll((nodes) =>
          nodes.map((node) => ({
            label: (node.textContent ?? '').trim(),
            height: node.getBoundingClientRect().height,
            offsetHeight: (node as HTMLElement).offsetHeight,
            minHeight: getComputedStyle(node).minHeight,
          })),
        )

      // 菜单带一段入场缩放动画，刚可见时实测矩形只有约 42.7px；
      // 等布局高度稳定后再量，才是用户真正能点到的高度。
      await expect
        .poll(async () => Math.min(...(await measure()).map((box) => box.height)), {
          timeout: 3_000,
        })
        .toBeGreaterThanOrEqual(44 - 0.5)

      const boxes = await measure()
      expect(boxes.map((box) => box.label)).toEqual(EXPORT_MENU_ITEMS)
      const tooSmall = boxes.filter((box) => box.height < 44 - 0.5)
      expect(tooSmall.map((box) => `${box.label}=${box.height}`).join('、')).toBe('')
      console.log(
        '--- 触屏菜单高度 ---\n'
          + boxes.map((box) => `${box.label}: ${box.height.toFixed(1)}px`).join('\n'),
      )
    } finally {
      await touchContext.close()
    }
  })
})

