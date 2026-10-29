import { expect, test, type Page } from '@playwright/test'
import { openHome } from './support'

/** 走「导入工程 → 粘贴 JSON」这条真实路径换掉当前工程。 */
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

test('长工程打开程序段菜单时不裁掉底部操作，关闭后恢复虚拟化', async ({ page }) => {
  test.setTimeout(90_000)
  await openHome(page)

  const rungs = Array.from({ length: 41 }, (_, index) => ({
    id: `rung-${index + 1}`,
    label: `第 ${index + 1} 段`,
    nodes: [{ type: 'contact', id: `contact-${index + 1}`, kind: 'NO', tag: 'Start' }],
    output: { id: `output-${index + 1}`, kind: 'COIL', tag: 'Motor' },
  }))

  await importProgram(page, {
    schema: 1,
    name: '长工程程序段菜单',
    profile: 'v21',
    tags: [
      { id: 'tag-start', name: 'Start', address: '%I0.0', kind: 'BOOL', initial: false, comment: '' },
      { id: 'tag-motor', name: 'Motor', address: '%Q0.0', kind: 'BOOL', initial: false, comment: '' },
    ],
    rungs,
  })

  await expect(page.locator('#project-name')).toHaveValue('长工程程序段菜单')
  const sheet = page.locator('.ll-program-sheet')
  await expect(sheet).toHaveClass(/\bis-long\b/)
  // 41 个内容段加末尾自动占位段。
  await expect(page.locator('.ll-rung')).toHaveCount(42)

  const firstRung = page.locator('.ll-rung').first()
  const menu = firstRung.locator('.ll-rung-menu')
  const summary = menu.locator('summary')
  const duplicate = menu.getByRole('menuitem', { name: '创建副本' })
  const remove = menu.getByRole('menuitem', { name: '删除程序段' })

  await expect(firstRung).toHaveCSS('content-visibility', 'auto')

  // 键盘打开后，End 应能把焦点送到最底部的删除项；Esc 关闭并归还焦点。
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveAttribute('open', '')
  await expect(firstRung).toHaveCSS('content-visibility', 'visible')
  await expect(remove).toBeVisible()
  await page.keyboard.press('End')
  await expect(remove).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).not.toHaveAttribute('open')
  await expect(summary).toBeFocused()
  await expect(firstRung).toHaveCSS('content-visibility', 'auto')

  // 鼠标打开后，点击菜单外部应正常关闭。
  await summary.click()
  await expect(menu).toHaveAttribute('open', '')
  await page.locator('#project-name').click()
  await expect(menu).not.toHaveAttribute('open')

  // 两个问题项都必须真正接收点击，而不只是 DOM 可见。
  await summary.click()
  await expect(duplicate).toBeVisible()
  await expect(remove).toBeVisible()
  await duplicate.click({ trial: true })
  await remove.click({ trial: true })

  await duplicate.click()
  await expect(page.getByText('已创建程序段副本', { exact: true })).toBeVisible()
  await expect(page.locator('.ll-rung')).toHaveCount(43)

  await summary.click()
  await remove.click()
  await expect(page.locator('.ll-rung')).toHaveCount(42)
})
