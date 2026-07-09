import { test, expect } from '@playwright/test'
import { createGame, joinGame } from './helpers.js'

// A host and a second player in separate browser contexts. Exercises the join
// flow and the realtime roster subscription that surfaces new players.
test('a second player can join and appears in the host roster', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })

  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'friend')

  // Guest sees themselves in the room.
  await expect(guestPage.getByText('Welcome friend!')).toBeVisible()

  // Host's roster updates over the realtime subscription without a reload.
  await expect(hostPage.getByText('friend')).toBeVisible({ timeout: 15_000 })

  await hostCtx.close()
  await guestCtx.close()
})
