import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame, submitJoin, submitWord } from './helpers.js'

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

  // The host, now on another browser, types their own name. After confirming
  // it's them they're dropped into the waiting room as the same player rather
  // than a colliding duplicate.
  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await submitJoin(guestPage, code, 'hosty')
  await expect(guestPage.getByText('"hosty" is already in this game')).toBeVisible()
  await guestPage.getByRole('button', { name: "That's me, rejoin" }).click()
  await expect(guestPage).toHaveURL(new RegExp(`/${code}$`, 'i'))
  await expect(guestPage.getByText('Welcome hosty!')).toBeVisible()

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

// Regression: the signed-in player is kept per tab and outlives a game. Opening
// the next game's link from the last game's review page used to reuse that old
// player: no join dialog, and no seat in the new game.
test('opening a new game link from the review page asks to join and seats the player', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  // A solo game is the quickest way to the review page: one word and it's over.
  await createGame(page, { username: 'solo', timed: false })
  await startGame(page, 1)
  await page.locator('textarea').first().fill('lonely')
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.waitForURL(/\/review$/)

  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const nextCode = await createGame(hostPage, { username: 'hosty', timed: false })

  // Same tab, straight to the new link.
  await page.goto(`/${nextCode}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Join the Game!')).toBeVisible()
  await expect(dialog.getByLabel('Username')).toHaveValue('solo') // pre-filled from last game
  await dialog.getByRole('button', { name: 'Submit' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByText('Welcome solo!')).toBeVisible()
  await expect(hostPage.locator('.drag-item')).toHaveCount(2)

  await ctx.close()
  await hostCtx.close()
})

// Someone who picks a name that's taken by accident can back out and choose
// another, without taking over the other player's seat.
test('declining the rejoin prompt keeps the other player and lets you pick a new name', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })

  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await submitJoin(guestPage, code, 'hosty')
  await guestPage.getByRole('button', { name: 'Pick another name' }).click()

  // Still on the home screen's join dialog, and nobody was signed in.
  await expect(guestPage).toHaveURL(/\/$/)
  await expect(guestPage.getByText('is already in this game')).toBeHidden()
  await guestPage.getByLabel('Username').fill('guesty')
  await guestPage.getByRole('button', { name: 'Join!' }).click()
  await expect(guestPage).toHaveURL(new RegExp(`/${code}$`, 'i'))
  await expect(guestPage.getByText('Welcome guesty!')).toBeVisible()
  await expect(hostPage.locator('.drag-item')).toHaveCount(2)

  await hostCtx.close()
  await guestCtx.close()
})

// Tech trouble mid-game: a player opens the game on another device, signs in
// with their name, confirms it's them, and is back on their turn.
test('a player can rejoin a started game from another browser', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })
  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'buddy')
  await startGame(hostPage, 2)
  await guestPage.waitForURL(/\/draw$/)

  const rescueCtx = await browser.newContext()
  const rescuePage = await rescueCtx.newPage()
  await rescuePage.goto(`/${code}/draw`)
  await rescuePage.getByLabel('Username').fill('buddy')
  await rescuePage.getByRole('button', { name: 'Join!' }).click()
  await rescuePage.getByRole('button', { name: "That's me, rejoin" }).click()
  await expect(rescuePage.getByText('Enter your starting prompt')).toBeVisible()

  await hostCtx.close()
  await guestCtx.close()
  await rescueCtx.close()
})

// Regression: the same player in two tabs. Once one tab writes a turn, the
// other's submit of that same turn is refused as already taken; that used to
// show an error and leave the tab stuck on the turn until a reload.
test('a second tab that submits a turn already taken moves on instead of sticking', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })
  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'buddy')
  await startGame(hostPage, 2)
  await guestPage.waitForURL(/\/draw$/)
  await expect(guestPage.getByText('Enter your starting prompt')).toBeVisible()

  const otherCtx = await browser.newContext()
  const other = await otherCtx.newPage()
  await other.goto(`/${code}/draw`)
  await other.getByLabel('Username').fill('buddy')
  await other.getByRole('button', { name: 'Join!' }).click()
  await other.getByRole('button', { name: "That's me, rejoin" }).click()
  await expect(other.getByText('Enter your starting prompt')).toBeVisible()

  await submitWord(guestPage, 'first')
  await other.locator('textarea').first().fill('second')
  await other.getByRole('button', { name: 'Submit' }).click()
  await expect(other.getByText('Enter your starting prompt')).toBeHidden()
  await expect(other.getByText(/already took/i)).toHaveCount(0)

  await hostCtx.close()
  await guestCtx.close()
  await otherCtx.close()
})

// Regression: on a reload the waiting room re-reads the stored player. A failed
// read (network blip, busy server) used to sign them out and ask them to join
// again, costing the host their host controls; only a 404 means they're gone.
test('a reload whose player re-read fails keeps the player in the waiting room', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await createGame(page, { username: 'hosty', timed: false })
  await page.route('**/api/collections/users/records/*', (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"status":500,"message":"Busy.","data":{}}' })
    : route.continue())
  const reread = page.waitForResponse((r) => /\/api\/collections\/users\/records\/\w+$/.test(r.url()))

  await page.reload()
  expect((await reread).status()).toBe(500)
  // The roster loads after the player is resolved, so by now it's decided.
  await expect(page.locator('.drag-item')).toHaveCount(1)
  await expect(page.getByText('Welcome hosty!')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin!' })).toBeVisible()
  await expect(page.getByText('Join the Game!')).toHaveCount(0)
  await ctx.close()
})

// Regression: a tab opened before the server was rebuilt asks for the old
// build's page chunks, which no longer exist. When the host started, every such
// player failed to load the turn page and sat in the waiting room. Now the app
// reloads into the page it was going to.
test('a player whose turn page fails to load (stale build) reloads into their turn', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })
  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'buddy')

  // The first request for the turn page's code fails, as an old chunk name would.
  let failed = 0
  await guestPage.route(/TakeTurn/, async (route) => {
    failed++
    await route.fulfill({ status: 404, body: '' })
  }, { times: 1 })

  await startGame(hostPage, 2)
  await guestPage.waitForURL(/\/draw$/, { timeout: 15_000 })
  await expect(guestPage.getByText('Enter your starting prompt')).toBeVisible({ timeout: 15_000 })
  expect(failed).toBe(1)

  await hostCtx.close()
  await guestCtx.close()
})

// Regression: a tab that already loaded every page keeps running its build
// forever, bugs and all, even after the server is rebuilt. It now checks the
// server's build on each page change and reloads if it's out of date.
test('a tab from an older build reloads into the new one at the next page change', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty', timed: false })
  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'buddy')

  // The server now reports a different build than the one this tab is running.
  await guestPage.route('**/version.json', (route) => route.fulfill({ json: { build: 'newer-build' } }))
  let documentLoads = 0
  guestPage.on('request', (r) => { if (r.resourceType() === 'document') documentLoads++ })

  await startGame(hostPage, 2)
  await guestPage.waitForURL(/\/draw$/, { timeout: 15_000 })
  await expect(guestPage.getByText('Enter your starting prompt')).toBeVisible({ timeout: 15_000 })
  expect(documentLoads).toBe(1) // a full page load, not an in-app page change

  await hostCtx.close()
  await guestCtx.close()
})
