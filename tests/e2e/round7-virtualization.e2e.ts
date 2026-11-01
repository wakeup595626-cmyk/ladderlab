import { expect, test, type Page } from '@playwright/test'
import { openHome, trackPageErrors } from './support'

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

function poweredProgram(rungCount: number, name: string) {
  return {
    schema: 1,
    name,
    profile: 'v21',
    tags: [
      {
        id: 'tag-start',
        name: 'Start',
        address: '%I0.0',
        kind: 'BOOL',
        initial: true,
        comment: '启动位',
      },
      {
        id: 'tag-motor',
        name: 'Motor',
        address: '%Q0.0',
        kind: 'BOOL',
        initial: false,
        comment: '输出线圈',
      },
    ],
    rungs: Array.from({ length: rungCount }, (_, index) => ({
      id: `rung-${index + 1}`,
      label: `第 ${index + 1} 段`,
      nodes: [{
        type: 'contact',
        id: `contact-${index + 1}`,
        kind: 'NO',
        tag: 'Start',
      }],
      output: {
        id: `output-${index + 1}`,
        kind: 'COIL',
        tag: 'Motor',
      },
    })),
  }
}

test('1000 段工程只挂载视口附近并保持跳段、焦点和滚动高度稳定', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = trackPageErrors(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openHome(page)
  const program = poweredProgram(1000, '千段窗口化检查')
  program.rungs[799].nodes = [
    { type: 'contact', id: 'contact-800', kind: 'NO', tag: 'Start' },
    { type: 'contact', id: 'contact-800b', kind: 'NO', tag: 'Start' },
    { type: 'contact', id: 'contact-800c', kind: 'NO', tag: 'Start' },
  ]
  await importProgram(page, program)
  await expect(page.locator('#project-name')).toHaveValue('千段窗口化检查')

  const pane = page.locator('.wb-program-pane')
  const sheet = page.locator('.ll-program-sheet')
  await expect(sheet).toHaveAttribute('data-virtualized', 'true')
  // 导入器会为连续编辑保留一个尾部空段，因此源行数比可见段号多 1。
  await expect(sheet).toHaveAttribute('data-total-rungs', '1001')
  await expect.poll(() => page.locator('.ll-rung[data-rung-id]').count()).toBeLessThan(50)
  await expect.poll(() => page.locator('.ll-rung-spacer').count()).toBeGreaterThan(0)
  await expect.poll(() => sheet.evaluate((element) => element.childElementCount)).toBeLessThan(80)

  const initialGeometry = await pane.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
  }))
  expect(initialGeometry.scrollTop).toBeLessThanOrEqual(1)
  expect(initialGeometry.scrollHeight).toBeGreaterThan(100_000)

  // 直接滚进屏外占位块时，段号也必须按共享前缀偏移立即算对。
  const scrollIntoSpacer = (contentIndex: number) => page.evaluate((targetIndex) => {
    const pane = document.querySelector<HTMLElement>('.wb-program-pane')
    const spacers = Array.from(document.querySelectorAll<HTMLElement>('.ll-rung-spacer'))
    if (!pane) throw new Error('program pane missing')
    const spacer = spacers.find((element) => {
      const start = Number(element.dataset.rungSpacerStart)
      const end = Number(element.dataset.rungSpacerEnd)
      return targetIndex >= start && targetIndex < end
    })
    if (!spacer) throw new Error('spacer missing')
    const paneRect = pane.getBoundingClientRect()
    const spacerRect = spacer.getBoundingClientRect()
    const thresholdOffset = Math.min(72, pane.clientHeight * 0.18)
    const firstIndex = Number(spacer.dataset.rungSpacerStart)
    pane.scrollTop += spacerRect.top - paneRect.top
      + (targetIndex - firstIndex) * 176 - thresholdOffset
    return new Promise<string>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve(document.querySelector('.rung-nav-current')?.textContent ?? '')
      }))
    })
  }, contentIndex)
  const at400 = Number(await scrollIntoSpacer(400))
  expect(Math.abs(at400 - 400)).toBeLessThanOrEqual(4)
  const at750 = Number(await scrollIntoSpacer(750))
  expect(Math.abs(at750 - 750)).toBeLessThanOrEqual(4)

  await page.getByRole('button', { name: '按标题或变量名查找程序段' }).click()
  const search = page.getByRole('searchbox', { name: '按标题或变量名搜索程序段' })
  await search.fill('第 800 段')
  const result = page.locator('.rung-nav-results button').filter({ hasText: '第 800 段' }).first()
  await expect(result).toBeVisible()
  await result.click()

  const target = page.locator('.ll-rung[data-rung-id="rung-800"]')
  await expect(target).toBeVisible()
  await expect.poll(() => page.locator('.rung-nav-current').textContent()).toBe('800')
  await expect.poll(() => target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.top >= 0 && rect.top < window.innerHeight
  })).toBe(true)

  const jumpedGeometry = await pane.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
  }))
  expect(jumpedGeometry.scrollTop).toBeGreaterThan(100_000)
  expect(Math.abs(jumpedGeometry.scrollHeight - initialGeometry.scrollHeight))
    .toBeLessThan(initialGeometry.scrollHeight * 0.05)

  const focusState = () => page.evaluate(() => {
    const active = document.activeElement
    const element = active instanceof Element ? active : null
    const selectedNode = document.querySelector<HTMLElement>('.ll-node.is-selected[data-node-id]')
      ?.dataset.nodeId ?? null
    return {
      body: active === document.body,
      node: element?.closest<HTMLElement>('.ll-node[data-node-id]')?.dataset.nodeId ?? null,
      rung: element?.closest<HTMLElement>('.ll-rung[data-rung-id]')?.dataset.rungId ?? null,
      selectedNode,
      rungSelected: Boolean(document.querySelector('.ll-rung.is-selected[data-rung-id="rung-800"]')),
    }
  })

  // 第 800 段特意放三个触点：逐项删除时焦点不能掉回 body。
  for (const nodeId of ['contact-800c', 'contact-800b', 'contact-800']) {
    const contact = page.locator(`.ll-node[data-node-id="${nodeId}"]`)
    await expect(contact).toBeVisible()
    await contact.click()
    await page.keyboard.press('Escape')
    await contact.focus()
    await page.keyboard.press('Delete')
    await expect(contact).toHaveCount(0)
    await expect.poll(focusState).toMatchObject({ body: false, rung: 'rung-800' })
  }

  // 连续撤销：每一步都必须落在原来的段里，而不是页面根节点。
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('Control+z')
    await expect.poll(focusState).toMatchObject({ body: false, rung: 'rung-800' })
    const state = await focusState()
    if (state.node) expect(state.selectedNode).toBe(state.node)
  }
  await expect(page.locator('.ll-node[data-node-id^="contact-800"]')).toHaveCount(3)

  // 连续重做（第一次和后续都检查），最后再按 Delete 验证焦点仍可操作。
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(focusState).toMatchObject({ body: false, rung: 'rung-800' })
    const state = await focusState()
    if (state.node) expect(state.selectedNode).toBe(state.node)
  }
  await expect(page.locator('.ll-node[data-node-id^="contact-800"]')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect.poll(focusState).toMatchObject({ body: false, rung: 'rung-800' })
  await expect(page.locator('.ll-node[data-node-id="contact-800"]')).toHaveCount(1)
  await page.keyboard.press('Delete')
  await expect(page.locator('.ll-node[data-node-id="contact-800"]')).toHaveCount(0)
  await expect.poll(focusState).toMatchObject({ body: false, rung: 'rung-800' })

  // 虚拟窗口末端按 Tab 应进入下一条真实段，Shift+Tab 能原路返回。
  await target.evaluate((rung) => {
    const candidates = Array.from(rung.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !element.matches(':disabled')
      && !element.closest('[aria-hidden="true"], [inert]')
      && element.getClientRects().length > 0
    ))
    candidates.at(-1)?.focus()
  })
  await page.keyboard.press('Tab')
  await expect.poll(() => page.evaluate(() => (
    document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>('.ll-rung[data-rung-id]')?.dataset.rungId ?? null
      : null
  ))).toBe('rung-801')
  await expect.poll(() => page.locator('.rung-nav-current').textContent()).toBe('801')

  const nextRung = page.locator('.ll-rung[data-rung-id="rung-801"]')
  await nextRung.evaluate((rung) => {
    const candidates = Array.from(rung.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !element.matches(':disabled')
      && !element.closest('[aria-hidden="true"], [inert]')
      && element.getClientRects().length > 0
    ))
    candidates[0]?.focus()
  })
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => page.evaluate(() => (
    document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>('.ll-rung[data-rung-id]')?.dataset.rungId ?? null
      : null
  ))).toBe('rung-800')
  await expect.poll(() => page.locator('.rung-nav-current').textContent()).toBe('800')

  await page.locator('.rung-nav-step[data-step="next"]').click()
  await expect.poll(() => page.locator('.rung-nav-current').textContent()).toBe('801')
  const nextContact = page.locator('.ll-node[data-node-id="contact-801"]')
  await expect(nextContact).toBeVisible()
  await nextContact.click()
  await expect(page.locator('[data-inline-operand-editor="true"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await nextContact.focus()
  await page.keyboard.press('Delete')
  await expect(nextContact).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(nextContact).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement
    const focused = active instanceof Element
      ? active.closest<HTMLElement>('.ll-node[data-node-id]')?.dataset.nodeId ?? null
      : null
    const selected = document.querySelector<HTMLElement>('.ll-node.is-selected[data-node-id]')
      ?.dataset.nodeId ?? null
    return { focused, selected }
  })).toEqual({ focused: 'contact-801', selected: 'contact-801' })

  expect(errors, errors.join('\n')).toEqual([])
})
