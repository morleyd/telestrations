import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startGame, turnCreated, turnState, storyItem } from './helpers.js'

// Records the README's GIF: one person plays a whole game against the bots,
// and a screenshot is kept at each moment worth showing, with how long it
// stays on screen. Only when asked (`make readme-gif`, which also turns the
// frames into docs/demo.gif with tools/readmegif): it's a recording, not a test.

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/readme-gif')

test.skip(!process.env.RECORD_GIF, 'records the README GIF; run `make readme-gif`')
test.use({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1 })

test('record the README GIF', async ({ page }) => {
  test.setTimeout(300_000)
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const frames = []
  const frame = async (ms) => {
    const file = `frame-${String(frames.length).padStart(3, '0')}.png`
    await page.screenshot({ path: path.join(OUT, file) })
    frames.push({ file, ms })
  }

  await page.goto('/')
  await page.waitForTimeout(800) // the fonts
  await frame(1800)
  await page.getByRole('button', { name: 'Play with bots' }).click()
  await page.getByLabel('Username').fill('Dana')
  await page.waitForTimeout(400)
  await frame(1600)
  await page.getByRole('button', { name: 'Begin!' }).click()
  await page.waitForURL(/\/[a-z]{5}$/)
  await expect(page.locator('.drag-item', { hasText: 'Frida Circuit' })).toBeVisible()
  await page.waitForTimeout(600)
  await frame(2200)
  await startGame(page, 4)

  const deadline = Date.now() + 240_000
  let wroteWord = false
  let waited = false
  for (;;) {
    const state = await turnState(page)
    if (state === 'review') break
    if (Date.now() > deadline) throw new Error(`no review in time (state: ${state})`)
    if (state === 'word') {
      const opening = !wroteWord
      let text = 'a cat wearing a top hat'
      if (!opening) {
        await page.waitForTimeout(600) // the bot's drawing loads
        await frame(2000)
        text = await guessFor(page)
      }
      await page.locator('textarea').first().pressSequentially(text, { delay: 40 })
      await frame(1400)
      await Promise.all([turnCreated(page), page.getByRole('button', { name: 'Submit' }).click()])
      wroteWord = true
    } else if (state === 'draw') {
      await page.waitForTimeout(400)
      await frame(1600)
      await sketch(page, frame, await page.locator('.drawing-prompt-text').innerText().catch(() => ''))
      await Promise.all([
        turnCreated(page),
        page.locator('.v-window-item--active').getByRole('button', { name: 'Submit' }).click(),
      ])
    } else {
      if (!waited && await page.getByText('Around the table').isVisible().catch(() => false)) {
        await page.waitForTimeout(600)
        await frame(1800) // the table, notebooks on their way round
        waited = true
      }
      await page.waitForTimeout(400)
    }
  }

  // The review: Dana's own story, start to finish.
  await page.waitForTimeout(800)
  await frame(1600)
  await storyItem(page, 'Dana').click()
  await page.waitForTimeout(800)
  for (let slide = 0; slide < 5; slide++) {
    await frame(slide === 0 ? 1800 : 2200)
    await page.locator('.v-window__right').click()
    await page.waitForTimeout(700)
  }
  writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames, null, 2))
})

// A guess at a bot's doodle, close but not quite: the doodle's name is in its
// file's name (see internal/game/doodles.go).
const NEAR_MISSES = {
  sun: 'a fried egg', house: 'a little barn', tree: 'a giant broccoli', cat: 'a grumpy owl',
  fish: 'a goldfish', car: 'a toy truck', flower: 'a daisy', star: 'a starfish',
  smiley: 'a happy emoji', cloud: 'a stormy sheep', boat: 'a pirate ship', balloon: 'a lollipop',
}

async function guessFor(page) {
  const src = await page.locator('.v-img img').first().getAttribute('src').catch(() => '')
  const name = /\/bot_([a-z]+)_/.exec(src || '')?.[1]
  return NEAR_MISSES[name] || 'something lovely'
}

const circle = (cx, cy, rx, ry, n = 28) =>
  Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)])

// What a person might sketch for each thing a bot asks for, in strokes on a
// canvas 1 wide and 1 high. Each is two halves, with a frame after each.
const SKETCHES = {
  sun: [[circle(0.5, 0.5, 0.12, 0.18)],
    Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * 2 * Math.PI
      return [[0.5 + 0.17 * Math.cos(a), 0.5 + 0.26 * Math.sin(a)], [0.5 + 0.25 * Math.cos(a), 0.5 + 0.38 * Math.sin(a)]]
    })],
  house: [[[[0.32, 0.85], [0.32, 0.45], [0.68, 0.45], [0.68, 0.85], [0.32, 0.85]], [[0.28, 0.47], [0.5, 0.15], [0.72, 0.47]]],
    [[[0.45, 0.85], [0.45, 0.65], [0.55, 0.65], [0.55, 0.85]], [[0.58, 0.55], [0.64, 0.55], [0.64, 0.62], [0.58, 0.62], [0.58, 0.55]]]],
  tree: [[[[0.46, 0.9], [0.47, 0.55]], [[0.54, 0.9], [0.53, 0.55]]],
    [circle(0.5, 0.38, 0.17, 0.22), [[0.2, 0.9], [0.8, 0.9]]]],
  cat: [[circle(0.5, 0.55, 0.16, 0.24), [[0.38, 0.4], [0.36, 0.22], [0.45, 0.33]], [[0.62, 0.4], [0.64, 0.22], [0.55, 0.33]]],
    [[[0.44, 0.5], [0.45, 0.51]], [[0.56, 0.5], [0.57, 0.51]], [[0.47, 0.63], [0.5, 0.66], [0.53, 0.63]],
      [[0.4, 0.6], [0.26, 0.58]], [[0.6, 0.6], [0.74, 0.58]]]],
  fish: [[circle(0.45, 0.5, 0.2, 0.18)], [[[0.64, 0.5], [0.8, 0.32], [0.8, 0.68], [0.64, 0.5]], [[0.33, 0.45], [0.34, 0.46]]]],
  car: [[[[0.22, 0.68], [0.22, 0.48], [0.78, 0.48], [0.78, 0.68], [0.22, 0.68]], [[0.34, 0.48], [0.4, 0.3], [0.62, 0.3], [0.68, 0.48]]],
    [circle(0.34, 0.72, 0.06, 0.09), circle(0.66, 0.72, 0.06, 0.09)]],
  flower: [[[[0.5, 0.92], [0.5, 0.45]], circle(0.5, 0.38, 0.05, 0.08)],
    Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * 2 * Math.PI
      return circle(0.5 + 0.1 * Math.cos(a), 0.38 + 0.15 * Math.sin(a), 0.05, 0.075)
    })],
  star: [[Array.from({ length: 11 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5
    return [0.5 + 0.22 * Math.cos(a), 0.52 + 0.34 * Math.sin(a)]
  })], []],
  smiley: [[circle(0.5, 0.5, 0.2, 0.3)], [[[0.43, 0.42], [0.44, 0.43]], [[0.57, 0.42], [0.58, 0.43]], [[0.4, 0.6], [0.5, 0.68], [0.6, 0.6]]]],
  cloud: [[circle(0.4, 0.45, 0.1, 0.14), circle(0.5, 0.38, 0.12, 0.17), circle(0.62, 0.45, 0.1, 0.14)],
    [[[0.38, 0.68], [0.36, 0.78]], [[0.5, 0.68], [0.48, 0.78]], [[0.62, 0.68], [0.6, 0.78]]]],
  boat: [[[[0.3, 0.65], [0.7, 0.65], [0.62, 0.78], [0.38, 0.78], [0.3, 0.65]], [[0.5, 0.65], [0.5, 0.2]]],
    [[[0.51, 0.22], [0.66, 0.6], [0.51, 0.6]], [[0.2, 0.85], [0.3, 0.82], [0.4, 0.85], [0.5, 0.82], [0.6, 0.85], [0.7, 0.82], [0.8, 0.85]]]],
  balloon: [[circle(0.5, 0.38, 0.13, 0.24)], [[[0.5, 0.62], [0.47, 0.72], [0.53, 0.82], [0.49, 0.92]]]],
}
const KEYWORDS = {
  sun: /sun|lemon|egg/, house: /house|home|barn/, tree: /tree|broccoli|oak/, cat: /cat|kitten|owl/,
  fish: /fish|whale|shark/, car: /car|truck|taxi/, flower: /flower|daisy|spring/, star: /star|sticker/,
  smiley: /smil|happ|emoji|face/, cloud: /cloud|storm|rain|sheep/, boat: /boat|ship|sea/, balloon: /balloon|party|lollipop/,
}

// sketch draws what prompt asks for on the canvas the way a person would, a
// few strokes at a time, keeping a frame after each half.
async function sketch(page, frame, prompt) {
  const box = await page.locator('canvas.paint-canvas').boundingBox()
  const at = (fx, fy) => [box.x + fx * box.width, box.y + fy * box.height]
  const stroke = async (points) => {
    await page.mouse.move(...at(...points[0]))
    await page.mouse.down()
    for (const p of points.slice(1)) await page.mouse.move(...at(...p), { steps: 3 })
    await page.mouse.up()
  }
  const name = Object.keys(KEYWORDS).find((k) => KEYWORDS[k].test(prompt.toLowerCase())) || 'smiley'
  await page.keyboard.press('3') // a thicker brush
  const [first, second] = SKETCHES[name]
  for (const s of first) await stroke(s)
  await frame(500)
  for (const s of second) await stroke(s)
  await frame(1400)
}
