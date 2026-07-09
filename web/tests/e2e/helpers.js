import { expect } from '@playwright/test'

const CODE_RE = /\/[a-zA-Z]{5}$/

// Drive the "New Game" dialog on the home screen through to the waiting room.
// Returns the generated 5-letter game code.
export async function createGame(page, { username = 'hosty', timed = false } = {}) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  await page.getByLabel('Username').fill(username)
  if (timed) {
    // v-switch: clicking its label toggles it.
    await page.getByText('Set Timed Rounds').click()
  }
  await page.getByRole('button', { name: 'Begin!' }).click()
  await page.waitForURL(CODE_RE)
  return page.url().split('/').pop()
}

// Drive the "Join Game" dialog through to the waiting room.
export async function joinGame(page, code, username) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Join Game' }).click()
  await page.getByLabel('Game Code').fill(code)
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Join!' }).click()
  await expect(page).toHaveURL(new RegExp(`/${code}$`, 'i'))
}
