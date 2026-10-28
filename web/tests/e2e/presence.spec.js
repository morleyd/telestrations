import { test, expect } from '@playwright/test'
import { startThreePlayerGame, submitWord, seatOf, lookAtTable } from './helpers.js'

// The waiting screen says what each player holding notebooks is up to:
// Working (a turn on their screen), Not started (none open: at the table, or
// their turns set aside) or Away (their device has gone quiet). And the host
// sees how long each notebook has been held.

// Seconds of quiet before a player is away, in these tests (normally 60)
const AWAY = 8

const stateOf = (page, name) => seatOf(page, name).locator('.seat-status')

// Three players through their opening words, each on to a drawing.
async function onDrawings(browser, request) {
  const game = await startThreePlayerGame(browser, request, { awaySeconds: AWAY })
  for (const [i, s] of game.seats.entries()) await submitWord(s.page, `word ${i}`)
  for (const s of game.seats) await expect(s.page.locator('.drawing-prompt-text')).toBeVisible({ timeout: 15_000 })
  return game
}

test('presence: on a turn is Working, at the table with notebooks is Not started, a closed tab goes Away', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await onDrawings(browser, request)
  const [s0, s1, s2] = seats
  try {
    // s2 goes to look at the table: the other two are on their drawings, and
    // s2, with a notebook set aside, hasn't started.
    await lookAtTable(s2.page)
    await expect(stateOf(s2.page, s0.name)).toHaveAttribute('data-state', 'working')
    await expect(stateOf(s2.page, s0.name)).toHaveText('Drawing…')
    await expect(stateOf(s2.page, s1.name)).toHaveAttribute('data-state', 'working')
    await expect(stateOf(s2.page, s2.name)).toHaveAttribute('data-state', 'notStarted')
    await expect(stateOf(s2.page, s2.name)).toHaveText('Not started')
    // ...and so says the table s1 sees, when s1 looks too
    await lookAtTable(s1.page)
    await expect(stateOf(s1.page, s2.name)).toHaveAttribute('data-state', 'notStarted')
    await expect(stateOf(s1.page, s1.name)).toHaveAttribute('data-state', 'notStarted')

    // s0 closes their tab with the drawing still to do: away, once quiet long enough.
    await s0.page.context().close()
    await expect(stateOf(s2.page, s0.name)).toHaveAttribute('data-state', 'away', { timeout: (AWAY + 10) * 1000 })
    await expect(stateOf(s2.page, s0.name)).toHaveText('Away')
    // The list says it too, next to who the notebook is waiting on.
    await s2.page.getByRole('button', { name: 'List' }).click()
    const row = s2.page.locator('.story-holder').filter({ hasText: `Waiting on ${s0.name}` })
    await expect(row.locator('.story-state')).toHaveAttribute('data-state', 'away')
    // Back to his drawing, s1 is working again
    await s1.page.getByRole('button', { name: 'Back to my turn' }).click()
    await expect(s2.page.locator('.story-holder').filter({ hasText: `Waiting on ${s1.name}` }).locator('.story-state'))
      .toHaveAttribute('data-state', 'working', { timeout: 15_000 })
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})))
  }
})

// How long a notebook has been with its holder is for the host alone, on the
// table and in the list, and it counts up between reads.
test('presence: only the host sees how long notebooks have been held, and the time ticks', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats, host, hostName } = await onDrawings(browser, request)
  const guest = seats.find((s) => s.name !== hostName)
  try {
    await lookAtTable(host)
    await lookAtTable(guest.page)

    const held = seatOf(host, guest.name).locator('.seat-held')
    await expect(held).toHaveText(/^\d+:\d\d$/)
    const seconds = async () => {
      const [m, s] = (await held.textContent()).trim().split(':').map(Number)
      return m * 60 + s
    }
    const first = await seconds()
    await expect.poll(seconds, { timeout: 10_000 }).toBeGreaterThanOrEqual(first + 2)
    await expect(guest.page.locator('.seat-held')).toHaveCount(0)
    // Every seat with a notebook has one, for the host
    await expect(host.locator('.seat-held')).toHaveCount(3)

    for (const page of [host, guest.page]) await page.getByRole('button', { name: 'List' }).click()
    await expect(host.locator('.story-held')).toHaveCount(3)
    await expect(host.locator('.story-held').first()).toHaveText(/^\d+:\d\d$/)
    await expect(guest.page.locator('.story-held')).toHaveCount(0)
    await expect(guest.page.locator('.story-state')).toHaveCount(3)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A phone that wakes, or a tab brought back, says it's here straight away,
// not at its next heartbeat: its turn may be on screen already, and until
// then it would read as away.
test('presence: a page that comes back into view reports at once', async ({ browser, request }) => {
  test.setTimeout(60_000)
  // A heartbeat every 10s (a third of 30)
  const { contexts, seats } = await startThreePlayerGame(browser, request, { awaySeconds: 30 })
  const { page } = seats[0]
  const report = (timeout) => page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/presence'), { timeout })
  try {
    // Sitting on a turn, nothing reports but the heartbeat: wait for one, and
    // the next is 10s off.
    await expect(page.locator('textarea').first()).toBeVisible()
    await report(15_000)
    const back = report(3_000)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(JSON.parse((await back).postData()).working_on).toMatch(/:0$/)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
