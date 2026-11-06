import { test, expect } from '@playwright/test'
import { startGame, submitWord, submitDrawing, turnState, expectStoriesAlternate } from './helpers.js'

// Play with bots: one person, and three players the server plays, through a
// whole game to the review (see internal/game/bots.go).

test('one person plays a whole game with the bots', async ({ page, request }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Play with bots' }).click()
  await expect(page.getByText('3 bots will join you.')).toBeVisible()
  await page.getByLabel('Username').fill('solo')
  await page.getByRole('button', { name: 'Begin!' }).click()
  await page.waitForURL(/\/[a-z]{5}$/)
  const code = page.url().split('/').pop()

  // The bots are seated with the person.
  for (const name of ['Botticelli', 'Pablo Pixel', 'Frida Circuit']) {
    await expect(page.locator('.drag-item', { hasText: name })).toBeVisible()
  }
  await startGame(page, 4)

  // The person plays their turns; the bots play theirs, a few seconds each.
  const deadline = Date.now() + 200_000
  let turns = 0
  for (;;) {
    const state = await turnState(page)
    if (state === 'review') break
    if (Date.now() > deadline) throw new Error(`no review after ${turns} turns (state: ${state})`)
    if (state === 'word') {
      await submitWord(page, `solo's word ${turns++}`)
    } else if (state === 'draw') {
      await submitDrawing(page)
      turns++
    } else {
      await page.waitForTimeout(500)
    }
  }
  expect(turns).toBe(4)

  // The person is done once their own turns are; the bots may still be
  // finishing other stories. The review says when the whole game is.
  await expect(page.getByText('Game done')).toBeVisible({ timeout: 60_000 })

  // Every story went round all four players, a word then drawings and guesses.
  const stories = await expectStoriesAlternate(request, code, 4)
  const bots = Object.values(stories).flat().filter((t) => /^bot_/.test(t.drawing))
  expect(bots.length).toBeGreaterThan(0)
})
