import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame, storyItem } from './helpers.js'

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

// Codes are lowercase, but the waiting room shows them in capitals: a link
// typed in as the code is shown goes to the game, the room and the review alike.
test('a game code in capitals in the address goes to the game', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    const CODE = code.toUpperCase()
    expect(CODE).not.toBe(code)

    await guest.goto(`/${CODE}`)
    await expect(guest).toHaveURL(new RegExp(`/${code}$`))
    const dialog = guest.getByRole('dialog')
    await expect(dialog.getByText('Join the Game!')).toBeVisible()
    await dialog.getByLabel('Username').fill('friend')
    await dialog.getByRole('button', { name: 'Submit' }).click()
    await expect(guest.getByText('Welcome friend!')).toBeVisible()
    await expect(host.getByText('friend')).toBeVisible({ timeout: 15_000 })

    await startGame(host, 2)
    await guest.goto(`/${CODE}/review`)
    await expect(guest).toHaveURL(new RegExp(`/${code}/review$`))
    await expect(storyItem(guest, 'hosty')).toContainText('Waiting on hosty')
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// Clicking the game code copies it, as the tag shows it, and says so.
test('clicking the game code copies it', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  try {
    const CODE = (await createGame(page, { username: 'hosty' })).toUpperCase()
    await page.getByRole('button', { name: 'Copy the game code' }).click()
    await expect(page.locator('.v-snackbar')).toContainText(`Copied the game code ${CODE}`)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE)
  } finally {
    await context.close()
  }
})

// A phone on the Wi-Fi gets the game over plain http, where there's no
// navigator.clipboard: the code is copied the old way.
test('the game code copies without navigator.clipboard', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  await context.addInitScript(() => {
    const clipboard = navigator.clipboard
    window.readClipboard = () => clipboard.readText()
    Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined })
  })
  const page = await context.newPage()
  try {
    const CODE = (await createGame(page, { username: 'hosty' })).toUpperCase()
    expect(await page.evaluate(() => navigator.clipboard)).toBeUndefined()
    await page.getByRole('button', { name: 'Copy the game code' }).click()
    await expect(page.locator('.v-snackbar')).toContainText(`Copied the game code ${CODE}`)
    expect(await page.evaluate(() => window.readClipboard())).toBe(CODE)
  } finally {
    await context.close()
  }
})

// The fallback copy says it couldn't when the page gives it no selection to
// copy from (getSelection() can be null), rather than throwing.
test('a copy with no selection to use says it couldn\'t', async ({ browser }) => {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined })
    window.getSelection = () => null
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    const CODE = (await createGame(page, { username: 'hosty' })).toUpperCase()
    await page.getByRole('button', { name: 'Copy the game code' }).click()
    await expect(page.locator('.v-snackbar')).toContainText(`Couldn't copy it. The game code is ${CODE}`)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

// A phone whose connection drops in the lobby (asleep, say) misses the host
// starting the game, and realtime doesn't send it again: once the connection
// is back, the lobby catches up and goes to the game. (Chromium's offline mode
// keeps an open event stream going, so the test drops the stream itself.)
test('a player whose connection drops when the game starts follows it once back', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  // The guest's realtime streams, for the test to cut
  await contexts[1].addInitScript(() => {
    const streams = (window.realtimeStreams = [])
    window.EventSource = class extends window.EventSource {
      constructor(...args) {
        super(...args)
        streams.push(this)
      }
    }
  })
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'sleepy')
    await guest.waitForFunction(() => window.realtimeStreams.some((s) => s.readyState === EventSource.OPEN))

    // The connection drops, and stays down while the host starts the game
    const realtime = (url) => url.pathname === '/api/realtime'
    await guest.route(realtime, (route) => route.abort())
    await guest.evaluate(() => window.realtimeStreams.forEach((s) => {
      s.close()
      s.dispatchEvent(new Event('error'))
    }))
    await startGame(host, 2)
    await guest.waitForTimeout(1000)
    await expect(guest).toHaveURL(new RegExp(`/${code}$`))

    await guest.unroute(realtime)
    await guest.waitForURL(new RegExp(`/${code}/draw$`), { timeout: 20_000 })
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
