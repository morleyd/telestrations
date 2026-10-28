import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame, expectStoriesAlternate, stroke, storyItem, playerIds } from './helpers.js'

// Timed rounds. When the timer runs out, partial work is submitted as the
// player's turn; with nothing entered the server skips the turn (an opening
// word gets a random word). During play these look like any other turn; the
// review marks them "ran out of time".

const SECONDS = 5

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

    // Drawings: alpha draws a little, then goes to Upload Photo and never
    // submits; bravo leaves it blank. Time's up sends alpha's drawing though
    // the tab on screen is empty. Bravo is drawing alpha's random word, shown
    // like any word: no banner.
    await expect(alpha.getByRole('tab', { name: /Upload Photo/ })).toBeVisible({ timeout: 15_000 })
    await stroke(alpha)
    await alpha.getByRole('tab', { name: /Upload Photo/ }).click()
    await expect(bravo.getByRole('tab', { name: /Upload Photo/ })).toBeVisible()
    await expect(bravo.getByText(/ran out of time/i)).toHaveCount(0)

    await Promise.all([alpha.waitForURL(/\/review$/, { timeout: 20_000 }), bravo.waitForURL(/\/review$/, { timeout: 20_000 })])

    // What was saved.
    const stories = await expectStoriesAlternate(request, code, 2)
    const id = await playerIds(request, code)
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
    await storyItem(alpha, 'alpha').click()
    await expect(alpha.getByText('⏱ Ran out of time, so we picked a random word')).toBeVisible()
    await storyItem(alpha, 'bravo').click()
    await expect(alpha.getByText('⏱ Ran out of time', { exact: true })).toBeVisible()
    await expect(alpha.locator('.v-carousel').getByText('pea')).toBeVisible()
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A long round runs to its last second. The timer once stopped when its
// rounded-up percent reached 0, which for a round over five minutes is a
// second or more early (ten minutes: four). On a paused clock, a five-minute
// round's turn is still open with one second left, and times out on the next.
test('a five-minute round times out when its clock does, not before', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.install()
  await createGame(page, { username: 'solo', timed: true, seconds: 300 })
  await startGame(page, 1)
  await expect(page.getByText('Enter your starting prompt')).toBeVisible()
  const timeouts = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/timeout')) timeouts.push(r)
  })

  // The seconds the timer shows ("4:58"), and a clock that only moves when
  // told. Stepped to the timer's next tick, so its phase is known.
  const timer = page.locator('.timer')
  const secondsLeft = async () =>
    (await timer.textContent()).trim().split(':').reduce((s, part) => s * 60 + Number(part), 0)
  await page.clock.pauseAt(new Date(Date.now() + 1000))
  const shown = await secondsLeft()
  while (await secondsLeft() === shown) await page.clock.runFor(100)
  const left = await secondsLeft()

  // To the tick that leaves one second: the old timer had finished by then.
  await page.clock.runFor((left - 1) * 1000 + 400)
  await page.waitForTimeout(1000)
  expect(timeouts).toHaveLength(0)

  await page.clock.runFor(1000)
  await expect.poll(() => timeouts.length).toBe(1)
})
