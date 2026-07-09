import { test, expect } from '@playwright/test'

// Regression guards for the string-field validation rules (previously the
// buggy `v => v && v.trim` form). Valid inputs are exercised by the create /
// join specs; here we confirm empty inputs are actually rejected.

test('empty username blocks creating a game', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  await page.getByRole('button', { name: 'Begin!' }).click()

  await expect(page.getByText('Name cannot be empty!')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('empty game code blocks joining', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Join Game' }).click()
  await page.getByLabel('Username').fill('someone')
  await page.getByRole('button', { name: 'Join!' }).click()

  await expect(page.getByText('Game Code cannot be empty!')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})
