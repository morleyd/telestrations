import { expect } from '@playwright/test'

const CODE_RE = /\/[a-zA-Z]{5}$/

// Drive the "New Game" dialog on the home screen through to the waiting room.
// Returns the generated 5-letter game code.
// `seconds` sets the round length of a timed game (in seconds).
export async function createGame(page, { username = 'hosty', timed = false, seconds } = {}) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  await page.getByLabel('Username').fill(username)
  if (timed) {
    // v-switch: clicking its label toggles it.
    await page.getByText('Set Timed Rounds').click()
    if (seconds) await page.getByLabel('Round Duration').fill(String(seconds))
  }
  await page.getByRole('button', { name: 'Begin!' }).click()
  await page.waitForURL(CODE_RE)
  return page.url().split('/').pop()
}

// Fill in and submit the home screen's "Join Game" dialog, without assuming
// where it leads (a taken name stops at the rejoin confirmation).
export async function submitJoin(page, code, username) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Join Game' }).click()
  await page.getByLabel('Game Code').fill(code)
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Join!' }).click()
}

// Drive the "Join Game" dialog through to the waiting room.
export async function joinGame(page, code, username) {
  await submitJoin(page, code, username)
  await expect(page).toHaveURL(new RegExp(`/${code}$`, 'i'))
}

// A 1x1 transparent PNG, used as the payload for every "drawing" turn. Uploading
// through the file input is deterministic in a way that driving the freehand
// canvas is not, and the drawing bytes themselves don't matter to the rotation.
export const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYE0k9kAAAAASUVORK5CYII=',
  'base64',
)

// Host starts the game from the waiting room. `expectedPlayers` (optional) waits
// for the roster to fill before starting so we don't begin before joiners land.
export async function startGame(hostPage, expectedPlayers = 1) {
  // Roster rows are avatars numbered 1..N; wait until all seats are present.
  await expect(hostPage.locator('.drag-item')).toHaveCount(expectedPlayers, { timeout: 15_000 })
  await hostPage.getByRole('button', { name: 'Begin!' }).click()
  // The game's realtime update pushes every player (host included) into /draw.
  await hostPage.waitForURL(/\/draw$/, { timeout: 15_000 })
}

// Returns the current actionable state of a TakeTurn page without waiting:
//   'word'    — a prompt / guess turn (the only screen with a <textarea>)
//   'draw'    — a drawing turn (the only screen with an "Upload Photo" tab)
//   'review'  — the player finished and was routed to the results carousel
//   'waiting' — blocked on the player ahead of them; nothing to do yet
export async function turnState(page) {
  if (/\/review$/.test(new URL(page.url()).pathname)) return 'review'
  if (await page.locator('textarea').first().isVisible().catch(() => false)) return 'word'
  if (await page.getByRole('tab', { name: /Upload Photo/ }).isVisible().catch(() => false)) return 'draw'
  return 'waiting'
}

// A turn is only "done" once the backend has persisted it. Wait for the
// successful POST so we never re-submit the same turn while the UI is still
// mid-advance (which would create duplicate turns).
const turnCreated = (page) =>
  page.waitForResponse(
    (r) => /\/api\/collections\/turns\/records/.test(r.url()) && r.request().method() === 'POST' && r.status() === 200,
    { timeout: 20_000 },
  )

export async function submitWord(page, text) {
  await page.locator('textarea').first().fill(text)
  await Promise.all([turnCreated(page), page.getByRole('button', { name: 'Submit' }).click()])
}

export async function submitDrawing(page) {
  await page.getByRole('tab', { name: /Upload Photo/ }).click()
  await page.locator('#fileInput').setInputFiles({ name: 'd.png', mimeType: 'image/png', buffer: PNG_PIXEL })
  // Submitting lives inside the active tab window; scope to it so we never match
  // the (hidden) Submit button belonging to the freehand-draw tab.
  await Promise.all([
    turnCreated(page),
    page.locator('.v-window-item--active').getByRole('button', { name: 'Submit' }).click(),
  ])
}

// Drive every player's page concurrently through a complete game until they have
// all reached the results screen. The app auto-advances each turn over a realtime
// subscription, so we poll: whenever any page is showing an actionable turn we
// act on it, and stop once every page has landed on /review. Throws (failing the
// test) if the game stalls before everyone finishes.
export async function driveGameToReview(pages) {
  const done = new Set()
  const maxIters = pages.length * pages.length * 8 + 60
  for (let iter = 0; iter < maxIters && done.size < pages.length; iter++) {
    let acted = false
    for (let i = 0; i < pages.length; i++) {
      if (done.has(i)) continue
      const state = await turnState(pages[i])
      if (state === 'review') { done.add(i); continue }
      if (state === 'word') { await submitWord(pages[i], `p${i}-t${iter}`); acted = true }
      else if (state === 'draw') { await submitDrawing(pages[i]); acted = true }
      // Pace like a person: don't fire the next player's action on the same tick,
      // and give the backend + realtime a beat to settle after each submit.
      if (acted) await pages[i].waitForTimeout(400)
    }
    // Nobody had a turn ready — wait for the realtime subscriptions to deliver the
    // next prompt before scanning again.
    if (!acted) await pages[0].waitForTimeout(400)
  }
  if (done.size < pages.length) {
    const states = await Promise.all(pages.map(turnState))
    throw new Error(`game stalled: only ${done.size}/${pages.length} reached review (states: ${states.join(', ')})`)
  }
}

// Backend the suite runs against (see playwright.config.js).
export const PB_URL = 'http://127.0.0.1:8091'

// Checks what was actually saved, not just what the screens showed: every story
// has one turn per player, opens with a word and then alternates word/drawing.
// A turn the host skipped instead repeats the one before it (it carries it
// forward). The UI-driving helpers above happily fill in whatever screen is
// shown, so a client that renders the wrong turn type still "finishes" the
// game; this is what catches it. Returns the turns grouped by story starter.
export async function expectStoriesAlternate(request, code, players, { stories = players } = {}) {
  const q = (filter, sort) => `?perPage=500&sort=${sort}&filter=${encodeURIComponent(filter)}`
  const games = await (await request.get(`${PB_URL}/api/collections/games/records${q(`game_code="${code}"`, 'created')}`)).json()
  const gameId = games.items[0].id
  const results = await (await request.get(`${PB_URL}/api/collections/results/records${q(`game_id="${gameId}"`, 'turn_number')}`)).json()
  const byStory = {}
  for (const t of results.items) (byStory[t.starter_id] ||= []).push(t)
  expect(Object.keys(byStory)).toHaveLength(stories)
  for (const [starter, list] of Object.entries(byStory)) {
    const types = list.map((t) => Boolean(t.drawing))
    const want = []
    for (const [i, t] of list.entries()) {
      want.push(i === 0 ? false : t.skipped ? want[i - 1] : !want[i - 1])
    }
    expect(types, `turn types for the story started by ${starter}`).toEqual(want)
    expect(new Set(list.map((t) => t.turn_user_id)).size, `distinct players on story ${starter}`).toBe(players)
  }
  return byStory
}

// Seats in rotation order (stories pass seat 0 -> 1 -> ...), mapped back to the
// test's pages by username. Seating is decided server-side at begin.
export async function seatedPages(request, code, pagesByName) {
  const users = await (await request.get(
    `${PB_URL}/api/collections/users/records?sort=position,id&filter=${encodeURIComponent(`game_id.game_code="${code}"`)}`,
  )).json()
  return users.items.map((u) => ({ name: u.username, id: u.id, page: pagesByName[u.username] }))
}

// Open the host's "Manage players" dialog and run a skip or drop on one player,
// accepting the confirmation.
export async function hostAct(hostPage, username, action) {
  const dialog = hostPage.getByRole('dialog')
  if (!(await dialog.isVisible())) await hostPage.getByRole('button', { name: 'Manage players' }).click()
  const row = dialog.locator(`[data-player="${username}"]`)
  const button = row.getByRole('button', { name: action === 'drop' ? 'Drop' : 'Skip' })
  await expect(button).toBeEnabled({ timeout: 15_000 })
  hostPage.once('dialog', (d) => d.accept())
  await button.click()
}
