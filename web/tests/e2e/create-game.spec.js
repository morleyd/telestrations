import { test, expect } from '@playwright/test'
import { createGame } from './helpers.js'

// This is the regression test for the two bugs that broke a real game night:
//   1. the round-duration field rejected its own default value (90), and
//   2. createGame failed against the backend.
// Reaching the waiting room proves the timed default validates AND that the
// game record was created on a live backend.
test('host creates a timed game (default 90s) and reaches the waiting room', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  await page.getByLabel('Username').fill('hosty')
  await page.getByText('Set Timed Rounds').click()

  // The default is present and must be accepted, not flagged as empty.
  await expect(page.getByLabel('Round Duration')).toHaveValue('90')

  await page.getByRole('button', { name: 'Begin!' }).click()

  await expect(page).toHaveURL(/\/[a-zA-Z]{5}$/)
  await expect(page.getByText('Game Code:')).toBeVisible()
  await expect(page.getByText('Welcome hosty!')).toBeVisible()
})

test('host creates an untimed game and reaches the waiting room', async ({ page }) => {
  const code = await createGame(page, { username: 'soloist', timed: false })
  expect(code).toMatch(/^[a-zA-Z]{5}$/)
  await expect(page.getByText('Welcome soloist!')).toBeVisible()
})
