import { test, expect } from '@playwright/test'
import {
  createGame, joinGame, startGame, driveGameToReview, expectStoriesAlternate,
  turnState, submitWord, submitDrawing, PB_URL,
} from './helpers.js'

// The core happy path a game night depends on: a real multi-player game played
// end to end through the browser. Three players exercises all three turn UIs —
// the opening prompt, a drawing, and a guess of someone's drawing — plus the
// realtime rotation that hands each story to the next player and the final
// results reveal.
test('three players play a full game and reach the results screen', async ({ browser, request }) => {
  test.setTimeout(120_000)

  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [hostPage, p2Page, p3Page] = await Promise.all(contexts.map((c) => c.newPage()))

  try {
    const code = await createGame(hostPage, { username: 'hosty', timed: false })
    await joinGame(p2Page, code, 'buddy')
    await joinGame(p3Page, code, 'pal')

    // Host waits for the full roster, then starts; everyone lands on a turn.
    await startGame(hostPage, 3)
    await Promise.all([
      p2Page.waitForURL(/\/draw$/, { timeout: 15_000 }),
      p3Page.waitForURL(/\/draw$/, { timeout: 15_000 }),
    ])
    // Let every client's TakeTurn finish mounting (resolve the game, create its
    // opening story) before anyone submits — a human would read the prompt first.
    await hostPage.waitForTimeout(2000)

    // Play it out. Completing means every player took a turn on every story and
    // the rotation routed each one correctly — otherwise a page stalls and
    // driveGameToReview throws.
    const pages = [hostPage, p2Page, p3Page]
    await driveGameToReview(pages)
    for (const page of pages) await expect(page).toHaveURL(/\/review$/)
    await expectStoriesAlternate(request, code, 3)

    // The reveal works: opening a player's story shows its chain of turns.
    await hostPage.locator('.user-item').first().click()
    await expect(hostPage.locator('.v-carousel-item').first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// Regression: a player who falls behind gets several stories queued at once, of
// different types. Moving from the first to the second used to keep the first
// one's screen (guess UI, old drawing, old text) while writing to the second
// story, so a drawing slot got a guess and every later turn in that story was
// shifted by one.
test('a player with a guess and a drawing queued gets the right screen for each', async ({ browser, request }) => {
  test.setTimeout(120_000)

  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()))
  const names = ['alpha', 'bravo', 'charlie']

  try {
    const code = await createGame(pages[0], { username: names[0], timed: false })
    await joinGame(pages[1], code, names[1])
    await joinGame(pages[2], code, names[2])
    await startGame(pages[0], 3)
    await Promise.all([pages[1].waitForURL(/\/draw$/), pages[2].waitForURL(/\/draw$/)])
    await pages[0].waitForTimeout(2000)

    // Stories pass seat 0 → 1 → 2 → 0. Seating is decided server-side at begin,
    // so read it back rather than assuming join order.
    const users = await (await request.get(
      `${PB_URL}/api/collections/users/records?sort=position&filter=${encodeURIComponent(`game_id.game_code="${code}"`)}`,
    )).json()
    const [a, b, c] = users.items.map((u) => pages[names.indexOf(u.username)])

    // Everyone but seat 1 (b) seeds; seat 0 (a) then draws seat 2's word. b is
    // now owed a drawing on a's story and a guess on c's.
    await submitWord(a, 'apple')
    await submitWord(c, 'cat')
    await expect.poll(() => turnState(a), { timeout: 15_000 }).toBe('draw')
    await submitDrawing(a)

    await submitWord(b, 'bee')
    await expect(b.getByText('Enter your starting prompt')).toBeHidden()
    const seen = []
    for (let i = 0; i < 2; i++) {
      // The two queued turns are of different types, so the screen must change
      // between them; waiting for that also rides out the submit → next-turn hop.
      await expect.poll(() => turnState(b), { timeout: 15_000 }).not.toBe(seen.at(-1) ?? 'waiting')
      const state = await turnState(b)
      expect(state).not.toBe('waiting')
      seen.push(state)
      if (state === 'word') {
        // A fresh guess screen, not the previous turn's leftover text.
        await expect(b.locator('textarea').first()).toHaveValue('')
        await submitWord(b, `guess-${i}`)
      } else {
        await submitDrawing(b)
      }
      await b.waitForTimeout(400)
    }
    expect(seen.sort()).toEqual(['draw', 'word'])

    await driveGameToReview([a, b, c])
    await expectStoriesAlternate(request, code, 3)
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()))
  }
})
