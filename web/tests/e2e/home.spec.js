import { test, expect } from '@playwright/test'

test('home page loads with New Game and Join Game', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join Game' })).toBeVisible()
})

// Every field's label is up on the box's edge as a tag, an empty field's too
// (plugins/vuetify.js). The tag sticks out past the field's top, so whatever
// the field sits in must not cut it off: a card clips, so SetUsername's is
// overflow-visible. This checks Username, the field that was cut off.
test('an empty field\'s label is a whole tag on its edge', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  await expect(page.getByLabel('Username')).toHaveValue('')
  const tag = page.locator('.v-field').filter({ has: page.getByLabel('Username') })
    .locator('.v-field-label--floating')
  await expect(tag).toBeVisible()

  // Measured all at once: the dialog grows as it opens, so separate readings
  // could each catch it at a different size
  const { tagTop, tagBottom, fieldTop, clippedBy } = await tag.evaluate((el) => {
    const tag = el.getBoundingClientRect()
    // The first box round the tag that would cut part of it off, if any
    let clippedBy = null
    for (let box = el.parentElement; box && !clippedBy; box = box.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(box)
      if (overflowX === 'visible' && overflowY === 'visible') continue
      const r = box.getBoundingClientRect()
      if (tag.top < r.top || tag.left < r.left || tag.bottom > r.bottom || tag.right > r.right) {
        clippedBy = box.className
      }
    }
    const fieldTop = el.closest('.v-field').getBoundingClientRect().top
    return { tagTop: tag.top, tagBottom: tag.bottom, fieldTop, clippedBy }
  })
  expect(tagTop, 'the tag starts above the box').toBeLessThan(fieldTop)
  expect(tagBottom, 'and ends inside it').toBeGreaterThan(fieldTop)
  expect(clippedBy).toBeNull()
})
