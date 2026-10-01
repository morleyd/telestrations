import { test, expect } from '@playwright/test'
import { createGame } from './helpers.js'

// Regression: one Enter in a join / new-game form runs its submit handler
// several times. SetUsername emits @username on keydown (its form's implicit
// submit) and again on keyup (@keyup.enter), and that submit also bubbles to
// the page's own @submit form. Each call used to start a create POST on the
// same resource key.
// PocketBase's auto-cancellation aborted the first (which the server still
// committed) and the second then hit the unique index with "Failed to create
// record." — so the player saw an error even though their record existed, and a
// second attempt reported they were "already in this game". The fix latches each
// handler on the first in-flight submit; these drive the double-fire (a single
// Enter) and assert exactly one create lands and the player joins cleanly.

// Count create POSTs the page issues against a collection, so we can prove the
// duplicate submit never reached the backend.
function countCreates(page, collection) {
  const state = { count: 0 }
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(`/api/collections/${collection}/records`)) {
      state.count++
    }
  })
  return state
}

test('pressing Enter to join from the waiting room creates exactly one user', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })

  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  const creates = countCreates(guestPage, 'users')

  // Straight to the game link: an unknown visitor gets the waiting room's join
  // dialog (not the home screen's).
  await guestPage.goto(`/${code}`)
  const dialog = guestPage.getByRole('dialog')
  await expect(dialog.getByText('Join the Game!')).toBeVisible()
  await dialog.getByLabel('Username').fill('zed')
  // Enter is the double-fire path: @keyup.enter and the form submit both land.
  await dialog.getByLabel('Username').press('Enter')

  // Joined cleanly: no duplicate-create error, and we land in the room.
  await expect(guestPage.getByText('Welcome zed!')).toBeVisible()
  await expect(guestPage.getByText(/Failed to create record/)).toBeHidden()

  // Give any stray duplicate POST time to arrive before we count.
  await guestPage.waitForTimeout(1000)
  expect(creates.count, 'user create POSTs').toBe(1)

  await hostCtx.close()
  await guestCtx.close()
})

test('pressing Enter to join from the home screen creates exactly one user', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })

  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  const creates = countCreates(guestPage, 'users')

  await guestPage.goto('/')
  await guestPage.getByRole('button', { name: 'Join Game' }).click()
  await guestPage.getByLabel('Game Code').fill(code)
  await guestPage.getByLabel('Username').fill('zed')
  await guestPage.getByLabel('Username').press('Enter')

  await expect(guestPage).toHaveURL(new RegExp(`/${code}$`, 'i'))
  await expect(guestPage.getByText('Welcome zed!')).toBeVisible()
  await expect(guestPage.getByText(/Failed to create record/)).toBeHidden()

  await guestPage.waitForTimeout(1000)
  expect(creates.count, 'user create POSTs').toBe(1)

  await hostCtx.close()
  await guestCtx.close()
})

test('pressing Enter to start a new game creates exactly one game', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const creates = countCreates(page, 'games')

  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  await page.getByLabel('Username').fill('solo')
  await page.getByLabel('Username').press('Enter')

  // Landed in a real game (a 5-letter code route), not two.
  await page.waitForURL(/\/[a-zA-Z]{5}$/)
  await expect(page.getByText('Welcome solo!')).toBeVisible()

  await page.waitForTimeout(1000)
  expect(creates.count, 'game create POSTs').toBe(1)

  await ctx.close()
})
