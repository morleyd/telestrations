import { test, expect } from '@playwright/test'
import {
  createGame, joinGame, startGame, startThreePlayerGame, submitWord, seatOf, notebooksOf, PB_URL,
} from './helpers.js'

// The waiting screen sits everyone round a table, each with the notebooks
// waiting on them, and says what they're doing.

test('everyone sits round the table in turn order, with the notebooks in front of whoever they wait on', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [me, next, last] = seats
  try {
    await submitWord(me.page, 'a teapot')
    const page = me.page
    await expect(page.locator('.waiting-table--round')).toBeVisible()
    await expect(page.locator('.seat-name')).toHaveText([`${me.name} (you)`, next.name, last.name])

    // My notebook went to the next player, who is still on their own opening
    // word; the last player is on theirs. Mine comes back from the last.
    await expect(notebooksOf(page, next.name)).toHaveCount(2)
    await expect(notebooksOf(page, last.name)).toHaveCount(1)
    await expect(notebooksOf(page, me.name)).toHaveCount(0)
    await expect(seatOf(page, next.name).locator('.seat-status-text')).toHaveText('Writing…')
    await expect(seatOf(page, next.name).locator('.seat-pile')).toHaveText('+1')
    await expect(seatOf(page, last.name).locator('.seat-status')).toHaveText('Writing…')
    await expect(seatOf(page, me.name).locator('.seat-status')).toHaveText(`Waiting on ${last.name}`)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

test('a notebook passed on slides to the next player rather than vanishing and reappearing', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [me, next, last] = seats
  try {
    await submitWord(me.page, 'a teapot')
    const page = me.page
    await expect(notebooksOf(page, next.name)).toHaveCount(2)
    // The next player's own story: the one with no turns yet, on top.
    const stories = await notebooksOf(page, next.name).evaluateAll((els) => els
      .sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))
      .map((el) => el.dataset.story))
    const theirs = page.locator(`.story-paper[data-story="${stories[0]}"]`)
    const handle = await theirs.elementHandle()
    // Every slide, by story
    await page.evaluate(() => {
      window.slid = []
      const animate = Element.prototype.animate
      Element.prototype.animate = function (...args) {
        if (this.dataset?.story) window.slid.push(this.dataset.story)
        return animate.apply(this, args)
      }
    })

    // They write their word and pass it on.
    await submitWord(next.page, 'a kite')
    await expect(theirs).toHaveAttribute('data-holder', last.name)
    expect(await handle.evaluate((el) => el.isConnected)).toBe(true)
    expect(await page.evaluate(() => window.slid)).toContain(stories[0])
    // Now they draw mine.
    await expect(seatOf(page, next.name).locator('.seat-status')).toHaveText('Drawing…')
    await expect(notebooksOf(page, last.name)).toHaveCount(2)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// Every screen: the round table on a wide one, the long one on a phone, and
// either way nothing off screen or on top of anything else, a long name cut
// short rather than wrapped, and each player's notebook just touching them.
test('the waiting screen fits its table on every screen', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [host, long, short] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(long, code, 'Bartholomew Fizzlewick')
    await joinGame(short, code, 'Jo')
    await startGame(host, 3)
    await Promise.all([long.waitForURL(/\/draw$/), short.waitForURL(/\/draw$/)])
    await host.waitForTimeout(2000)
    await submitWord(host, 'a teapot')
    await expect(host.locator('.story-paper')).toHaveCount(3)

    for (const width of [360, 390, 600, 800, 1000, 1440]) {
      await host.setViewportSize({ width, height: 800 })
      const kind = width >= 960 ? 'round' : 'long'
      await expect(host.locator(`.waiting-table--${kind}`)).toBeVisible()
      // The avatars change size smoothly to the new table's: let them get
      // there. (The pencils don't count: they're SVG animations.)
      await host.waitForFunction(() => document.getAnimations().length === 0)
      // Read in one go: nothing moves between measurements.
      const shot = await host.evaluate(() => {
        const box = (el) => el.getBoundingClientRect()
        const seats = [...document.querySelectorAll('.seat')].map((seat) => {
          const name = seat.querySelector('.seat-name')
          return {
            player: seat.dataset.player,
            avatar: box(seat.querySelector('.avatar-cut')),
            label: box(seat.querySelector('.seat-label')),
            name: { ...box(name).toJSON(), lineHeight: parseFloat(getComputedStyle(name).lineHeight) },
          }
        })
        // The top notebook of each pile, and its size before it's turned
        const tops = {}
        for (const el of document.querySelectorAll('.story-paper')) {
          const top = tops[el.dataset.holder]
          if (!top || Number(el.style.zIndex) > top.z) {
            tops[el.dataset.holder] = { z: Number(el.style.zIndex), box: box(el), h: el.offsetHeight }
          }
        }
        return { seats, tops, scrollWidth: document.documentElement.scrollWidth }
      })
      const at = `at ${width}px`
      expect(shot.scrollWidth, `no sideways scroll ${at}`).toBeLessThanOrEqual(width)
      const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
      for (const seat of shot.seats) {
        const who = `${seat.player} ${at}`
        expect(seat.label.left, `name on screen: ${who}`).toBeGreaterThanOrEqual(0)
        expect(seat.label.right, `name on screen: ${who}`).toBeLessThanOrEqual(width)
        expect(seat.name.height, `name on one line: ${who}`).toBeLessThan(seat.name.lineHeight * 1.5)
        for (const other of shot.seats) {
          expect(overlap(seat.label, other.avatar), `${seat.player}'s name clear of ${other.player}: ${at}`).toBe(false)
          if (other !== seat) expect(overlap(seat.label, other.label), `names apart: ${who}`).toBe(false)
        }
        for (const [holder, top] of Object.entries(shot.tops)) {
          expect(overlap(seat.label, top.box), `${seat.player}'s name clear of ${holder}'s notebook: ${at}`).toBe(false)
        }
        const top = shot.tops[seat.player]
        if (!top) continue
        const middle = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
        const [a, p] = [middle(seat.avatar), middle(top.box)]
        const gap = Math.hypot(a.x - p.x, a.y - p.y) - seat.avatar.width / 2 - top.h / 2
        expect(gap, `notebook touching ${who}`).toBeGreaterThanOrEqual(-1)
        expect(gap, `notebook touching ${who}`).toBeLessThanOrEqual(3)
      }
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

test('a player can switch to the list of stories instead, and it stays that way', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [me, next, last] = seats
  try {
    await submitWord(me.page, 'a teapot')
    const page = me.page
    await expect(page.locator('.seat')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'List' }).click()
    await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.waiting-table')).toHaveCount(0)
    // A row per story, by who started it, saying who it's waiting on
    const row = (name) => page.locator('.story-row')
      .filter({ has: page.locator('.story-name', { hasText: new RegExp(`^${name}$`) }) })
    await expect(page.locator('.story-row')).toHaveCount(3)
    await expect(row(me.name).locator('.story-waiting')).toHaveText(`Waiting on ${next.name}`)
    await expect(row(next.name).locator('.story-waiting')).toHaveText(`Waiting on ${next.name}`)
    await expect(row(last.name).locator('.story-waiting')).toHaveText(`Waiting on ${last.name}`)

    // Still the list after a reload
    await page.reload()
    await expect(page.locator('.story-row')).toHaveCount(3)
    await expect(page.locator('.waiting-table')).toHaveCount(0)

    await page.getByRole('button', { name: 'Table' }).click()
    await expect(page.locator('.seat')).toHaveCount(3)
    await expect(page.locator('.story-row')).toHaveCount(0)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A big game: n players, one round, steps turns taken, by whoever holds a
// story; slow players rarely, so stories pile up in front of them.
function bigGame(n, slow, steps, meId) {
  let seed = n * 7919
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const stories = Array.from({ length: n }, (_, i) => ({ starter: i, at: i, taken: 0 }))
  for (let k = 0; k < steps; k++) {
    const holders = [...new Set(stories.filter((s) => s.taken < n).map((s) => s.at))]
    const weights = holders.map((h) => (slow.includes(h) ? 0.04 : 1))
    let r = random() * weights.reduce((a, b) => a + b, 0)
    const h = holders.find((_, i) => (r -= weights[i]) < 0) ?? holders.at(-1)
    const story = stories.filter((s) => s.at === h && s.taken < n).sort((a, b) => a.taken - b.taken)[0]
    story.taken++
    story.at = (story.at + 1) % n
  }
  const busy = new Set(stories.filter((s) => s.taken < n).map((s) => s.at))
  const mine = [...Array(n).keys()].find((i) => !busy.has(i))
  const ids = Array.from({ length: n }, (_, i) => (i === mine ? meId : `big${n}p${i}`))
  const names = ids.map((_, i) => (i === mine ? 'Dani' : i % 5 === 2 ? `Player With A Long Name ${i}` : `P${i}`))
  return {
    players: ids.map((id, i) => ({
      id, username: names[i], color: `hsl(${(i * 47) % 360}, 70%, 65%)`, avatar: '',
      dropped: false, has_story: true, finished: stories.every((s) => (i - s.starter + n) % n < s.taken),
    })),
    rows: stories.map((s, k) => ({
      id: String(k + 1), story_id: `big${n}s${k}`, starter_user_id: ids[s.starter], turns_taken: s.taken,
      total_turns: n, total_players: n, next_user_id: s.taken < n ? ids[s.at] : '',
      prev_prompt: s.taken % 2 ? 'a word' : '',
    })),
  }
}

// Big games, on every screen: the round table while it fits, then the one with
// two sides, and the long one on a phone. Either way no name runs into another
// name or avatar, and nothing's off the side of the screen. The game is real,
// but Dani's reads of the players and the progress are answered with a bigger
// one.
test('big games fit at the table on every screen', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [page, other] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(page, { username: 'Dani' })
    await joinGame(other, code, 'Buddy')
    await startGame(page, 2)
    await other.waitForURL(/\/draw$/)
    await page.waitForTimeout(2000)
    await submitWord(page, 'a teapot')
    const users = await (await request.get(
      `${PB_URL}/api/collections/users/records?filter=${encodeURIComponent(`game_id.game_code="${code}"&&username="Dani"`)}`,
    )).json()
    const meId = users.items[0].id

    let game = null
    await page.route((url) => /\/api\/games\/[^/]+\/players$/.test(url.pathname),
      (route) => route.fulfill({ json: { players: game.players } }))
    await page.route((url) => url.pathname.endsWith('/api/collections/progress/records') &&
      Boolean(url.searchParams.get('filter')?.includes('game_code')),
    (route) => route.fulfill({ json: { page: 1, perPage: 500, totalItems: -1, totalPages: -1, items: game.rows } }))

    for (const [n, slow, steps] of [[16, [4, 11], 30], [24, [5, 17], 50]]) {
      game = bigGame(n, slow, steps, meId)
      for (const width of [390, 1000, 1440]) {
        await page.setViewportSize({ width, height: 800 })
        await expect(page.locator('.seat')).toHaveCount(n, { timeout: 15_000 })
        const kinds = width < 960 ? ['long'] : n === 24 && width === 1000 ? ['sides'] : ['round', 'sides']
        await expect.poll(() => page.locator('.waiting-table').getAttribute('class'))
          .toMatch(new RegExp(`waiting-table--(${kinds.join('|')})`))
        await page.waitForFunction(() => document.getAnimations().length === 0)
        const shot = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          seats: [...document.querySelectorAll('.seat')].map((seat) => ({
            player: seat.dataset.player,
            avatar: seat.querySelector('.avatar-cut').getBoundingClientRect().toJSON(),
            label: seat.querySelector('.seat-label').getBoundingClientRect().toJSON(),
          })),
        }))
        const at = `${n} players at ${width}px`
        expect(shot.scrollWidth, `no sideways scroll, ${at}`).toBeLessThanOrEqual(width)
        const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
        for (const seat of shot.seats) {
          expect(seat.label.left, `${seat.player}'s name on screen, ${at}`).toBeGreaterThanOrEqual(0)
          expect(seat.label.right, `${seat.player}'s name on screen, ${at}`).toBeLessThanOrEqual(width)
          for (const other of shot.seats) {
            if (other === seat) continue
            expect(overlap(seat.label, other.label), `${seat.player} and ${other.player}'s names, ${at}`).toBe(false)
            expect(overlap(seat.label, other.avatar), `${seat.player}'s name and ${other.player}, ${at}`).toBe(false)
          }
        }
      }
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
