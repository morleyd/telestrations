import { test, expect } from '@playwright/test'
import {
  createGame, joinGame, startGame, startThreePlayerGame, submitWord, submitDrawing, turnState, seatOf, notebooksOf,
  PB_URL,
} from './helpers.js'

// The waiting screen sits everyone round a table, each with the notebooks
// waiting on them, and says what they're doing.

// Vuetify's md breakpoint: from this wide up, the table is round (or has two
// sides); below it, the phone's long table
const WIDE = 960

// From now on, keep each notebook's slides, by story, with how many stops each
// makes: window.slides
async function watchSlides(page) {
  await page.evaluate(() => {
    window.slides = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (keyframes, options) {
      if (this.dataset?.story) window.slides.push({ story: this.dataset.story, stops: keyframes.length })
      return animate.call(this, keyframes, options)
    }
  })
}
const slidesOf = (page) => page.evaluate(() => window.slides)

// After a resize: let the waiting screen see its new width and redraw (two
// frames), and the avatars finish changing size. The pencils don't count:
// they're SVG animations.
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

// How far the page, and the waiting screen inside it (which scrolls itself),
// reach past their width
const sidewaysScroll = (page) => page.evaluate(() => {
  const screen = document.querySelector('.waiting-screen')
  return Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    screen.scrollWidth - screen.clientWidth,
  )
})

// A real game puts Dani on the waiting screen, then her page's reads of the
// players and the progress are answered with a made-up game: show(game) swaps
// one in, a { players, rows } (made with fakePlayer and fakeStory, or by
// bigGame). Until the first one, the reads go through.
async function fakeGame(browser, request) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [page, other] = await Promise.all(contexts.map((c) => c.newPage()))
  const code = await createGame(page, { username: 'Dani' })
  await joinGame(other, code, 'Buddy')
  await startGame(page, 2)
  await other.waitForURL(/\/draw$/)
  // Let both turn pages open their stories before Dani's goes on
  await page.waitForTimeout(2000)
  await submitWord(page, 'a teapot')
  await expect(page.locator('.waiting-table')).toBeVisible()
  const users = await (await request.get(
    `${PB_URL}/api/collections/users/records?filter=${encodeURIComponent(`game_id.game_code="${code}"&&username="Dani"`)}`,
  )).json()
  let game = null
  await page.route((url) => /\/api\/games\/[^/]+\/players$/.test(url.pathname),
    (route) => (game ? route.fulfill({ json: { players: game.players } }) : route.continue()))
  await page.route((url) => url.pathname.endsWith('/api/collections/progress/records') &&
    Boolean(url.searchParams.get('filter')?.includes('game_code')),
  (route) => (game
    ? route.fulfill({ json: { page: 1, perPage: 500, totalItems: -1, totalPages: -1, items: game.rows } })
    : route.continue()))
  return {
    page,
    meId: users.items[0].id,
    show: (next) => { game = next },
    close: () => Promise.all(contexts.map((c) => c.close())),
  }
}

const fakePlayer = (id, username, extra = {}) => ({
  id, username, avatar: '', color: 'hsl(200, 70%, 65%)', dropped: false, has_story: true, finished: false, ...extra,
})
// A story waiting on next with taken turns behind it, of total; the next turn
// is a drawing when the last was a word (an odd number taken)
const fakeStory = (id, starter, next, taken, total) => ({
  id, story_id: id, starter_user_id: starter, next_user_id: next, turns_taken: taken, total_turns: total,
  total_players: total, prev_prompt: taken % 2 ? 'a word' : '',
})

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

    // Whoever's looking sits at the bottom, in the middle.
    const middles = await page.locator('.seat .avatar-cut').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }))
    const table = await page.locator('.table-top').boundingBox()
    expect(middles[0].y).toBeGreaterThan(Math.max(middles[1].y, middles[2].y))
    expect(Math.abs(middles[0].x - (table.x + table.width / 2))).toBeLessThan(2)

    // A pencil only on the notebook each player is on, writing on a ruled
    // page: their opening words
    await expect(notebooksOf(page, next.name).locator('.pencil')).toHaveCount(1)
    await expect(notebooksOf(page, last.name).locator('.pencil')).toHaveCount(1)
    const top = (name) => notebooksOf(page, name).filter({ has: page.locator('.pencil') })
    await expect(top(next.name).locator('.rule')).toHaveCount(5)
    await expect(top(next.name).locator('.marks').first()).toHaveAttribute('d', /^M15 21 q/)
    // The notebooks are pictures of what the statuses say
    await expect(page.locator('.papers')).toHaveAttribute('aria-hidden', 'true')
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
    // Now they draw mine: a blank page, with a house going up.
    await expect(seatOf(page, next.name).locator('.seat-status')).toHaveText('Drawing…')
    await expect(notebooksOf(page, last.name)).toHaveCount(2)
    const drawing = notebooksOf(page, next.name)
    await expect(drawing.locator('.pencil')).toHaveCount(1)
    await expect(drawing.locator('.rule')).toHaveCount(0)
    await expect(drawing.locator('.marks').first()).toHaveAttribute('d', /^M16 60 L16 40/)
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
    // Let every turn page open its story before the host's goes on
    await host.waitForTimeout(2000)
    await submitWord(host, 'a teapot')
    await expect(host.locator('.story-paper')).toHaveCount(3)

    for (const width of [360, 390, 600, 800, 1000, 1440]) {
      await host.setViewportSize({ width, height: 800 })
      const kind = width >= WIDE ? 'round' : 'long'
      await expect(host.locator(`.waiting-table--${kind}`)).toBeVisible()
      await settle(host)
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
        return { seats, tops }
      })
      const at = `at ${width}px`
      expect(await sidewaysScroll(host), `no sideways scroll ${at}`).toBeLessThanOrEqual(1)
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
    await expect(page.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'false')
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
// name or avatar, and nothing's off the side of the screen.
test('big games fit at the table on every screen', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const { page, meId, show, close } = await fakeGame(browser, request)
  try {
    // Players, the turns taken so far, and the table at 1000 and 1440 wide
    for (const [n, steps, at1000, at1440] of [[12, 22, 'round', 'round'], [13, 26, 'sides', 'round'], [25, 50, 'sides', 'sides']]) {
      show(bigGame(n, [3, Math.floor(n / 2) + 2], steps, meId))
      for (const [width, kind] of [[390, 'long'], [1000, at1000], [1440, at1440]]) {
        await page.setViewportSize({ width, height: 800 })
        await expect(page.locator('.seat')).toHaveCount(n, { timeout: 15_000 })
        await expect(page.locator(`.waiting-table--${kind}`), `${n} players at ${width}px`).toBeVisible()
        await settle(page)
        const shot = await page.evaluate(() => ({
          seats: [...document.querySelectorAll('.seat')].map((seat) => ({
            player: seat.dataset.player,
            avatar: seat.querySelector('.avatar-cut').getBoundingClientRect().toJSON(),
            label: seat.querySelector('.seat-label').getBoundingClientRect().toJSON(),
          })),
        }))
        const at = `${n} players at ${width}px`
        expect(await sidewaysScroll(page), `no sideways scroll, ${at}`).toBeLessThanOrEqual(1)
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
    await close()
  }
})

const isPlayers = (url) => /\/api\/games\/[^/]+\/players$/.test(url.pathname)
const isFullProgress = (url) => url.pathname.endsWith('/api/collections/progress/records') &&
  Boolean(url.searchParams.get('filter')?.includes('game_code'))

// The story a player is on: the top of their pile
const topStory = (page, name) => notebooksOf(page, name).evaluateAll((els) => els
  .sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))[0].dataset.story)

// Each stroke's stated length matches its path: the share of the drawing time
// it inks in over is its share of the length. pencil-logic.spec.js checks the
// timing; this checks the numbers it's worked out from.
async function expectStrokesMatchPaths(paper) {
  const strokes = await paper.locator('.marks').evaluateAll((paths) => paths.map((p) => ({
    length: p.getTotalLength(),
    keyTimes: p.querySelector('animate').getAttribute('keyTimes').split(';').map(Number),
  })))
  const total = strokes.reduce((sum, s) => sum + s.length, 0)
  const drawn = strokes.at(-1).keyTimes[2]
  for (const { length, keyTimes: [, from, to] } of strokes) {
    expect((to - from) / drawn).toBeCloseTo(length / total, 2)
  }
}

test('each stroke the pencil makes takes the share of the time its path is of the drawing', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [me, next] = seats
  try {
    await submitWord(me.page, 'a teapot')
    const page = me.page
    const pencilOn = (name) => notebooksOf(page, name).filter({ has: page.locator('.pencil') })
    await expect(pencilOn(next.name)).toHaveCount(1)
    await expectStrokesMatchPaths(pencilOn(next.name)) // writing
    await submitWord(next.page, 'a kite')
    await expect(seatOf(page, next.name).locator('.seat-status')).toHaveText('Drawing…')
    await expectStrokesMatchPaths(pencilOn(next.name)) // a drawing
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

test('with reduced motion the pencils rest at the end of their strokes, and notebooks move without sliding', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [me, next, last] = seats
  try {
    await submitWord(me.page, 'a teapot')
    const page = me.page
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload()
    await expect(notebooksOf(page, next.name)).toHaveCount(2)
    await expect(page.locator('.papers animate, .papers animateMotion')).toHaveCount(0)

    // Where the pencil rests, and where its last stroke really ends
    const pencilOn = (name) => notebooksOf(page, name).filter({ has: page.locator('.pencil') })
    const rest = (paper) => paper.evaluate((el) => {
      const [x, y] = el.querySelector('.pencil').parentElement.getAttribute('transform').match(/-?[\d.]+/g).map(Number)
      const last = [...el.querySelectorAll('.marks')].at(-1)
      const end = last.getPointAtLength(last.getTotalLength())
      return { x, y, endX: end.x, endY: end.y }
    })
    const writing = await rest(pencilOn(next.name))
    expect([writing.x, writing.y]).toEqual([33, 41])
    expect(writing.endX).toBeCloseTo(writing.x, 1)
    expect(writing.endY).toBeCloseTo(writing.y, 1)

    await watchSlides(page)
    const theirs = await topStory(page, next.name)
    await submitWord(next.page, 'a kite')
    await expect(page.locator(`.story-paper[data-story="${theirs}"]`)).toHaveAttribute('data-holder', last.name)
    await expect(seatOf(page, next.name).locator('.seat-status')).toHaveText('Drawing…')
    expect(await slidesOf(page)).toEqual([])
    const drawing = await rest(pencilOn(next.name))
    expect([drawing.x, drawing.y]).toEqual([44, 15])
    expect(drawing.endX).toBeCloseTo(drawing.x, 1)
    expect(drawing.endY).toBeCloseTo(drawing.y, 1)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// One refresh's players read held back while a newer refresh lands with a
// notebook passed on: when the held one finally lands, with the progress from
// before the pass, it's dropped. Applied, it would slide the notebook back.
test('a refresh that lands after a newer one is dropped, so notebooks never slide back', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [me, next, last] = seats
  try {
    await submitWord(me.page, 'a teapot')
    const page = me.page
    await expect(notebooksOf(page, next.name)).toHaveCount(2)
    const theirs = await topStory(page, next.name)
    const notebook = page.locator(`.story-paper[data-story="${theirs}"]`)

    // The waiting screen reads the progress and the players together; the
    // turn page reads the players on their own, before. So a players read
    // that starts just after a progress read is the waiting screen's: hold
    // that one.
    let progressAt = 0
    await page.route(isFullProgress, (route) => {
      progressAt = Date.now()
      return route.continue()
    })
    let release
    const letGo = new Promise((resolve) => { release = resolve })
    let held = false
    let landed = false
    await page.route(isPlayers, async (route) => {
      if (held || Date.now() - progressAt > 300) return route.continue()
      held = true
      const response = await route.fetch() // what the server says now, before the pass
      await letGo
      await route.fulfill({ response })
      landed = true
    })
    await expect.poll(() => held, { timeout: 10_000 }).toBe(true)

    await submitWord(next.page, 'a kite')
    await expect(notebook).toHaveAttribute('data-holder', last.name)
    await watchSlides(page)
    release()
    await expect.poll(() => landed).toBe(true)
    await page.waitForTimeout(1000)
    await expect(notebook).toHaveAttribute('data-holder', last.name)
    expect(await slidesOf(page)).toEqual([])
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

test('a failed read of the players keeps the table as it was', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [me, next, last] = seats
  const errors = []
  me.page.on('pageerror', (e) => errors.push(e.message))
  try {
    await submitWord(me.page, 'a teapot')
    const page = me.page
    await expect(notebooksOf(page, next.name)).toHaveCount(2)
    let failed = 0
    await page.route(isPlayers, (route) => {
      failed++
      return route.fulfill({ status: 500, json: { message: 'players are down' } })
    })
    // Two refreshes' worth (the turn page reads them too)
    await expect.poll(() => failed, { timeout: 15_000 }).toBeGreaterThanOrEqual(4)
    await expect(page.locator('.seat')).toHaveCount(3)
    await expect(notebooksOf(page, next.name)).toHaveCount(2)
    await expect(notebooksOf(page, last.name)).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// On the phone's table the last player sits at the bottom, the first at the
// top: a notebook between them goes up behind the avatars, a slide of four
// stops (out, up, up, back in) rather than two.
test('on a phone, a notebook passed from the last player to the first goes up behind the avatars', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [first, middle, last] = seats
  try {
    // The middle player writes their word and waits for the first's.
    await submitWord(middle.page, 'a teapot')
    const page = middle.page
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.waiting-table--long')).toBeVisible()
    // The last player has their own word to write, and then the middle's
    await expect(notebooksOf(page, last.name)).toHaveCount(2)
    const theirs = await topStory(page, last.name)
    await page.waitForFunction(() => document.getAnimations().length === 0)
    await watchSlides(page)

    await submitWord(last.page, 'a kite')
    await expect(page.locator(`.story-paper[data-story="${theirs}"]`)).toHaveAttribute('data-holder', first.name)
    expect(await slidesOf(page)).toContainEqual({ story: theirs, stops: 4 })
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

test('statuses: done, waiting with nothing coming, a pile\'s count, and no seat for a dropped player', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { page, meId, show, close } = await fakeGame(browser, request)
  try {
    // Ana holds three notebooks, none with a turn left for Cy or Dani; Bo is
    // done; Di was dropped. Di's seat still counts: their skip is a turn, so
    // Ana's notebooks run out before Cy. (Without it, one would reach Cy.)
    show({
      players: [
        fakePlayer(meId, 'Dani'), fakePlayer('a', 'Ana'), fakePlayer('d', 'Di', { dropped: true, finished: true }),
        fakePlayer('c', 'Cy'), fakePlayer('b', 'Bo', { finished: true }),
      ],
      rows: [fakeStory('s1', 'c', 'a', 3, 5), fakeStory('s2', 'b', 'a', 4, 5), fakeStory('s3', 'c', 'a', 3, 5)],
    })
    await expect(page.locator('.seat')).toHaveCount(4)
    await expect(seatOf(page, 'Di')).toHaveCount(0)
    await expect(notebooksOf(page, 'Ana')).toHaveCount(3)
    await expect(seatOf(page, 'Ana').locator('.seat-status-text')).toHaveText('Drawing…')
    await expect(seatOf(page, 'Ana').locator('.seat-pile')).toHaveText('+2')
    await expect(seatOf(page, 'Bo').locator('.seat-status')).toHaveText('Done')
    await expect(seatOf(page, 'Bo').locator('.mdi-check')).toHaveCount(1)
    await expect(seatOf(page, 'Cy').locator('.seat-status')).toHaveText('Waiting')
    await expect(seatOf(page, 'Dani').locator('.seat-status')).toHaveText('Waiting')
    for (const name of ['Bo', 'Cy', 'Dani']) await expect(seatOf(page, name).locator('.seat-pile')).toHaveCount(0)
  } finally {
    await close()
  }
})

test('the notebook a player is on stays on top when one with fewer turns arrives', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { page, meId, show, close } = await fakeGame(browser, request)
  try {
    const players = [fakePlayer(meId, 'Dani'), fakePlayer('a', 'Ana'), fakePlayer('b', 'Bo')]
    // Ana is guessing, two turns in...
    show({ players, rows: [fakeStory('s1', 'b', 'a', 2, 6)] })
    await expect(seatOf(page, 'Ana').locator('.seat-status')).toHaveText('Writing…')
    // ...when a story only one turn in, to draw, reaches her. She's still
    // guessing.
    show({ players, rows: [fakeStory('s1', 'b', 'a', 2, 6), fakeStory('s2', meId, 'a', 1, 6)] })
    await expect(notebooksOf(page, 'Ana')).toHaveCount(2)
    await expect(seatOf(page, 'Ana').locator('.seat-status-text')).toHaveText('Writing…')
    expect(await topStory(page, 'Ana')).toBe('s1')
  } finally {
    await close()
  }
})

test('a finished story\'s notebook leaves the table, and a blank page gives way to the story it stood for', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { page, meId, show, close } = await fakeGame(browser, request)
  try {
    // Bo hasn't opened the game: a blank page. Ana has the last turn of s1.
    show({
      players: [fakePlayer(meId, 'Dani'), fakePlayer('a', 'Ana'), fakePlayer('b', 'Bo', { has_story: false })],
      rows: [fakeStory('s1', meId, 'a', 2, 3)],
    })
    await expect(page.locator('.story-paper[data-story="first:b"]')).toHaveCount(1)
    await expect(page.locator('.story-paper[data-story="s1"]')).toHaveCount(1)
    // Ana finishes s1; Bo opens the game.
    show({
      players: [fakePlayer(meId, 'Dani'), fakePlayer('a', 'Ana'), fakePlayer('b', 'Bo')],
      rows: [{ ...fakeStory('s1', meId, '', 3, 3) }, fakeStory('sb', 'b', 'b', 0, 3)],
    })
    await expect(page.locator('.story-paper[data-story="s1"]')).toHaveCount(0)
    await expect(page.locator('.story-paper[data-story="first:b"]')).toHaveCount(0)
    await expect(notebooksOf(page, 'Bo')).toHaveCount(1)
    expect(await topStory(page, 'Bo')).toBe('sb')
  } finally {
    await close()
  }
})

// A player leaving the table moves everyone after them up a seat. The table
// is just redrawn: nothing slides, as nothing was passed.
test('a player leaving redraws the table without sliding the notebooks', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { page, meId, show, close } = await fakeGame(browser, request)
  try {
    const rows = [fakeStory('s1', 'b', 'c', 1, 8), fakeStory('s2', 'c', 'a', 2, 8)]
    const players = [fakePlayer(meId, 'Dani'), fakePlayer('a', 'Ana'), fakePlayer('b', 'Bo'), fakePlayer('c', 'Cy')]
    show({ players, rows })
    await expect(notebooksOf(page, 'Cy')).toHaveCount(1)
    await page.waitForFunction(() => document.getAnimations().length === 0)
    await watchSlides(page)

    show({ players: players.map((p) => (p.id === 'b' ? { ...p, dropped: true } : p)), rows })
    await expect(page.locator('.seat')).toHaveCount(3)
    await expect(notebooksOf(page, 'Cy')).toHaveCount(1)
    await page.waitForTimeout(500)
    expect(await slidesOf(page)).toEqual([])
  } finally {
    await close()
  }
})

test('the switch still works on a device that won\'t remember it, and a view it doesn\'t know shows the table', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { page, close } = await fakeGame(browser, request)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    // Something it doesn't know
    await page.evaluate(() => localStorage.setItem('waitingView', 'cards'))
    await page.reload()
    await expect(page.locator('.waiting-table')).toBeVisible()

    // Storage that refuses (a private window, blocked site data)
    await page.addInitScript(() => {
      const [get, set] = [Storage.prototype.getItem, Storage.prototype.setItem]
      Storage.prototype.getItem = function (key) {
        if (key === 'waitingView') throw new Error('storage is blocked')
        return get.call(this, key)
      }
      Storage.prototype.setItem = function (key, value) {
        if (key === 'waitingView') throw new Error('storage is blocked')
        return set.call(this, key, value)
      }
    })
    await page.reload()
    await expect(page.locator('.waiting-table')).toBeVisible()
    await page.getByRole('button', { name: 'List' }).click()
    await expect(page.locator('.story-row')).toHaveCount(2)
    await page.getByRole('button', { name: 'Table' }).click()
    await expect(page.locator('.waiting-table')).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await close()
  }
})

// A slow player with two notebooks waiting gets the one the table shows on
// top of their pile: the one that's been round the fewest times. Their reads
// of what they owe are answered fewest-first, the order a turn page taking
// the last one would get wrong.
test('a slow player is given the notebook the table shows on top of their pile', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const { contexts, seats } = await startThreePlayerGame(browser, request)
  const [first, slow, last] = seats
  try {
    await slow.page.route((url) => url.pathname.endsWith('/api/collections/progress/records') &&
      Boolean(url.searchParams.get('filter')?.includes('next_user_id')), async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      body.items.sort((a, b) => a.turns_taken - b.turns_taken)
      await route.fulfill({ response, json: body })
    })
    // The first player's story reaches the slow one, one turn in. The last
    // player's goes to the first, who draws it, and on to the slow player.
    await submitWord(first.page, 'a teapot')
    await submitWord(last.page, 'a kite')
    await expect.poll(() => turnState(first.page)).toBe('draw')
    await submitDrawing(first.page)
    await expect(notebooksOf(first.page, slow.name)).toHaveCount(3)

    // The slow player writes their word: next, the teapot to draw (one turn
    // in), not the kite to guess (two).
    await submitWord(slow.page, 'a cat')
    await expect.poll(() => turnState(slow.page)).toBe('draw')
    await expect(slow.page.getByText('a teapot')).toBeVisible()
    await expect(seatOf(first.page, slow.name).locator('.seat-status-text')).toHaveText('Drawing…')
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

test('whoever is looking sits at the bottom of the round table, wherever they are in the turn order', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const { page, meId, show, close } = await fakeGame(browser, request)
  try {
    show({
      players: [fakePlayer('a', 'Ana'), fakePlayer('b', 'Bo'), fakePlayer(meId, 'Dani'), fakePlayer('c', 'Cy')],
      rows: [fakeStory('s1', 'a', 'b', 1, 4)],
    })
    await expect(page.locator('.seat')).toHaveCount(4)
    await settle(page)
    const middles = await page.locator('.seat').evaluateAll((seats) => seats.map((seat) => {
      const r = seat.querySelector('.avatar-cut').getBoundingClientRect()
      return { name: seat.dataset.player, x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }))
    const table = await page.locator('.table-top').boundingBox()
    const dani = middles.find((m) => m.name === 'Dani')
    expect(dani.y).toBeGreaterThan(Math.max(...middles.filter((m) => m !== dani).map((m) => m.y)))
    expect(Math.abs(dani.x - (table.x + table.width / 2))).toBeLessThan(2)
    // Next round, clockwise: Cy to Dani's left, Ana across, Bo to her right
    const at = (name) => middles.find((m) => m.name === name)
    expect(at('Cy').x).toBeLessThan(dani.x)
    expect(at('Ana').y).toBeLessThan(at('Cy').y)
    expect(at('Bo').x).toBeGreaterThan(dani.x)
  } finally {
    await close()
  }
})
