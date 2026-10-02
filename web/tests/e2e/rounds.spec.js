import { test, expect } from '@playwright/test'
import {
  createGame, joinGame, startGame, driveGameToReview, expectStoriesAlternate,
  turnState, submitWord, submitDrawing, stroke, PB_URL, PNG_PIXEL,
} from './helpers.js'

// Rounds: each story goes round the group once per round, or (Infinite) until
// the host ends the game. End Game gives everyone mid-turn a countdown to
// finish, then sends everybody to the review.

const gameRecord = async (request, code) => {
  const filter = encodeURIComponent(`game_code="${code}"`)
  return (await (await request.get(`${PB_URL}/api/collections/games/records?filter=${filter}`)).json()).items[0]
}

test('the new-game dialog sets rounds, with arrows or typing, or Infinite', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  const rounds = page.getByLabel('Rounds', { exact: true })
  await expect(rounds).toHaveValue('1')
  await page.locator('[data-testid="increment"]').click()
  await expect(rounds).toHaveValue('2')
  await page.locator('[data-testid="decrement"]').click()
  await expect(rounds).toHaveValue('1')
  await expect(page.locator('[data-testid="decrement"]')).toBeDisabled() // 1 is the least

  // Infinite swaps in a disabled ∞, and back.
  await page.getByLabel('Infinite').check()
  await expect(page.getByLabel('Rounds', { exact: true })).toHaveValue('∞')
  await expect(page.getByLabel('Rounds', { exact: true })).toBeDisabled()
  await page.getByLabel('Infinite').uncheck()
  await expect(page.getByLabel('Rounds', { exact: true })).toBeEnabled()

  await page.getByLabel('Rounds', { exact: true }).fill('3')
  await page.getByLabel('Username').fill('hosty')
  await page.getByRole('button', { name: 'Begin!' }).click()
  await page.waitForURL(/\/[a-zA-Z]{5}$/)
  const game = await gameRecord(request, page.url().split('/').pop())
  expect(game).toMatchObject({ rounds: 3, endless: false })
})

test('two rounds: every story goes round the group twice', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty', rounds: 2 })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)
    await host.waitForTimeout(2000)

    await driveGameToReview([host, guest])
    const stories = await expectStoriesAlternate(request, code, 2)
    for (const turns of Object.values(stories)) expect(turns).toHaveLength(4)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// Both players are mid-turn when the host ends it. The host finishes in time;
// that must not cut buddy's countdown short (every turn that lands wakes
// every page), and when it runs out buddy's unfinished turn is kept.
test('Infinite: the host ends it, and everyone mid-turn gets the countdown', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty', endless: true })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)
    await host.waitForTimeout(2000)

    // Play past the first round, until both have a turn on screen.
    let turns = 0
    const onTurn = (state) => state === 'word' || state === 'draw'
    for (let i = 0; i < 80; i++) {
      const states = [await turnState(host), await turnState(guest)]
      if (turns >= 4 && states.every(onTurn)) break
      const k = states.findIndex(onTurn)
      if (k < 0) { await host.waitForTimeout(300); continue }
      const page = [host, guest][k]
      if (states[k] === 'word') await submitWord(page, `w${turns}`)
      else await submitDrawing(page)
      turns++
      await page.waitForTimeout(400)
    }
    const [hostTurn, guestTurn] = [await turnState(host), await turnState(guest)]
    expect(onTurn(hostTurn) && onTurn(guestTurn)).toBe(true)

    // The host ends it from Manage players.
    await host.getByRole('button', { name: 'Manage players' }).click()
    host.once('dialog', (d) => d.accept())
    await host.getByRole('button', { name: 'End Game' }).click()
    await expect(guest.getByText('The host is ending the game!')).toBeVisible()
    await expect(host.getByText('The host is ending the game!')).toBeVisible()

    // buddy makes a start and doesn't submit; the host finishes in time.
    if (guestTurn === 'word') await guest.locator('textarea').first().fill('half a gue')
    else await stroke(guest)
    if (hostTurn === 'word') await submitWord(host, 'just in time')
    else await submitDrawing(host)
    await host.waitForURL(/\/review$/)
    await guest.waitForTimeout(1000)
    await expect(guest.getByText('The host is ending the game!')).toBeVisible()
    await guest.waitForURL(/\/review$/, { timeout: 20_000 })

    // Both turns were kept: the host's as played, buddy's as timed out.
    const game = await gameRecord(request, code)
    const filter = encodeURIComponent(`game_id="${game.id}"`)
    const turnsByNewest = (await (await request.get(
      `${PB_URL}/api/collections/turns/records?perPage=500&sort=-created&filter=${filter}`)).json()).items
    const users = (await (await request.get(`${PB_URL}/api/collections/users/records?filter=${filter}`)).json()).items
    const id = Object.fromEntries(users.map((u) => [u.username, u.id]))
    const last = (name) => turnsByNewest.find((t) => t.user_id === id[name])
    expect(last('hosty')).toMatchObject({ timed_out: false, skipped: false })
    expect(last('buddy')).toMatchObject({ timed_out: true, skipped: false })
    if (guestTurn === 'word') expect(last('buddy').prompt).toBe('half a gue')
    else expect(last('buddy').drawing).not.toBe('')

    // And once the grace after the deadline is up, the game is over: no story
    // waits on anyone.
    await expect.poll(async () => {
      const progress = await (await request.get(`${PB_URL}/api/collections/progress/records?filter=${filter}`)).json()
      return progress.items.filter((row) => row.next_user_id).length
    }, { timeout: 15_000 }).toBe(0)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// With one player, every turn after the first is their second (third, ...)
// turn on the same story. On an upgraded server that kept a one-turn-per-player
// index it stuck at the first drawing; it must keep coming round to them until
// the host ends it.
test('one player, Infinite: the story keeps coming back to them until the host ends it', async ({ page, request }) => {
  test.setTimeout(90_000)
  const code = await createGame(page, { username: 'solo', endless: true })
  await startGame(page)
  await expect(page.getByText('Enter your starting prompt')).toBeVisible()
  await submitWord(page, 'a teapot')
  for (const [kind, act] of [
    ['draw', () => submitDrawing(page)],
    ['word', () => submitWord(page, 'a kettle')], // a guess at their own drawing
    ['draw', () => submitDrawing(page)],
  ]) {
    await expect.poll(() => turnState(page), { timeout: 15_000 }).toBe(kind)
    await act()
  }
  await expect.poll(() => turnState(page), { timeout: 15_000 }).toBe('word')

  await page.getByRole('button', { name: 'Manage players' }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'End Game' }).click()
  await page.waitForURL(/\/review$/, { timeout: 20_000 })

  const game = await gameRecord(request, code)
  const filter = encodeURIComponent(`game_id="${game.id}"`)
  const turns = (await (await request.get(
    `${PB_URL}/api/collections/results/records?sort=turn_number&filter=${filter}`)).json()).items
  expect(turns.map((t) => Boolean(t.drawing))).toEqual([false, true, false, true])
})

// When the server refused a turn with an error and no code (a unique index
// left over on an upgraded server), the page read it as "already taken": it
// marked the turn done, dropped the player's work and waited for good. A turn
// refused without a code must stay on screen, say so, and go through when sent
// again.
test('a turn the server refuses without a code stays on screen to send again', async ({ page }) => {
  await createGame(page, { username: 'solo', endless: true })
  await startGame(page)
  await submitWord(page, 'a teapot')
  await expect.poll(() => turnState(page), { timeout: 15_000 }).toBe('draw')

  // The first send of the drawing is refused the way a unique index refuses it.
  let refused = 0
  await page.route('**/api/collections/turns/records', async (route) => {
    if (route.request().method() !== 'POST' || refused++) return route.continue()
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 400, message: 'Failed to create record.',
        data: {
          story_id: { code: 'validation_not_unique', message: 'Value must be unique.' },
          user_id: { code: 'validation_not_unique', message: 'Value must be unique.' },
        },
      }),
    })
  })
  await page.getByRole('tab', { name: /Upload Photo/ }).click()
  await page.locator('#fileInput').setInputFiles({ name: 'd.png', mimeType: 'image/png', buffer: PNG_PIXEL })
  const submit = page.locator('.v-window-item--active').getByRole('button', { name: 'Submit' })
  await submit.click()
  await expect(page.getByText(/Failed to create record/)).toBeVisible()
  expect(refused).toBe(1)

  // Still on the drawing, upload and all: sending it again goes through.
  expect(await turnState(page)).toBe('draw')
  await Promise.all([
    page.waitForResponse((r) => /\/api\/collections\/turns\/records/.test(r.url()) &&
      r.request().method() === 'POST' && r.status() === 200),
    submit.click(),
  ])
  await expect.poll(() => turnState(page), { timeout: 15_000 }).toBe('word')
})
