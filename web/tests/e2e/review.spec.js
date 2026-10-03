import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { createGame, joinGame, startGame, startThreePlayerGame, driveGameToReview, storyItem, submitDrawing, submitWord } from './helpers.js'

// The review walks through a story one turn per slide. Each slide shows what the
// player was given (the word they drew, or the drawing they guessed) above what
// they made of it, and who made it.

const SCREENS = [
  { width: 390, height: 844 }, // phone
  { width: 844, height: 390 }, // phone on its side
  { width: 1000, height: 600 },
  { width: 1440, height: 900 },
]

// Regression: the drawing was sized to the screen and the name pinned on top of
// it, so on some screen shapes the drawing covered who drew it.
test('each review slide shows its prompt, and the drawing never covers the name', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const { contexts, host, seats } = await startThreePlayerGame(browser, request)
  try {
    await driveGameToReview(seats.map((s) => s.page))
    const visible = (selector) => host.locator(`${selector}:visible`)
    const next = async () => {
      await host.locator('.v-window__right').click()
      // Wait out the slide transition, when both slides are on screen.
      await expect(visible('.v-window-item')).toHaveCount(1)
    }
    const openStory = async () => {
      // On a phone, picking a story closes the list.
      if (await host.locator('.mdi-menu').isVisible()) await host.locator('.mdi-menu').click()
      await host.locator('.user-item').first().click()
      await expect(visible('.v-window-item')).toHaveCount(1)
    }

    // The opening word was made from nothing.
    await openStory()
    await expect(visible('.slide-prompt')).toHaveCount(0)
    const word = (await visible('.slide-main').innerText()).trim()
    expect(word).not.toBe('')

    // The drawing shows the word it was drawn from.
    await next()
    await expect(visible('.slide-prompt')).toContainText(word)
    const drawing = await visible('.slide-drawing').getAttribute('src')

    // The guess shows the drawing it was guessed from.
    await next()
    await expect(visible('.slide-thumb')).toHaveAttribute('src', drawing)

    // And back. The arrows sit over the strip the slide dots are in, and
    // Playwright clicks only what's on top, so this click, like the next
    // arrow's above, shows the arrows get them.
    await host.locator('.v-window__left').click()
    await expect(visible('.v-window-item')).toHaveCount(1)
    await expect(visible('.slide-drawing')).toHaveAttribute('src', drawing)

    // On every screen, the drawing sits above the name, and the name above the
    // carousel's slide dots.
    for (const screen of SCREENS) {
      await host.setViewportSize(screen)
      await openStory()
      await next()
      const [img, author, dots] = await Promise.all(
        [visible('.slide-drawing'), visible('.slide-author'), host.locator('.v-carousel__controls')]
          .map((l) => l.boundingBox()),
      )
      const at = `${screen.width}x${screen.height}`
      expect(img.y + img.height, `drawing above the name at ${at}`).toBeLessThanOrEqual(author.y)
      expect(author.y + author.height, `name above the dots at ${at}`).toBeLessThanOrEqual(dots.y)
      expect(author.x, `name on screen at ${at}`).toBeGreaterThanOrEqual(0)
      expect(author.x + author.width, `name on screen at ${at}`).toBeLessThanOrEqual(screen.width)
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// The review is open while the game is still going: the host has a button for
// it in Manage players, anyone can use its link, and a player who still has
// turns to play gets back with "Back to game". Once they're done, they aren't
// offered it.
test('the review is open mid-game, and players can get back to the game', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)
    await submitWord(host, 'a teapot')

    // The host looks at the stories so far.
    await host.getByRole('button', { name: 'Manage players' }).click()
    await host.getByRole('button', { name: 'View results' }).click()
    await host.waitForURL(/\/review$/)
    await expect(storyItem(host, 'hosty')).toContainText('1 / 2')
    await storyItem(host, 'hosty').click()
    await expect(host.locator('.v-carousel').getByText('a teapot')).toBeVisible()

    // buddy opens the link mid-turn, and goes back to it.
    await guest.goto(`/${code}/review`)
    await expect(storyItem(guest, 'buddy')).toContainText('0 / 2')
    await guest.getByRole('link', { name: 'Back to game' }).click()
    await guest.waitForURL(/\/draw$/)
    await expect(guest.getByText('Enter your starting prompt')).toBeVisible()

    // So does the host, and they play it out.
    await host.getByRole('link', { name: 'Back to game' }).click()
    await host.waitForURL(/\/draw$/)
    await driveGameToReview([host, guest])
    await expect(host.locator('.user-item').first()).toBeVisible()
    await expect(host.getByRole('link', { name: 'Back to game' })).toHaveCount(0)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A player who finishes while others are still playing is sent to the review,
// and a playtester took its empty space for a bug: before a story is open it
// says what's going on, and every story in the list says who it's waiting on.
// So does the waiting screen, under each bar (a tooltip nobody found, before).
test('a player who finishes early is told so, and sees who each story is waiting on', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)

    // Both stories wait on buddy: a drawing of the host's word, and buddy's own.
    await submitWord(host, 'a teapot')
    await expect(host.locator('.story-waiting')).toHaveText(['Waiting on buddy', 'Waiting on buddy'])

    // The host draws buddy's word, and that's all their turns.
    await submitWord(guest, 'a kite')
    await expect(host.getByRole('tab', { name: /Upload Photo/ })).toBeVisible()
    await submitDrawing(host)
    await host.waitForURL(/\/review$/)
    const intro = host.locator('.review-intro')
    await expect(intro).toContainText("You've finished all your turns!")
    await expect(storyItem(host, 'hosty')).toContainText('Waiting on buddy')
    await expect(storyItem(host, 'buddy')).toContainText('Done')

    // On a phone the list leaves too little room beside it, so it's in the list.
    await host.setViewportSize({ width: 390, height: 844 })
    await expect(host.locator('.v-alert.review-intro')).toContainText("You've finished all your turns!")
    // With the list closed it's where a story would be, with a way back.
    await host.locator('.mdi-close').click()
    await expect(host.locator('.v-alert.review-intro')).toHaveCount(0)
    await host.getByRole('button', { name: 'Show the stories' }).click()
    await expect(storyItem(host, 'hosty')).toBeVisible()
    await host.setViewportSize({ width: 1280, height: 720 })

    // buddy, still to draw, looks in: the story they owe a turn says so.
    await guest.goto(`/${code}/review`)
    await expect(guest.locator('.review-intro')).toContainText('The stories so far')
    await expect(storyItem(guest, 'hosty')).toContainText('Waiting on you')
    await guest.getByRole('link', { name: 'Back to game' }).click()
    await expect(guest.getByRole('tab', { name: /Upload Photo/ })).toBeVisible()
    await submitDrawing(guest)
    await guest.waitForURL(/\/review$/)

    // The host, still looking, hears the game is over.
    await expect(intro).toContainText("That's the game!")
    await expect(storyItem(host, 'hosty')).toContainText('Done')

    // Opening a story replaces it.
    await storyItem(host, 'hosty').click()
    await expect(host.locator('.v-carousel').getByText('a teapot')).toBeVisible()
    await expect(intro).toHaveCount(0)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A read of the stories' progress that fails keeps the list it had, on the
// waiting screen and on the review (where losing it broke the page), and a
// review whose first read fails tries again. Only the full read fails: the turn
// page's own read of what it owes is left alone.
test('a failed progress read keeps the list it had, and the review tries again', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  const errors = []
  host.on('pageerror', (e) => errors.push(e.message))
  const fullProgress = (url) => url.pathname.endsWith('/api/collections/progress/records') &&
    Boolean(url.searchParams.get('filter')?.includes('game_code'))
  let failed = 0
  const failWith = (message) => (route) => {
    failed++
    return route.fulfill({ status: 500, json: { message } })
  }
  const down = failWith('progress is down')
  const downAgain = failWith('progress is down again')
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)
    await submitWord(host, 'a teapot')
    const waiting = host.locator('.story-waiting')
    await expect(waiting).toHaveText(['Waiting on buddy', 'Waiting on buddy'])

    // The waiting screen refreshes while the host waits. Wait for a second
    // failed read: the first is counted before the page has handled it.
    await host.route(fullProgress, down)
    await expect.poll(() => failed, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    await expect(waiting).toHaveText(['Waiting on buddy', 'Waiting on buddy'])

    // Still failing as the review opens: nothing to show yet, until a retry
    // gets through.
    await host.goto(`/${code}/review`)
    await expect(host.locator('.v-snackbar')).toContainText('progress is down')
    await expect(host.locator('.user-item')).toHaveCount(0)
    await expect(host.locator('.review-intro')).toHaveCount(0)
    await host.unroute(fullProgress, down)
    await expect(host.locator('.review-intro')).toContainText('The stories so far', { timeout: 15_000 })
    await expect(storyItem(host, 'hosty')).toContainText('Waiting on buddy')
    await expect(storyItem(host, 'buddy')).toContainText('Waiting on buddy')

    // Then a refresh fails.
    await host.route(fullProgress, downAgain)
    await expect(host.locator('.v-snackbar')).toContainText('progress is down again', { timeout: 15_000 })
    await expect(storyItem(host, 'hosty')).toContainText('Waiting on buddy')
    await expect(storyItem(host, 'buddy')).toContainText('Waiting on buddy')
    await expect(host.locator('.review-intro')).toContainText('The stories so far')
    // A render that throws leaves the old rows on screen, so this is what
    // shows the page broke.
    expect(errors).toEqual([])
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// The review re-reads the progress now and then, and the list can't be drawn
// without the players' names: a slow read of the names mustn't let the
// progress in first. And the poll waits for a slow read rather than cancel it
// for another as slow, which would never let one land.
test('the review waits for the players\' names before listing the stories', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [host, guest, viewer] = await Promise.all(contexts.map((c) => c.newPage()))
  const errors = []
  viewer.on('pageerror', (e) => errors.push(e.message))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)

    // Longer than Review.vue's POLL_MS, so the poll fires while the names,
    // and then the progress, are still on the way.
    const slow = async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 7000))
      return route.continue().catch(() => {}) // cancelled meanwhile
    }
    await viewer.route((url) => url.pathname.endsWith('/api/collections/users/records'), slow)
    await viewer.route((url) => url.pathname.endsWith('/api/collections/progress/records'), slow)
    await viewer.goto(`/${code}/review`)
    await expect(storyItem(viewer, 'hosty')).toContainText('Waiting on hosty', { timeout: 25_000 })
    await expect(storyItem(viewer, 'buddy')).toContainText('Waiting on buddy')
    expect(errors).toEqual([])
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// Two progress reads can overlap: a turn taken while one is on its way starts
// another, which cancels the first. The poll must still see the second as on
// its way, or it cancels that for a third, and so on, and none lands.
test('a progress read started while another is on its way still lands', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [host, guest, viewer] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)

    // Each read held longer than Review.vue's POLL_MS (keep it so). Overlap:
    // a read arrived while another was still held.
    const progress = (url) => url.pathname.endsWith('/api/collections/progress/records')
    let held = 0
    let overlapped = false
    await viewer.route(progress, async (route) => {
      if (held) overlapped = true
      held++
      await new Promise((resolve) => setTimeout(resolve, 7000))
      held--
      return route.continue().catch(() => {}) // cancelled meanwhile
    })
    const subscribed = viewer.waitForResponse((r) => r.url().endsWith('/api/realtime') && r.request().method() === 'POST')
    const firstRead = viewer.waitForRequest((r) => progress(new URL(r.url())))
    await viewer.goto(`/${code}/review`)
    await Promise.all([subscribed, firstRead])
    // The turn's event starts a second read while the first is on its way.
    // Without that, the first could land showing the turn and pass alone.
    await submitWord(host, 'a teapot')
    await expect.poll(() => overlapped, { timeout: 6000 }).toBe(true)
    await expect(storyItem(viewer, 'hosty')).toContainText('Waiting on buddy', { timeout: 25_000 })
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A failed read of the players' names is tried again. The review's list used
// to stay empty for good, and End Game went unnoticed; a turn taken meanwhile
// mustn't list the stories without their names either. The waiting screen
// showed its stories nameless until the player's next turn.
test('a failed read of the players\' names is tried again, on the review and the waiting screen', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [host, guest, viewer] = await Promise.all(contexts.map((c) => c.newPage()))
  const errors = []
  viewer.on('pageerror', (e) => errors.push(e.message))
  const names = (url) => url.pathname.endsWith('/api/collections/users/records')
  const down = (route) => route.fulfill({ status: 500, json: { message: 'names are down' } })
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)

    await Promise.all([host, viewer].map((page) => page.route(names, down)))
    // Subscribed once the realtime connection has sent what it's listening for.
    const subscribed = viewer.waitForResponse((r) => r.url().endsWith('/api/realtime') && r.request().method() === 'POST')
    await viewer.goto(`/${code}/review`)
    await expect(viewer.locator('.v-snackbar')).toContainText('names are down')
    await subscribed
    await submitWord(host, 'a teapot')
    await expect(host.locator('.story-waiting')).toHaveText(['Waiting on someone', 'Waiting on someone'])
    await expect(host.locator('.story-name')).toHaveText(['', ''])
    await expect(viewer.locator('.user-item')).toHaveCount(0)

    await Promise.all([host, viewer].map((page) => page.unroute(names, down)))
    await expect(storyItem(viewer, 'hosty')).toContainText('Waiting on buddy', { timeout: 15_000 })
    await expect(storyItem(viewer, 'buddy')).toContainText('Waiting on buddy')
    await expect(host.locator('.story-waiting')).toHaveText(['Waiting on buddy', 'Waiting on buddy'])
    await expect(host.locator('.story-name').filter({ hasText: /^buddy$/ })).toHaveCount(1)
    await expect(host.locator('.story-name').filter({ hasText: /^hosty$/ })).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A review left while it's still reading the game stops there. It used to
// start its poll and subscriptions once the read landed, after it had gone,
// and read the progress every few seconds from then on.
test('a review left before it has loaded stops reading', async ({ page }) => {
  test.setTimeout(60_000)
  const code = await createGame(page, { username: 'hosty' })
  let release
  const held = new Promise((resolve) => { release = resolve })
  const games = (url) => url.pathname.endsWith('/api/collections/games/records')
  await page.route(games, async (route) => {
    await held
    return route.continue().catch(() => {}) // the page may have dropped it
  })
  await page.goto(`/${code}/review`)
  await expect(page.locator('.review-sidebar')).toBeVisible()
  await page.locator('.v-app-bar .mdi-home').click()
  await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible()

  const reads = []
  page.on('request', (r) => {
    if (/\/api\/(collections\/(progress|users|turns)\/records|realtime)/.test(r.url())) reads.push(r.url())
  })
  release()
  await page.unroute(games)
  // Longer than Review.vue's POLL_MS.
  await page.waitForTimeout(7000)
  expect(reads).toEqual([])
})

// The waiting screen's rows line up at every width: each story's avatar, name
// and bar on one line, the bars starting at the same place and wide enough to
// read, and a long name wrapping between its words, never inside one.
test('the waiting screen lines up its rows at every width', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [host, long, short] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(long, code, 'Bartholomew Fizzlewick')
    await joinGame(short, code, 'Jo')
    await startGame(host, 3)
    await submitWord(host, 'a teapot')
    for (const name of ['hosty', 'Bartholomew Fizzlewick', 'Jo']) {
      await expect(host.locator('.story-name').filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(1)
    }

    for (const width of [360, 390, 600, 800, 1000, 1440]) {
      await host.setViewportSize({ width, height: 700 })
      // Read in one go: nothing moves between measurements.
      const rows = await host.locator('.story-row').evaluateAll((els) => els.map((row) => {
        const box = (sel) => row.querySelector(sel).getBoundingClientRect()
        const middle = (r) => r.top + r.height / 2
        const [avatar, name, bar] = ['.avatar-cut', '.story-name', '.v-progress-linear'].map(box)
        // Each word of the name, by how many lines it's on.
        const text = row.querySelector('.story-name').firstChild
        let at = 0
        const lines = text.data.split(' ').map((word) => {
          const range = document.createRange()
          range.setStart(text, at)
          range.setEnd(text, at + word.length)
          at += word.length + 1
          return [word, range.getClientRects().length]
        })
        return { avatar: middle(avatar), name: middle(name), bar: middle(bar), left: bar.left, right: bar.right, lines }
      }))
      for (const row of rows) {
        const at = `${row.lines.map(([w]) => w).join(' ')} at ${width}px`
        expect(Math.abs(row.avatar - row.bar), `avatar level with the bar: ${at}`).toBeLessThanOrEqual(2)
        expect(Math.abs(row.name - row.bar), `name level with the bar: ${at}`).toBeLessThanOrEqual(2)
        expect(row.left, `bars start together: ${at}`).toBeCloseTo(rows[0].left, 0)
        expect(row.right - row.left, `bar wide enough: ${at}`).toBeGreaterThanOrEqual(120)
        expect(row.right, `bar on screen: ${at}`).toBeLessThanOrEqual(width)
        for (const [word, lines] of row.lines) expect(lines, `"${word}" on one line: ${at}`).toBe(1)
      }
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A PNG's width and height, from its header.
function pngSize(bytes) {
  const b = Buffer.from(bytes)
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

// Any player, not just the host, can save a story as an image from the card
// at its end (next still wraps round to the start), or every story at once.
test('any player can download a story, or every story in the game', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const { contexts, seats, host } = await startThreePlayerGame(browser, request)
  try {
    await driveGameToReview(seats.map((s) => s.page))
    const player = seats.find((s) => s.page !== host)
    const page = player.page
    const visible = (selector) => page.locator(`${selector}:visible`)

    await storyItem(page, player.name).click()
    for (let k = 0; k < 3; k++) await page.locator('.v-window__right').click()
    await expect(visible('.v-window-item')).toHaveCount(1)
    await expect(page.getByText(`That's ${player.name}'s story!`)).toBeVisible()
    // The card is about this story; every story at once is in the player list.
    await expect(visible('.v-window-item').getByRole('button', { name: 'Download all stories' })).toHaveCount(0)

    const [story] = await Promise.all([
      page.waitForEvent('download'),
      visible('.v-window-item').getByRole('button', { name: 'Download this story' }).click(),
    ])
    expect(story.suggestedFilename()).toMatch(new RegExp(`^telestrations-[a-z]{5}-${player.name}\\.png$`))
    expect(pngSize(await readFile(await story.path())).width).toBe(800)

    // Next wraps round to the opening word.
    await page.locator('.v-window__right').click()
    await expect(visible('.v-window-item')).toHaveCount(1)
    await expect(page.getByText(`That's ${player.name}'s story!`)).toBeHidden()

    const [all] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#chat-scroll').getByRole('button', { name: 'Download all stories' }).click(),
    ])
    expect(all.suggestedFilename()).toMatch(/^telestrations-[a-z]{5}\.zip$/)
    const files = unzipSync(new Uint8Array(await readFile(await all.path())))
    expect(Object.keys(files).sort()).toEqual(seats.map((s) => `${s.name}.png`).sort())
    for (const bytes of Object.values(files)) expect(pngSize(bytes).width).toBe(800)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
