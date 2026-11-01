import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

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
        comment: '常闭启动位',
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

test('删除元件后焦点留在同一程序段，并可从新落点继续操作', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const nodes = page.locator('.ll-node[data-node-id]')
  const countBefore = await nodes.count()
  const first = nodes.first()
  const rungId = await first.locator('xpath=ancestor::article[contains(@class,"ll-rung")]')
    .getAttribute('data-rung-id')
  expect(rungId).toBeTruthy()

  await first.click()
  await first.focus()
  await page.keyboard.press('Delete')
  await expect(nodes).toHaveCount(countBefore - 1)

  await expect.poll(async () => page.evaluate((expectedRungId) => {
    const active = document.activeElement
    if (!(active instanceof Element)) return null
    const rung = active.closest<HTMLElement>('.ll-rung')
    return {
      rungId: rung?.dataset.rungId ?? null,
      isNode: active.matches('.ll-node[data-node-id]'),
      insideExpectedRung: rung?.dataset.rungId === expectedRungId,
    }
  }, rungId)).toMatchObject({
    rungId,
    isNode: true,
    insideExpectedRung: true,
  })

  // 从焦点接回的相邻元件继续按 Delete，不需要鼠标重新找回画布。
  // 这里不再 click：单击会按产品设计打开操作数编辑器，焦点会进入输入框。
  await page.keyboard.press('Delete')
  await expect(nodes).toHaveCount(countBefore - 2)
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)

  await page.keyboard.press('Control+z')
  await expect(nodes).toHaveCount(countBefore - 1)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)

  expect(errors, errors.join('\n')).toEqual([])
})

test('撤销删除后选中框、DOM 焦点和下一次 Delete 指向同一元件', async ({ page }) => {
  await openHome(page)
  await importProgram(page, {
    schema: 1,
    name: '撤销焦点一致性',
    profile: 'v21',
    tags: [{
      id: 'tag-start', name: 'Start', address: '%I0.0', kind: 'BOOL', initial: false, comment: '',
    }, {
      id: 'tag-output', name: 'Motor', address: '%Q0.0', kind: 'BOOL', initial: false, comment: '',
    }],
    rungs: [{
      id: 'focus-rung',
      label: '三个串联触点',
      nodes: ['a', 'b', 'c'].map((suffix) => ({
        type: 'contact', id: `contact-${suffix}`, kind: 'NO', tag: 'Start',
      })),
      output: { id: 'focus-output', kind: 'COIL', tag: 'Motor' },
    }],
  })

  const node = (suffix: string) => page.locator(`.ll-node[data-node-id="contact-${suffix}"]`)
  await node('a').click()
  await expect(page.locator('[data-inline-operand-editor="true"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await node('a').focus()
  await page.keyboard.press('Delete')
  await expect(node('a')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(node('a')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement
    const focused = active instanceof Element
      ? active.closest<HTMLElement>('.ll-node[data-node-id]')?.dataset.nodeId ?? null
      : null
    const selected = document.querySelector<HTMLElement>('.ll-node.is-selected[data-node-id]')
      ?.dataset.nodeId ?? null
    return { focused, selected }
  })).toEqual({ focused: 'contact-a', selected: 'contact-a' })

  // 再次 Delete 仍作用于用户看到的那个元件，而不是另一个“选中但未聚焦”的对象。
  await page.keyboard.press('Delete')
  await expect(node('a')).toHaveCount(0)
  await expect(node('b')).toHaveCount(1)
  await expect(node('c')).toHaveCount(1)
})

test('删空程序段后焦点回到段标题操作区，而不是页面 body', async ({ page }) => {
  await openHome(page)
  await importProgram(page, {
    schema: 1,
    name: '单触点焦点头',
    profile: 'v21',
    tags: [{
      id: 'tag-start',
      name: 'Start',
      address: '%I0.0',
      kind: 'BOOL',
      initial: false,
      comment: '',
    }],
    rungs: [{
      id: 'single-rung',
      label: '唯一触点',
      nodes: [{ type: 'contact', id: 'only-contact', kind: 'NO', tag: 'Start' }],
      output: { id: 'only-output', kind: 'COIL', tag: 'Start' },
    }],
  })

  const node = page.locator('.ll-node[data-node-id="only-contact"]')
  await node.click()
  const inlineEditor = page.locator('[data-inline-operand-editor="true"]')
  await expect(inlineEditor).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(inlineEditor).toBeHidden()
  await node.focus()
  await page.keyboard.press('Delete')
  await expect(node).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement
    return active instanceof Element
      ? Boolean(active.closest('.ll-rung[data-rung-id="single-rung"]'))
      : false
  })).toBe(true)
})

test('品牌免责声明在桌面和手机视口内完整可见', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await openHome(page)
    const disclaimer = page.locator('.wb-statusbar .status-disclaimer')
    await expect(disclaimer).toBeVisible()
    await expect(disclaimer).toHaveText('教学仿真器 · 非西门子官方产品 · 不兼容 S7 工程文件')

    const geometry = await disclaimer.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        display: style.display,
        overflowX: element.scrollWidth - element.clientWidth,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }
    })
    expect(geometry.display).not.toBe('none')
    expect(geometry.overflowX).toBeLessThanOrEqual(1)
    expect(geometry.left).toBeGreaterThanOrEqual(-1)
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.top).toBeGreaterThanOrEqual(-1)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
  }
})

test('120 段运行时火花实例始终受 8 个上限约束', async ({ page }) => {
  test.setTimeout(60_000)
  await openHome(page)
  await importProgram(page, poweredProgram(120, '火花预算工程'))
  await expect(page.locator('#project-name')).toHaveValue('火花预算工程')

  await page.locator('.wb-run-toggle').click()
  await expect(page.locator('.wb-run-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.locator('.ll-energy-spark').count()).toBeGreaterThan(0)

  const samples: number[] = []
  for (let index = 0; index < 12; index += 1) {
    samples.push(await page.locator('.ll-energy-spark').count())
    await page.waitForTimeout(100)
  }
  expect(Math.max(...samples)).toBeLessThanOrEqual(8)
})

test('程序段菜单只在打开时挂载，键盘关闭后焦点归还触发器', async ({ page }) => {
  test.setTimeout(60_000)
  await openHome(page)
  await importProgram(page, poweredProgram(41, '菜单懒挂载工程'))
  await expect(page.locator('.ll-rung')).toHaveCount(42)
  await expect(page.locator('.ll-rung-menu-panel')).toHaveCount(0)

  const firstRung = page.locator('.ll-rung').first()
  const menu = firstRung.locator('.ll-rung-menu')
  const summary = menu.locator('summary')
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(firstRung.locator('.ll-rung-menu-panel')).toHaveCount(1)
  await page.keyboard.press('End')
  await expect(firstRung.getByRole('menuitem', { name: '删除程序段' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(firstRung.locator('.ll-rung-menu-panel')).toHaveCount(0)
  await expect(summary).toBeFocused()
})

test('8 条收藏滚到末端后最后星标不被箭头遮挡', async ({ page }) => {
  // 手机宽度会收起整条收藏栏，改从底部“指令”进入。横向溢出发生在
  // 桌面收藏栏完整显示、但可用宽度放不下 8 张卡的视口。
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.addInitScript(() => {
    window.localStorage.setItem('ladderlab.favoriteInstructions.v1', JSON.stringify([
      'contact:NO',
      'contact:NC',
      'output:COIL',
      'output:TON',
      'contact:CMP',
      'contact:P',
      'contact:N',
      'output:SET',
    ]))
  })
  await openHome(page)
  const cards = page.locator('.wb-instruction-card')
  await expect(cards).toHaveCount(8)
  // 名称会随滚动状态改变，定位器必须绑在稳定 class 上。
  const overflow = page.locator('.wb-instruction-scroll')
  await expect(overflow).toBeVisible()

  await page.locator('.wb-instruction-list').evaluate((list) => {
    list.scrollTo({ left: list.scrollWidth, behavior: 'instant' })
  })
  await expect(overflow).toHaveAccessibleName('回到收藏指令开头')

  const hit = await cards.last().locator('.wb-instruction-star').evaluate((star) => {
    const starRect = star.getBoundingClientRect()
    const center = document.elementFromPoint(
      starRect.left + starRect.width / 2,
      starRect.top + starRect.height / 2,
    )
    const arrow = document.querySelector<HTMLElement>('.wb-instruction-scroll')
    const arrowRect = arrow?.getBoundingClientRect()
    const intersects = Boolean(arrowRect && !(
      arrowRect.right <= starRect.left
      || arrowRect.left >= starRect.right
      || arrowRect.bottom <= starRect.top
      || arrowRect.top >= starRect.bottom
    ))
    return {
      ownStar: center === star || center?.closest('.wb-instruction-star') === star,
      intersects,
      starInsideViewport: starRect.left >= 0 && starRect.right <= window.innerWidth,
    }
  })
  expect(hit).toEqual({ ownStar: true, intersects: false, starInsideViewport: true })
})
