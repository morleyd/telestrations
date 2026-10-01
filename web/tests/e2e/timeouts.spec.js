import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame, expectStoriesAlternate, PB_URL } from './helpers.js'

// Timed rounds. When the timer runs out, partial work is submitted as the
// player's turn; with nothing entered the server skips the turn (an opening
// word gets a random word). During play these look like any other turn; the
// review marks them "ran out of time".

const SECONDS = 5

async function stroke(page) {
  const box = await page.locator('canvas').boundingBox()
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  for (let x = 30; x <= 120; x += 10) await page.mouse.move(box.x + x, box.y + 20)
  await page.mouse.up()
}

test('timeouts: partial work is kept, empty turns are skipped, and the review says so', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [alpha, bravo] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(alpha, { username: 'alpha', timed: true, seconds: SECONDS })
    await joinGame(bravo, code, 'bravo')
    await startGame(alpha, 2)
    await bravo.waitForURL(/\/draw$/)

    // Opening words: alpha leaves it empty; bravo types but never submits.
    await expect(bravo.getByText('Enter your starting prompt')).toBeVisible()
    await bravo.locator('textarea').first().fill('pea')
    await expect(alpha.getByText("Time's up!")).toBeVisible({ timeout: 15_000 })

    // Drawings: alpha draws a little and never submits; bravo leaves it blank.
    // Bravo is drawing alpha's random word, shown like any word: no banner.
    await expect(alpha.getByRole('tab', { name: /Upload Photo/ })).toBeVisible({ timeout: 15_000 })
    await stroke(alpha)
    await expect(bravo.getByRole('tab', { name: /Upload Photo/ })).toBeVisible()
    await expect(bravo.getByText(/ran out of time/i)).toHaveCount(0)

    await Promise.all([alpha.waitForURL(/\/review$/, { timeout: 20_000 }), bravo.waitForURL(/\/review$/, { timeout: 20_000 })])

    // What was saved.
    const stories = await expectStoriesAlternate(request, code, 2)
    const users = await (await request.get(`${PB_URL}/api/collections/users/records?filter=${encodeURIComponent(`game_id.game_code="${code}"`)}`)).json()
    const id = Object.fromEntries(users.items.map((u) => [u.username, u.id]))
    const [alphaWord, bravoDrawing] = stories[id.alpha]
    const [bravoWord, alphaDrawing] = stories[id.bravo]
    expect(alphaWord).toMatchObject({ skipped: true, timed_out: true })
    expect(alphaWord.prompt).not.toBe('')
    expect(alphaWord.prompt).not.toBe('alpha') // not the username any more
    expect(bravoDrawing).toMatchObject({ skipped: true, timed_out: true, prompt: alphaWord.prompt, drawing: '' })
    expect(bravoWord).toMatchObject({ skipped: false, timed_out: true, prompt: 'pea' })
    expect(alphaDrawing).toMatchObject({ skipped: false, timed_out: true })
    expect(alphaDrawing.drawing).not.toBe('')

    // The review marks them.
    await alpha.locator('.user-item', { hasText: 'alpha' }).click()
    await expect(alpha.getByText('⏱ Ran out of time, so we picked a random word')).toBeVisible()
    await alpha.locator('.user-item', { hasText: 'bravo' }).click()
    await expect(alpha.getByText('⏱ Ran out of time', { exact: true })).toBeVisible()
    await expect(alpha.locator('.v-carousel').getByText('pea')).toBeVisible()
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
