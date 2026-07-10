import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame, driveGameToReview } from './helpers.js'

// The core happy path a game night depends on: a real multi-player game played
// end to end through the browser. Three players exercises all three turn UIs —
// the opening prompt, a drawing, and a guess of someone's drawing — plus the
// realtime rotation that hands each story to the next player and the final
// results reveal.
test('three players play a full game and reach the results screen', async ({ browser }) => {
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

    // The reveal works: opening a player's story shows its chain of turns.
    await hostPage.locator('.user-item').first().click()
    await expect(hostPage.locator('.v-carousel-item').first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
