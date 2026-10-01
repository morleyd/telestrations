import { test, expect } from '@playwright/test'
import { createGame, startGame, driveGameToReview, expectStoriesAlternate, PB_URL } from './helpers.js'

// AI players (ai.go), here backed by the fake provider configured for the test
// server (ai.fake.json): the host seats bots in the waiting room, and the server
// takes their turns, so one human can play a whole game against them.

test('a host plays a full game against two AI players', async ({ page, request }) => {
  test.setTimeout(90_000)
  const code = await createGame(page, { username: 'hosty', timed: false })

  await page.getByRole('button', { name: 'Add AI players' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Personality (optional)').fill('a pirate')
  await dialog.getByLabel('How many seats').fill('2')
  await dialog.getByRole('button', { name: 'Add' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.drag-item')).toHaveCount(3)
  await expect(page.locator('.drag-item', { hasText: '🤖 Fake 2' })).toBeVisible()

  await startGame(page, 3)
  await page.waitForTimeout(1000)
  await driveGameToReview([page])

  // Every story went all the way round, bots included, with the right turn
  // types; bot drawings are real PNG files.
  const stories = await expectStoriesAlternate(request, code, 3)
  const users = await (await request.get(`${PB_URL}/api/collections/users/records?filter=${encodeURIComponent(`game_id.game_code="${code}"`)}`)).json()
  const bots = users.items.filter((u) => u.is_bot)
  expect(bots.map((b) => b.bot_persona)).toEqual(['a pirate', 'a pirate'])
  const botTurns = Object.values(stories).flat().filter((t) => bots.some((b) => b.id === t.turn_user_id))
  expect(botTurns).toHaveLength(6)
  expect(botTurns.every((t) => t.note.startsWith('fake:'))).toBe(true)
  expect(botTurns.filter((t) => t.drawing).length).toBeGreaterThan(0)

  // The review shows a bot's thought with its turn.
  await page.locator('.user-item', { hasText: 'Fake 2' }).click()
  await expect(page.getByText(/🤖 “fake: picked a word”/)).toBeVisible()
})
