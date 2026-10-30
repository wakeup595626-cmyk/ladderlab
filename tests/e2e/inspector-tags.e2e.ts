import { expect, test } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

test('变量表可同时展开多个程序段，并跟随当前编辑段滚动', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')
  await expect(page.locator('#project-name')).toHaveValue('实验二 · 定时器与计数器')

  await page.getByRole('button', { name: '变量表', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '属性与变量面板' })
  await expect(panel).toBeVisible()

  const groups = panel.locator('.tag-group:not([data-unused="true"])')
  const heads = groups.locator('.tag-group-head')
  await expect(groups).toHaveCount(4)
  await expect(heads.first()).toHaveAttribute('aria-expanded', 'true')
  await expect(heads.nth(1)).toHaveAttribute('aria-expanded', 'false')

  // 展开第二段不会收起第一段；再点第一段只收起它自己。
  await heads.nth(1).click()
  await expect(heads.first()).toHaveAttribute('aria-expanded', 'true')
  await expect(heads.nth(1)).toHaveAttribute('aria-expanded', 'true')
  await heads.first().click()
  await expect(heads.first()).toHaveAttribute('aria-expanded', 'false')
  await expect(heads.nth(1)).toHaveAttribute('aria-expanded', 'true')

  // 正在看变量表时点程序段标题，面板保持「变量表」，当前第四段必须
  // 自动展开、高亮并滚进视口；之前手动展开的段也不会被收起。
  await page.locator('.ll-rung-drag').nth(3).click()
  await expect(page.getByRole('tab', { name: /变量表/ })).toHaveAttribute('aria-selected', 'true')
  const active = panel.locator('.tag-group[data-active="true"]')
  await expect(active).toHaveCount(1)
  await expect(active.locator('.tag-group-head')).toHaveAttribute('aria-expanded', 'true')
  await expect(active.locator('.tag-group-head')).toBeInViewport()

  // 当前段同样可以手动收起；自动跟随不会把它重新撑开。
  await active.locator('.tag-group-head').click()
  await expect(active.locator('.tag-group-head')).toHaveAttribute('aria-expanded', 'false')

  expect(errors, errors.join('\n')).toEqual([])
})
