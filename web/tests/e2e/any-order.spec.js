import { test, expect } from '@playwright/test'
import {
  createGame, joinGame, startGame, startThreePlayerGame, submitWord, submitDrawing, stroke, driveGameToReview,
  expectStoriesAlternate, hostAct, PB_URL, PNG_PIXEL,
} from './helpers.js'

// A player with several notebooks waiting can do them in any order: the
// Notebooks menu in the app bar switches between them, or goes to look at the
// table, which has a button back. Each one opened keeps its work (and its
// round timer) until it's written.

const turnCreated = (page) => page.waitForResponse(
  (r) => /\/api\/collections\/turns\/records/.test(r.url()) && r.request().method() === 'POST' && r.status() === 200,
  { timeout: 20_000 },
)

const menu = (page) => page.getByRole('button', { name: 'Your notebooks' })
const notebook = (page, name) => page.locator(`.v-list-item[data-notebook="${name}'s notebook"]`)
const drawPrompt = (page) => page.locator('.drawing-prompt-text')

async function pick(page, name) {
  await menu(page).click()
  await notebook(page, name).click()
}

async function lookAtTable(page) {
  await menu(page).click()
  await page.getByText('Look at the table').click()
  await expect(page.getByText('Around the table')).toBeVisible()
}

// The turns saved in a game, by player name
async function turnsBy(request, code) {
  const q = (f) => `?perPage=500&sort=created&filter=${encodeURIComponent(f)}`
  const users = (await (await request.get(`${PB_URL}/api/collections/users/records${q(`game_id.game_code="${code}"`)}`)).json()).items
  const turns = (await (await request.get(`${PB_URL}/api/collections/turns/records${q(`game_id.game_code="${code}"`)}`)).json()).items
  return Object.fromEntries(users.map((u) => [u.username, turns.filter((t) => t.user_id === u.id)]))
}

// Two players, each through their opening word and on to a drawing of the
// other's. alpha hosts.
async function twoOnDrawings(browser, gameOpts) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [alpha, bravo] = await Promise.all(contexts.map((c) => c.newPage()))
  const code = await createGame(alpha, { username: 'alpha', ...gameOpts })
  await joinGame(bravo, code, 'bravo')
  await startGame(alpha, 2)
  await bravo.waitForURL(/\/draw$/)
  await submitWord(alpha, 'apple')
  await submitWord(bravo, 'banana')
  await expect(drawPrompt(alpha)).toHaveText('banana', { timeout: 15_000 })
  await expect(drawPrompt(bravo)).toHaveText('apple', { timeout: 15_000 })
  return { code, contexts, alpha, bravo }
}

test('any order: pick a notebook out of turn, switch back to find the work kept, and finish the queue', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const { code, contexts, seats } = await startThreePlayerGame(browser, request)
  const [s0, s1, s2] = seats
  try {
    await submitWord(s0.page, 'apple')
    await submitWord(s1.page, 'banana')
    await submitWord(s2.page, 'cherry')

    // s2 is on s1's notebook, drawing banana, and makes a start.
    await expect(drawPrompt(s2.page)).toHaveText('banana', { timeout: 15_000 })
    await stroke(s2.page)
    // s1 draws apple in s0's notebook, which comes to s2 too: a guess, queued
    // behind the drawing they're on.
    await expect(drawPrompt(s1.page)).toHaveText('apple', { timeout: 15_000 })
    await submitDrawing(s1.page)
    await expect(menu(s2.page)).toContainText('2', { timeout: 15_000 })

    // s2 takes the guess first, and starts typing.
    await menu(s2.page).click()
    await expect(notebook(s2.page, s1.name)).toContainText('on screen')
    await expect(notebook(s2.page, s0.name)).toContainText('Guess')
    await notebook(s2.page, s0.name).click()
    await expect(s2.page.locator('textarea')).toBeVisible()
    await s2.page.locator('textarea').fill('an apple?')

    // Back to the drawing: still drawn.
    await menu(s2.page).click()
    await expect(notebook(s2.page, s1.name)).toContainText('started')
    await notebook(s2.page, s1.name).click()
    await expect(drawPrompt(s2.page)).toHaveText('banana')
    await expect(s2.page.getByRole('button', { name: 'Undo' })).toBeEnabled()

    // And to the guess: still typed. A look at the table, and back to it
    // again: still typed.
    await pick(s2.page, s0.name)
    await expect(s2.page.locator('textarea')).toHaveValue('an apple?')
    await lookAtTable(s2.page)
    await expect(menu(s2.page)).toHaveCount(0)
    await s2.page.getByRole('button', { name: 'Back to my turn' }).click()
    await expect(s2.page.locator('textarea')).toHaveValue('an apple?')
    // It goes in...
    await submitWord(s2.page, 'an apple?')

    // ...and without picking, s2 is back on the drawing they'd started, which
    // goes in as drawn.
    await expect(drawPrompt(s2.page)).toHaveText('banana')
    await expect(s2.page.getByRole('button', { name: 'Undo' })).toBeEnabled()
    await Promise.all([
      turnCreated(s2.page),
      s2.page.locator('.v-window-item--active').getByRole('button', { name: 'Submit' }).click(),
    ])
    // That was s2's last turn: one on every story.
    await s2.page.waitForURL(/\/review$/, { timeout: 15_000 })

    await driveGameToReview(seats.map((s) => s.page))
    const stories = await expectStoriesAlternate(request, code, 3)
    expect(stories[s0.id][2]).toMatchObject({ turn_user_id: s2.id, prompt: 'an apple?', timed_out: false })
    expect(stories[s1.id][1]).toMatchObject({ turn_user_id: s2.id, timed_out: false })
    expect(stories[s1.id][1].drawing).not.toBe('')
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// The round timer is the turn's own: it keeps running while the player looks
// at the table, and when it runs out what they had is sent, as on screen.
test('any order: a turn set aside for the table still times out, keeping its work', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { code, contexts, alpha, bravo } = await twoOnDrawings(browser, { timed: true, seconds: 12 })
  try {
    await submitDrawing(alpha)

    // bravo picks a picture, doesn't send it, and goes to look at the table.
    await bravo.getByRole('tab', { name: /Upload Photo/ }).click()
    await bravo.locator('#fileInput').setInputFiles({ name: 'd.png', mimeType: 'image/png', buffer: PNG_PIXEL })
    await expect(bravo.locator('.v-window-item--active').getByRole('button', { name: 'Submit' })).toBeVisible()
    await lookAtTable(bravo)
    await expect(bravo.locator('textarea')).toHaveCount(0)

    await expect(bravo.getByText("Time's up on alpha's notebook.")).toBeVisible({ timeout: 20_000 })
    await bravo.waitForURL(/\/review$/, { timeout: 15_000 })

    const turns = await turnsBy(request, code)
    expect(turns.bravo[1]).toMatchObject({ is_drawing: true, timed_out: true, skipped: false })
    expect(turns.bravo[1].drawing).not.toBe('')
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// End Game's countdown covers a turn set aside: the player gets the warning at
// the table, and when it runs out their work is sent.
test('any order: End Game while at the table sends the turn set aside', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { code, contexts, alpha, bravo } = await twoOnDrawings(browser, {})
  try {
    await stroke(bravo)
    await lookAtTable(bravo)

    await alpha.getByRole('button', { name: 'Manage players' }).click()
    alpha.once('dialog', (d) => d.accept())
    await alpha.getByRole('button', { name: 'End Game' }).click()
    await expect(bravo.getByText('The host is ending the game!')).toBeVisible()
    // Still at the table, with the way back to the turn set aside
    await expect(bravo.getByText('Around the table')).toBeVisible()
    await expect(bravo.getByRole('button', { name: 'Back to my turn' })).toBeVisible()

    await submitDrawing(alpha)
    await bravo.waitForURL(/\/review$/, { timeout: 20_000 })
    await expect(bravo.getByText("Time's up! The game is over.")).toBeVisible()

    const turns = await turnsBy(request, code)
    expect(turns.bravo[1]).toMatchObject({ is_drawing: true, timed_out: true, skipped: false })
    expect(turns.bravo[1].drawing).not.toBe('')
    expect(turns.alpha[1]).toMatchObject({ is_drawing: true, timed_out: false })
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A host skip covers every turn a player owes: the one on screen and the ones
// set aside. None of them is ever written by the player afterwards.
test('any order: a host skip takes the turns set aside too', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { code, contexts, host, seats } = await startThreePlayerGame(browser, request)
  const [s0, s1, s2] = seats
  try {
    await submitWord(s0.page, 'apple')
    await submitWord(s1.page, 'banana')
    await submitWord(s2.page, 'cherry')
    await expect(drawPrompt(s1.page)).toHaveText('apple', { timeout: 15_000 })
    await submitDrawing(s1.page)
    await expect(menu(s2.page)).toContainText('2', { timeout: 15_000 })
    // s2 opens both and leaves the drawing set aside, half done
    await stroke(s2.page)
    await pick(s2.page, s0.name)
    await s2.page.locator('textarea').fill('a gues')

    await hostAct(host, s2.name, 'skip')
    // Those were s2's last turns: they're done.
    await s2.page.waitForURL(/\/review$/, { timeout: 15_000 })

    const turns = await turnsBy(request, code)
    expect(turns[s2.name].filter((t) => !t.skipped)).toHaveLength(1) // just the opening word
    expect(turns[s2.name].filter((t) => t.skipped)).toHaveLength(2)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
