import { test, expect } from '@playwright/test'
import {
  driveGameToReview, expectStoriesAlternate, turnState, submitWord, hostAct, startThreePlayerGame,
} from './helpers.js'

// The host's mid-game controls (the "Manage players" dialog; see host.go). The
// roster never changes once a game starts; a skipped or dropped player's turns
// are written for them, passing the previous turn on unchanged.

test('host skips a player who is holding up a story', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const { code, contexts, host, hostName, seats } = await startThreePlayerGame(browser, request)
  try {
    // Everyone writes their word; each player then owes a drawing on the story
    // of the seat before them. Skip a non-host player's drawing.
    for (const [i, s] of seats.entries()) await submitWord(s.page, `word-${i}`)
    const target = seats.find((s) => s.name !== hostName)
    await expect.poll(() => turnState(target.page), { timeout: 15_000 }).toBe('draw')
    await hostAct(host, target.name, 'skip')

    // The skipped player is told and moved off that story.
    await expect(target.page.getByText('The host skipped your turn.')).toBeVisible()
    await host.keyboard.press('Escape')

    await driveGameToReview(seats.map((s) => s.page))
    const stories = await expectStoriesAlternate(request, code, 3)
    const skipped = Object.values(stories).flat().filter((t) => t.skipped)
    expect(skipped).toHaveLength(1)
    expect(skipped[0].turn_user_id).toBe(target.id)
    expect(skipped[0].prompt).toMatch(/^word-/) // the word was passed on unchanged
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()))
  }
})

test('host drops a player before they start; everyone else finishes without them', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const { code, contexts, host, hostName, seats } = await startThreePlayerGame(browser, request)
  try {
    const target = seats.find((s) => s.name !== hostName)
    await hostAct(host, target.name, 'drop')
    await expect(host.getByRole('dialog').locator(`[data-player="${target.name}"]`)).toContainText('Dropped')
    await host.keyboard.press('Escape')

    // The dropped player is told, even though they were idle on their first turn.
    await expect(target.page.getByText('The host removed you from this game.')).toBeVisible({ timeout: 15_000 })

    const others = seats.filter((s) => s !== target).map((s) => s.page)
    await driveGameToReview(others)

    // Their empty story is gone; every other story skipped them once. With three
    // seats that covers both kinds of skip: one passes a word on, the other a
    // drawing.
    const stories = await expectStoriesAlternate(request, code, 3, { stories: 2 })
    const skipped = Object.values(stories).flat().filter((t) => t.skipped)
    expect(skipped).toHaveLength(2)
    expect(skipped.every((t) => t.turn_user_id === target.id)).toBe(true)
    expect(skipped.filter((t) => t.drawing)).toHaveLength(1)
    expect(skipped.filter((t) => t.prompt)).toHaveLength(1)
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()))
  }
})
