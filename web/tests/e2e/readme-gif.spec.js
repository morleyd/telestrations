import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { joinGame, startGame, turnCreated, turnState, storyItem } from './helpers.js'

// Records the README's GIF: four people play a whole game, each in their own
// browser, and Pablo's screen is kept at each moment worth showing, with how
// long it stays on screen. Only when asked (`make readme-gif`, which also turns
// the frames into docs/demo.gif with tools/readmegif): it's a recording, not a
// test.

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/readme-gif')

test.skip(!process.env.RECORD_GIF, 'records the README GIF; run `make readme-gif`')
test.use({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1 })

// Pablo hosts and is the one recorded. Seats are decided when the game
// starts, so who draws or guesses what follows from the prompt, not the player.
const HOST = 'Pablo Pixel'
const FRIENDS = ['Frida Circuit', 'Botticelli', 'Vincent van Bot']

// What each person writes to start their story, and what the drawing of each
// is guessed as: close enough to follow, wrong enough to be funny.
const WORDS = {
  'Pablo Pixel': 'a rocket to the moon',
  'Frida Circuit': 'a cat wearing a top hat',
  Botticelli: 'a snowman at the beach',
  'Vincent van Bot': 'a fish riding a bicycle',
}
const GUESSES = {
  'a rocket to the moon': 'a pencil chasing a banana',
  'a cat wearing a top hat': 'a fancy owl',
  'a snowman at the beach': 'a snowman in the desert',
  'a fish riding a bicycle': 'a fish wearing glasses',
}

test('record the README GIF', async ({ page, browser }) => {
  test.setTimeout(300_000)
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const frames = []
  const frame = async (ms) => {
    const file = `frame-${String(frames.length).padStart(3, '0')}.png`
    await page.screenshot({ path: path.join(OUT, file) })
    frames.push({ file, ms })
  }

  // Pablo makes the game and his friends join it.
  await page.goto('/')
  await page.waitForTimeout(800) // the fonts
  await frame(1800)
  await page.getByRole('button', { name: 'New Game' }).click()
  await page.getByLabel('Username').fill(HOST)
  await page.waitForTimeout(400)
  await frame(1600)
  await page.getByRole('button', { name: 'Begin!' }).click()
  await page.waitForURL(/\/[a-z]{5}$/)
  const code = page.url().split('/').pop()
  const friends = []
  for (const name of FRIENDS) {
    const p = await (await browser.newContext()).newPage()
    await joinGame(p, code, name)
    friends.push(p)
  }
  await expect(page.locator('.drag-item')).toHaveCount(4)
  await page.waitForTimeout(800)
  await frame(2200)
  await startGame(page, 4)
  await Promise.all(friends.map((p) => p.waitForURL(/\/draw$/)))
  await page.waitForTimeout(2000) // every TakeTurn opens its story

  // Everyone plays their turns as they come; only Pablo's are filmed.
  const players = [{ name: HOST, page, filmed: true }, ...FRIENDS.map((name, i) => ({ name, page: friends[i] }))]
  const drewFor = new Map() // a drawing's file -> the prompt it drew
  const wrote = new Set()
  const done = new Set()
  let sawTable = false
  const deadline = Date.now() + 240_000
  while (done.size < players.length) {
    if (Date.now() > deadline) throw new Error(`no review in time (done: ${[...done].join(', ')})`)
    let acted = false
    for (const p of players) {
      if (done.has(p.name)) continue
      const state = await turnState(p.page)
      if (state === 'review') {
        done.add(p.name)
      } else if (state === 'word') {
        await writeTurn(p, wrote.has(p.name) ? await guessFor(p.page, drewFor) : WORDS[p.name], frame)
        wrote.add(p.name)
        acted = true
      } else if (state === 'draw') {
        const prompt = await p.page.locator('.drawing-prompt-text').innerText()
        drewFor.set(await drawTurn(p, prompt, frame), prompt)
        acted = true
      } else if (p.filmed && !sawTable && await page.getByText('Around the table').isVisible().catch(() => false)) {
        await page.waitForTimeout(600)
        await frame(1800) // the table, notebooks on their way round
        sawTable = true
      }
    }
    if (!acted) await page.waitForTimeout(400)
  }
  await expect(page.getByText('Game done')).toBeVisible({ timeout: 30_000 })

  // The review: Pablo's own story, start to finish.
  await page.waitForTimeout(800)
  await frame(1600)
  await storyItem(page, HOST).click()
  await page.waitForTimeout(800)
  for (let slide = 0; slide < 5; slide++) {
    await frame(slide === 0 ? 1800 : 2400)
    await page.locator('.v-window__right').click()
    await page.waitForTimeout(700)
  }
  writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames, null, 2))
})

// writeTurn types text (an opening word or a guess) and submits it; on camera,
// it's typed key by key.
async function writeTurn({ page, filmed }, text, frame) {
  const box = page.locator('textarea').first()
  if (filmed) {
    await page.waitForTimeout(600) // a drawing to guess loads
    await frame(2000)
    await box.pressSequentially(text, { delay: 40 })
    await frame(1400)
  } else {
    await box.fill(text)
  }
  await Promise.all([turnCreated(page), page.getByRole('button', { name: 'Submit' }).click()])
}

// The guess at the drawing on page: what it was a drawing of, misread.
async function guessFor(page, drewFor) {
  const src = (await page.locator('img[src*="/api/files/"]').first().getAttribute('src')) ?? ''
  const prompt = [...drewFor].find(([file]) => src.includes(file))?.[1]
  if (!GUESSES[prompt]) throw new Error(`no guess for the drawing at ${src}`)
  return GUESSES[prompt]
}

// drawTurn sketches prompt and submits it, returning the drawing's file name.
async function drawTurn(p, prompt, frame) {
  if (p.filmed) {
    await p.page.waitForTimeout(400)
    await frame(1600)
  }
  await sketch(p.page, prompt, p.filmed ? frame : null)
  const [resp] = await Promise.all([
    turnCreated(p.page),
    p.page.locator('.v-window-item--active').getByRole('button', { name: 'Submit' }).click(),
  ])
  return (await resp.json()).drawing
}

// Shapes on a canvas 1 wide and 1 high, which is 3:2 on screen: a circle's
// ry is 1.5 times its rx.
const ellipse = (cx, cy, rx, ry, n = 28) =>
  Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)])
const circle = (cx, cy, r) => ellipse(cx, cy, r, r * 1.5)
const dot = (x, y) => [[x, y], [x + 0.004, y + 0.006]]
// A crescent (a moon, a banana), its horns pointing at angle turn (0: right).
const crescent = (cx, cy, r, turn = 0, n = 14) => {
  const half = (rx) => Array.from({ length: n + 1 }, (_, i) => Math.PI / 2 + (i / n) * Math.PI).map((a) => [rx * Math.cos(a), r * Math.sin(a)])
  const pts = [...half(r), ...half(r * 0.45).reverse()]
  return pts.map(([x, y]) => [cx + (x * Math.cos(turn) - y * Math.sin(turn)) / 1.5, cy + x * Math.sin(turn) + y * Math.cos(turn)])
}
const rays = (cx, cy, r0, r1, n = 8) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * 2 * Math.PI
  return [[cx + (r0 * Math.cos(a)) / 1.5, cy + r0 * Math.sin(a)], [cx + (r1 * Math.cos(a)) / 1.5, cy + r1 * Math.sin(a)]]
})
const snowman = (x) => [circle(x, 0.7, 0.08), circle(x, 0.47, 0.06), circle(x, 0.3, 0.045), dot(x - 0.015, 0.28), dot(x + 0.015, 0.28),
  'Orange', [[x, 0.31], [x + 0.05, 0.33], [x, 0.33]], 'Black', dot(x, 0.44), dot(x, 0.5)]
const fish = (cx, cy, r) => [circle(cx, cy, r), [[cx - r, cy], [cx - r * 1.7, cy - r * 1.1], [cx - r * 1.7, cy + r * 1.1], [cx - r, cy]]]

// What each prompt gets drawn as: strokes, with a color's name switching the
// pen, in two halves (a frame after each, on camera).
const SKETCHES = {
  'a rocket to the moon': [
    [[[0.42, 0.75], [0.42, 0.4], [0.47, 0.22], [0.52, 0.4], [0.52, 0.75], [0.42, 0.75]], circle(0.47, 0.47, 0.025),
      [[0.42, 0.62], [0.37, 0.78], [0.42, 0.74]], [[0.52, 0.62], [0.57, 0.78], [0.52, 0.74]]],
    ['Orange', [[0.44, 0.77], [0.45, 0.88], [0.47, 0.8], [0.49, 0.9], [0.5, 0.77]],
      'Yellow', crescent(0.78, 0.22, 0.12, 0), 'Black', dot(0.2, 0.2), dot(0.3, 0.12), dot(0.68, 0.5), dot(0.85, 0.65)],
  ],
  'a pencil chasing a banana': [
    [[[0.12, 0.45], [0.38, 0.45], [0.38, 0.58], [0.12, 0.58], [0.12, 0.45]], [[0.38, 0.45], [0.46, 0.515], [0.38, 0.58]],
      [[0.16, 0.45], [0.16, 0.58]], [[0.03, 0.47], [0.09, 0.47]], [[0.02, 0.52], [0.09, 0.52]], [[0.03, 0.57], [0.09, 0.57]]],
    ['Yellow', crescent(0.72, 0.42, 0.16, -Math.PI / 2), 'Black', dot(0.66, 0.5), dot(0.74, 0.5), [[0.68, 0.56], [0.7, 0.58], [0.72, 0.56]]],
  ],
  'a cat wearing a top hat': [
    [circle(0.5, 0.6, 0.13), [[0.4, 0.5], [0.38, 0.36], [0.46, 0.43]], [[0.6, 0.5], [0.62, 0.36], [0.54, 0.43]],
      dot(0.45, 0.57), dot(0.55, 0.57), [[0.48, 0.65], [0.5, 0.68], [0.52, 0.65]],
      [[0.42, 0.67], [0.3, 0.65]], [[0.42, 0.7], [0.3, 0.72]], [[0.58, 0.67], [0.7, 0.65]], [[0.58, 0.7], [0.7, 0.72]]],
    [[[0.37, 0.41], [0.63, 0.41]], [[0.42, 0.41], [0.42, 0.13], [0.58, 0.13], [0.58, 0.41]], 'Red', [[0.43, 0.36], [0.57, 0.36]]],
  ],
  'a fancy owl': [
    [ellipse(0.5, 0.55, 0.14, 0.32), [[0.4, 0.3], [0.39, 0.2], [0.45, 0.27]], [[0.6, 0.3], [0.61, 0.2], [0.55, 0.27]],
      circle(0.45, 0.4, 0.04), circle(0.55, 0.4, 0.04), dot(0.45, 0.4), dot(0.55, 0.4)],
    ['Orange', [[0.48, 0.47], [0.5, 0.52], [0.52, 0.47], [0.48, 0.47]],
      'Red', [[0.5, 0.66], [0.43, 0.62], [0.43, 0.7], [0.5, 0.66], [0.57, 0.62], [0.57, 0.7], [0.5, 0.66]]],
  ],
  'a snowman at the beach': [
    snowman(0.4),
    ['Yellow', circle(0.82, 0.18, 0.06), ...rays(0.82, 0.18, 0.13, 0.19),
      'Blue', [[0.02, 0.92], [0.12, 0.88], [0.22, 0.92], [0.32, 0.88], [0.42, 0.92], [0.52, 0.88], [0.62, 0.92], [0.72, 0.88], [0.82, 0.92], [0.92, 0.88]]],
  ],
  'a snowman in the desert': [
    snowman(0.35),
    ['Green', [[0.69, 0.88], [0.69, 0.42], [0.72, 0.37], [0.75, 0.42], [0.75, 0.88]], [[0.69, 0.62], [0.63, 0.62], [0.63, 0.5]],
      [[0.75, 0.56], [0.81, 0.56], [0.81, 0.45]], 'Tan', [[0.03, 0.88], [0.97, 0.88]],
      'Sky blue', [[0.44, 0.24], [0.45, 0.28]], [[0.25, 0.4], [0.24, 0.44]]],
  ],
  'a fish riding a bicycle': [
    [circle(0.33, 0.72, 0.08), circle(0.67, 0.72, 0.08), [[0.33, 0.72], [0.45, 0.52], [0.6, 0.52], [0.67, 0.72]],
      [[0.45, 0.52], [0.5, 0.72], [0.33, 0.72]], [[0.6, 0.52], [0.62, 0.42], [0.67, 0.42]]],
    ['Orange', ...fish(0.48, 0.33, 0.08), 'Black', dot(0.52, 0.3)],
  ],
  'a fish wearing glasses': [
    ['Orange', ...fish(0.5, 0.5, 0.2)],
    ['Black', circle(0.54, 0.43, 0.045), circle(0.66, 0.43, 0.045), [[0.585, 0.42], [0.615, 0.42]], [[0.495, 0.42], [0.42, 0.38]],
      [[0.6, 0.62], [0.64, 0.6]]],
  ],
}

// sketch draws prompt on the canvas the way a person would, a few strokes at a
// time, keeping a frame after each half when filmed.
async function sketch(page, prompt, frame) {
  const halves = SKETCHES[prompt]
  if (!halves) throw new Error(`no sketch for the prompt "${prompt}"`)
  const box = await page.locator('canvas.paint-canvas').boundingBox()
  const at = (fx, fy) => [box.x + fx * box.width, box.y + fy * box.height]
  await page.keyboard.press('3') // a thicker brush
  await page.getByRole('button', { name: 'Black', exact: true }).click() // not the last turn's color
  for (const [i, half] of halves.entries()) {
    for (const s of half) {
      if (typeof s === 'string') {
        await page.getByRole('button', { name: s, exact: true }).click()
        continue
      }
      await page.mouse.move(...at(...s[0]))
      await page.mouse.down()
      for (const pt of s.slice(1)) await page.mouse.move(...at(...pt), { steps: 3 })
      await page.mouse.up()
    }
    if (frame) await frame(i === 0 ? 500 : 1400)
  }
}
