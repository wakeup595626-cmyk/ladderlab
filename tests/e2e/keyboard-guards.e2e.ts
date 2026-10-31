import { expect, test } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

test('焦点停在工具栏按钮时 Delete 不会误删画布元件', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const nodes = page.locator('.ll-node[data-node-id]')
  const countBefore = await nodes.count()
  await nodes.first().click()
  const themeButton = page.getByRole('button', { name: '配色' })
  await themeButton.click()
  // 主题弹层会主动管理首焦点。直接在按钮上派发按键，验证事件冒泡到
  // window 的全局删除快捷键时仍会识别“当前目标是控件”并放行。
  await themeButton.evaluate((element) => {
    const button = element as HTMLElement
    button.focus()
    button.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete',
      code: 'Delete',
      bubbles: true,
      cancelable: true,
    }))
  })
  await expect(nodes).toHaveCount(countBefore)

  await page.keyboard.press('Escape')
  expect(errors, errors.join('\n')).toEqual([])
})

test('焦点停在画布元件时 Delete 仍能删除选中的元件', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  const nodes = page.locator('.ll-node[data-node-id]')
  const countBefore = await nodes.count()
  const first = nodes.first()
  await first.click()
  await first.focus()
  expect(await first.evaluate((element) => document.activeElement === element)).toBe(true)

  await page.keyboard.press('Delete')
  await expect(nodes).toHaveCount(countBefore - 1)

  expect(errors, errors.join('\n')).toEqual([])
})

test('中文输入法选词期间按 Enter 不提交字段', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openHome(page)

  const projectName = page.getByLabel('工程名称，输入后按回车保存')
  await projectName.click()
  await page.evaluate(() => {
    const input = document.getElementById('project-name') as HTMLInputElement | null
    if (!input) throw new Error('工程名称输入框不存在')
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }))
  })
  const activeAfterComposition = await page.evaluate(() => ({
    id: document.activeElement instanceof HTMLElement ? document.activeElement.id : '',
    composingSupported: new KeyboardEvent('keydown', { isComposing: true }).isComposing,
  }))
  expect(activeAfterComposition).toEqual({ id: 'project-name', composingSupported: true })

  await loadCourseExperiment(page, '02 定时器与计数器')
  await page.locator('.ll-node[data-node-id]').first().click()
  const tagInput = page.locator('.qe-panel input.qe-input').first()
  await tagInput.click()
  await tagInput.evaluate((element) => {
    const input = element as HTMLInputElement
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }))
  })
  const activeAfterEditorComposition = await page.evaluate(() => ({
    tagName: document.activeElement?.tagName ?? '',
    className: document.activeElement instanceof HTMLElement ? document.activeElement.className : '',
  }))
  expect(activeAfterEditorComposition.tagName).toBe('INPUT')
  expect(activeAfterEditorComposition.className).toContain('qe-input')

  expect(errors, errors.join('\n')).toEqual([])
})
