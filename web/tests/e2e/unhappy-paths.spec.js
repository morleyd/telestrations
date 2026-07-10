import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame } from './helpers.js'

// The ways a human wanders off the happy path: mistyped codes, stale links,
// double-joins, and games that already started. Each should fail gracefully —
// a clear message and no half-joined limbo — not a blank screen or a crash.

test('joining a non-existent game code shows an error and stays on the home screen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Join Game' }).click()
  await page.getByLabel('Game Code').fill('zzzzz')
  await page.getByLabel('Username').fill('lost')
  await page.getByRole('button', { name: 'Join!' }).click()

  // An error snackbar appears and we are not navigated into any game.
  await expect(page.locator('.v-snackbar')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('a bogus URL renders the 404 page, not a blank screen', async ({ page }) => {
  await page.goto('/this-page-does-not-exist')
  await expect(page.getByText('404 not found')).toBeVisible()
  // The "Home Page" v-btn uses `:to`, so it renders as a router link, not a button.
  await expect(page.getByRole('link', { name: 'Home Page' })).toBeVisible()
})

test('opening the draw link before the game starts bounces to the waiting room', async ({ page }) => {
  // A player who clicks a "/draw" link too early (game not started yet).
  const hostCtx = await page.context().browser().newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })

  await page.goto(`/${code}/draw`)

  await expect(page.getByText(/has not been started yet/i)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/${code}$`, 'i')) // dropped the /draw
  await hostCtx.close()
})

test('joining with a name already in the game re-attaches instead of duplicating', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })

  // A second person types the host's name. The app treats it as the same player
  // ("assuming it's yours") and drops them into the waiting room rather than
  // creating a colliding duplicate.
  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'hosty')
  await expect(guestPage.getByText(/already exists/i)).toBeVisible()
  await expect(guestPage).toHaveURL(new RegExp(`/${code}$`, 'i'))

  // The host's roster still holds exactly one seat — the re-attach did not add
  // a duplicate player. (Give the realtime roster a moment to settle first.)
  await hostPage.waitForTimeout(1000)
  await expect(hostPage.locator('.drag-item')).toHaveCount(1)

  await hostCtx.close()
  await guestCtx.close()
})

test('joining an already-started game is refused with a clear message', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })
  await startGame(hostPage, 1) // host starts solo; game is now in progress

  const latecomerCtx = await browser.newContext()
  const latecomerPage = await latecomerCtx.newPage()
  await latecomerPage.goto('/')
  await latecomerPage.getByRole('button', { name: 'Join Game' }).click()
  await latecomerPage.getByLabel('Game Code').fill(code)
  await latecomerPage.getByLabel('Username').fill('latecomer')
  await latecomerPage.getByRole('button', { name: 'Join!' }).click()

  await expect(latecomerPage.getByText(/already been started/i)).toBeVisible()
  await expect(latecomerPage).toHaveURL(/\/$/) // never left the home screen

  await hostCtx.close()
  await latecomerCtx.close()
})

test('a player who leaves the party is removed from the host roster', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })

  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'quitter')

  // Host sees the guest arrive over the realtime roster.
  await expect(hostPage.getByText('quitter')).toBeVisible({ timeout: 15_000 })

  // Guest leaves; "Leave Party" pops a native confirm() we must accept.
  guestPage.once('dialog', (d) => d.accept())
  await guestPage.getByRole('button', { name: 'Leave Party' }).click()
  await expect(hostPage.getByText('quitter')).toHaveCount(0, { timeout: 15_000 })

  await hostCtx.close()
  await guestCtx.close()
})
