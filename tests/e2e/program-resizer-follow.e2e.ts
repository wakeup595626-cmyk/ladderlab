import { expect, test, type Page } from '@playwright/test'
import { loadCourseExperiment, openHome, trackPageErrors } from './support'

async function expectGripsToFollowRung(page: Page, index: number): Promise<void> {
  const rung = page.locator('.ll-rung').nth(index)
  await page.locator('.ll-rung-drag').nth(index).click()
  await expect(rung).toHaveClass(/is-whole-selected/)

  const grips = page.locator('.wb-program-resizer-grip')
  await expect(grips).toHaveCount(2)

  await expect.poll(async () => {
    const [rungBox, leftBox, rightBox] = await Promise.all([
      rung.boundingBox(),
      grips.nth(0).boundingBox(),
      grips.nth(1).boundingBox(),
    ])
    if (!rungBox || !leftBox || !rightBox) return Number.POSITIVE_INFINITY
    const rungCenter = rungBox.y + rungBox.height / 2
    const leftCenter = leftBox.y + leftBox.height / 2
    const rightCenter = rightBox.y + rightBox.height / 2
    return Math.max(Math.abs(leftCenter - rungCenter), Math.abs(rightCenter - rungCenter))
  }).toBeLessThanOrEqual(1)
}

test('图纸两侧的调宽把手跟随当前编辑程序段', async ({ page }) => {
  const errors = trackPageErrors(page)

  await openHome(page)
  await loadCourseExperiment(page, '02 定时器与计数器')

  await expectGripsToFollowRung(page, 1)
  await expectGripsToFollowRung(page, 2)

  expect(errors, errors.join('\n')).toEqual([])
})
