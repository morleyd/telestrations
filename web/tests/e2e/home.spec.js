import { test, expect } from '@playwright/test'

test('home page loads with New Game and Join Game', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join Game' })).toBeVisible()
})
