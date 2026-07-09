import { test, expect } from '@playwright/test'

// Negative side of the round-duration regression: a genuinely empty field
// should block starting the game and surface the validation message.
test('empty round duration is rejected and blocks starting', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  await page.getByLabel('Username').fill('hosty')
  await page.getByText('Set Timed Rounds').click()

  await page.getByLabel('Round Duration').fill('')
  await page.getByRole('button', { name: 'Begin!' }).click()

  await expect(page.getByText('Duration must be a positive number!')).toBeVisible()
  // Still on the home screen — no game was created.
  await expect(page).toHaveURL(/\/$/)
})
