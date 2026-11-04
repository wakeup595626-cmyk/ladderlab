import { expect, test, type Page } from '@playwright/test'
import { downloadExport, openHome } from './support'

/** 走「导入工程 → 粘贴 JSON」的真实路径，覆盖一键导入后立刻渲染的场景。 */
async function importProgram(page: Page, program: unknown): Promise<void> {
  await page.getByRole('button', { name: '导入工程文件', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导入工程' })
  await expect(dialog).toBeVisible()
  await dialog.getByText('没有文件？直接粘贴工程 JSON').click()
  await dialog.getByLabel('工程 JSON 内容').fill(JSON.stringify(program))
  await dialog.getByRole('button', { name: '检查内容' }).click()
  await dialog.getByRole('button', { name: '导入并打开' }).click()
  await expect(dialog).toBeHidden()
}

const terminalParallelProgram = {
  schema: 1,
  name: '链尾并联端子回归',
  profile: 'v21',
  tags: [
    { id: 'tag-start', name: 'Start', address: '%I0.0', kind: 'BOOL', initial: false, comment: '' },
    { id: 'tag-a', name: 'LampA', address: '%Q0.0', kind: 'BOOL', initial: false, comment: '' },
    { id: 'tag-b', name: 'LampB', address: '%Q0.1', kind: 'BOOL', initial: false, comment: '' },
    { id: 'tag-c', name: 'LampC', address: '%Q0.2', kind: 'BOOL', initial: false, comment: '' },
  ],
  rungs: [{
    id: 'rung-terminal',
    label: '链尾并联应各自收口',
    nodes: [{ type: 'contact', id: 'contact-start', kind: 'NO', tag: 'Start' }],
    output: { id: 'output-network', kind: 'NETWORK', tag: '' },
    network: [{
      type: 'parallel',
      id: 'parallel-terminal',
      branches: [
        [{ type: 'output', id: 'output-a', kind: 'SET', tag: 'LampA' }],
        [{ type: 'output', id: 'output-b', kind: 'SET', tag: 'LampB' }],
        [{ type: 'output', id: 'output-c', kind: 'SET', tag: 'LampC' }],
      ],
    }],
  }],
}

test('一键导入的链尾并联在画布和 SVG 中都保留独立端子', async ({ page }) => {
  test.setTimeout(90_000)
  await openHome(page)
  await importProgram(page, terminalParallelProgram)

  const rung = page.locator('.ll-rung[data-rung-id="rung-terminal"]')
  await expect(rung).toBeVisible()
  const network = rung.locator('.ll-network')
  const terminals = network.locator('.ll-branch-terminal')
  await expect(terminals).toHaveCount(3)

  const geometry = await network.evaluate((root) => {
    const caps = Array.from(root.querySelectorAll<SVGLineElement>('.ll-branch-terminal'))
      .map((line) => {
        const box = line.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      })
    const wires = Array.from(root.querySelectorAll<SVGPathElement>('path.ll-wire'))
      .map((path) => path.getBoundingClientRect())
    const capX = caps[0]?.x ?? Number.NaN
    return {
      capCount: caps.length,
      uniqueRows: new Set(caps.map((cap) => Math.round(cap.y))).size,
      alignedRight: caps.every((cap) => Math.abs(cap.x - capX) < 0.5),
      tallWireAtCaps: wires.some((wire) => (
        Math.abs(wire.right - capX) < 1.5 && wire.height > 30
      )),
    }
  })

  expect(geometry).toEqual({
    capCount: 3,
    uniqueRows: 3,
    alignedRight: true,
    tallWireAtCaps: false,
  })

  // 导出器克隆画布 SVG；从真实下载文件再确认一次，防止导出链路另画一套。
  // 导出时 class/data-* 会为静态图片清洗掉，因此按端子线的几何形状核对。
  const download = await downloadExport(page, '纯梯形图', 'svg')
  const svg = download.bytes.toString('utf8')
  const exportedTerminals = await page.evaluate((markup) => {
    const xml = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden'
    const root = document.importNode(xml.documentElement, true) as unknown as SVGSVGElement
    host.append(root)
    document.body.append(host)
    const caps = Array.from(root.querySelectorAll('line'))
      .map((line) => line.getBoundingClientRect())
      .filter((box) => box.height > 19 && box.height < 21 && box.width < 5)
      .map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }))
    host.remove()
    const capX = caps[0]?.x ?? Number.NaN
    return {
      count: caps.length,
      uniqueRows: new Set(caps.map((cap) => Math.round(cap.y))).size,
      alignedRight: caps.every((cap) => Math.abs(cap.x - capX) < 0.5),
    }
  }, svg)
  expect(exportedTerminals).toEqual({ count: 3, uniqueRows: 3, alignedRight: true })
})
