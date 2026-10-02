import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { createGame, expectStoriesAlternate, joinGame, PB_URL, startGame, submitWord, stroke } from './helpers.js'
import { SIZES } from '../../src/services/paint/engine.js'
import { TOOLS } from '../../src/services/paint/tools.js'

// The drawing turn's paint tools. A tapped color applies straight away, and
// tapping the canvas both closes the color picker and draws.

const CANVAS = 'canvas.paint-canvas'
const RED = [229, 43, 43]
const BLUE = [34, 100, 216]
const YELLOW = [249, 212, 35]
const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]

// Count canvas pixels close to `rgb` inside a box (canvas CSS coordinates).
async function countPixels(page, rgb, box) {
  return page.evaluate(([sel, rgb, box]) => {
    const c = document.querySelector(sel)
    const scale = c.width / c.getBoundingClientRect().width
    const d = c.getContext('2d').getImageData(box.x * scale, box.y * scale, box.w * scale, box.h * scale).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) n++
    }
    return n
  }, [CANVAS, rgb, box])
}

// Whether the canvas pixel at (x, y), in CSS coordinates, is close to `rgb`.
const isColor = async (page, x, y, rgb) => (await countPixels(page, rgb, { x, y, w: 1, h: 1 })) > 0

async function drag(page, from, to) {
  const box = await page.locator(CANVAS).boundingBox()
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 })
  await page.mouse.up()
}

async function tap(page, x, y) {
  const box = await page.locator(CANVAS).boundingBox()
  await page.mouse.click(box.x + x, box.y + y)
}

// Move the mouse off the canvas, so the brush outline isn't in the pixels we read.
const away = (page) => page.mouse.move(1, 1)

const button = (page, name) => page.getByRole('button', { name, exact: true })

// Host and guest each give an opening word, which puts the host on a drawing turn.
async function openDrawingTurn(browser) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  const close = () => Promise.all(contexts.map((c) => c.close()))
  try {
    const code = await createGame(host, { username: 'hosty', timed: false })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)
    await host.waitForTimeout(1500)
    await submitWord(host, 'apple')
    await submitWord(guest, 'pear')
    await expect(host.getByRole('tab', { name: /Upload Photo/ })).toBeVisible({ timeout: 15_000 })
    await expect(host.locator(CANVAS)).toBeVisible()
  } catch (err) {
    await close()
    throw err
  }
  return { host, close }
}

test('colors apply straight away, and switching tools moves nothing', async ({ browser }) => {
  test.setTimeout(90_000)
  const { host, close } = await openDrawingTurn(browser)
  try {
    // A palette color, then straight onto the canvas: the stroke is red.
    await button(host, 'Red').click()
    await stroke(host, 20)
    expect(await countPixels(host, RED, { x: 20, y: 10, w: 110, h: 20 })).toBeGreaterThan(20)

    // The back square makes the next color the background, then hands the palette back to the pen.
    await button(host, 'Background color').click()
    await button(host, 'Yellow').click()
    expect(await countPixels(host, YELLOW, { x: 150, y: 100, w: 20, h: 20 })).toBeGreaterThan(100)
    await stroke(host, 60)
    expect(await countPixels(host, RED, { x: 20, y: 50, w: 110, h: 20 })).toBeGreaterThan(20)

    // With the eraser on, picking a color switches back to the brush.
    await button(host, 'Eraser').click()
    await button(host, 'Blue').click()
    await expect(button(host, 'Brush')).toHaveAttribute('aria-pressed', 'true')
    await stroke(host, 100)
    expect(await countPixels(host, BLUE, { x: 20, y: 90, w: 110, h: 20 })).toBeGreaterThan(20)

    // A custom color from the picker applies as it's chosen; tapping the canvas
    // closes the picker and draws with it, and it joins the recent colors.
    await button(host, 'More colors').click()
    const hex = host.locator('.v-color-picker-edit input')
    await hex.fill('#00AA00')
    await hex.press('Tab')
    await stroke(host, 140)
    await expect(host.locator('.v-color-picker')).toHaveCount(0)
    expect(await countPixels(host, [0, 170, 0], { x: 20, y: 130, w: 110, h: 20 })).toBeGreaterThan(20)
    await expect(button(host, 'Recent color #00AA00')).toBeVisible()

    // Shortcuts pick tools.
    await away(host)
    await host.keyboard.press('g')
    await expect(button(host, 'Fill bucket')).toHaveAttribute('aria-pressed', 'true')

    // Every tool's options fit the same box: the colors and the Behind lines
    // switch stay exactly where they are.
    const where = () => host.evaluate(() =>
      ['.palette', '.toolbox-behind'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)))
    const before = await where()
    for (const name of ['Brush', 'Eraser', 'Fill bucket', 'Eyedropper', 'Spray can', 'Line', 'Rectangle', 'Oval', 'Triangle', 'Right triangle']) {
      await button(host, name).click()
      expect(await where(), name).toEqual(before)
      await button(host, 'Behind lines').click()
      expect(await where(), `${name}, behind lines`).toEqual(before)
      await button(host, 'Behind lines').click()
    }
  } finally {
    await close()
  }
})

test('the fill bucket, painting behind lines, and an undoable Clear', async ({ browser }) => {
  test.setTimeout(90_000)
  const { host, close } = await openDrawingTurn(browser)
  try {
    // A black rectangle outline.
    await button(host, 'Rectangle').click()
    await drag(host, { x: 40, y: 40 }, { x: 160, y: 120 })
    await away(host)
    expect(await countPixels(host, WHITE, { x: 50, y: 50, w: 100, h: 60 })).toBeGreaterThan(5000)

    // Filling it turns the inside red right up to the outline, with no pale ring
    // left along the line's soft edge, and leaves the outside alone.
    await button(host, 'Red').click()
    await button(host, 'Fill bucket').click()
    await tap(host, 100, 80)
    expect(await countPixels(host, RED, { x: 50, y: 50, w: 100, h: 60 })).toBeGreaterThan(5000)
    expect(await countPixels(host, WHITE, { x: 43, y: 43, w: 114, h: 74 })).toBe(0)
    expect(await isColor(host, 200, 60, WHITE)).toBe(true)

    // Behind lines: a blue stroke across the top edge goes under the outline.
    await button(host, 'Behind lines').click()
    await button(host, 'Brush').click()
    await button(host, 'Blue').click()
    await drag(host, { x: 100, y: 15 }, { x: 100, y: 45 })
    await away(host)
    expect(await isColor(host, 100, 25, BLUE)).toBe(true)
    expect(await isColor(host, 100, 40, BLACK)).toBe(true)

    // Still behind the lines, the eraser takes the blue off and leaves the outline.
    await button(host, 'Eraser').click()
    await drag(host, { x: 100, y: 12 }, { x: 100, y: 46 })
    await away(host)
    expect(await isColor(host, 100, 25, WHITE)).toBe(true)
    expect(await isColor(host, 100, 40, BLACK)).toBe(true)

    // The eyedropper picks up the red, then goes back to the eraser.
    await button(host, 'Eyedropper').click()
    await tap(host, 100, 80)
    await expect(button(host, 'Pen color')).toHaveCSS('background-color', `rgb(${RED.join(', ')})`)
    await expect(button(host, 'Eraser')).toHaveAttribute('aria-pressed', 'true')

    // Clear empties the canvas, and Undo brings the drawing back.
    await button(host, 'Clear').click()
    expect(await countPixels(host, RED, { x: 50, y: 50, w: 100, h: 60 })).toBe(0)
    await button(host, 'Undo').click()
    expect(await countPixels(host, RED, { x: 50, y: 50, w: 100, h: 60 })).toBeGreaterThan(5000)
    await host.keyboard.press('Control+Shift+Z')
    expect(await countPixels(host, RED, { x: 50, y: 50, w: 100, h: 60 })).toBe(0)
  } finally {
    await close()
  }
})

// The background square's color, as the page shows it.
const background = (page) => button(page, 'Background color').evaluate((el) => getComputedStyle(el).backgroundColor)

// Give the page focus without touching the canvas (which would draw).
const focusPage = (page) => page.locator('.paint-status').click()

test('closing the color picker unchanged hands the palette back, and Undo goes back to the right background', async ({ browser }) => {
  test.setTimeout(90_000)
  const { host, close } = await openDrawingTurn(browser)
  try {
    // White, then red with a right-click.
    await button(host, 'Red').click({ button: 'right' })
    await expect.poll(() => background(host)).toBe('rgb(229, 43, 43)')

    // The back square, then the picker opened and closed with nothing changed:
    // the palette goes back to the pen, and nothing is recorded.
    await button(host, 'Background color').click()
    await button(host, 'More colors').click()
    await button(host, 'Done').click()
    await expect(button(host, 'Background color')).toHaveAttribute('aria-pressed', 'false')
    await expect(button(host, 'Pen color')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => background(host)).toBe('rgb(229, 43, 43)')

    // Undo, then a new background, then Undo: back to white, not red.
    await focusPage(host)
    await host.keyboard.press('Control+z')
    await expect.poll(() => background(host)).toBe('rgb(255, 255, 255)')
    await button(host, 'Background color').click()
    await button(host, 'Blue').click()
    await expect.poll(() => background(host)).toBe('rgb(34, 100, 216)')
    await host.keyboard.press('Control+z')
    await expect.poll(() => background(host)).toBe('rgb(255, 255, 255)')

    // Two backgrounds tried in the picker, the second kept: one step, which
    // Undo takes back to where the picker started.
    await button(host, 'Background color').click()
    await button(host, 'More colors').click()
    const hex = host.locator('.v-color-picker-edit input')
    await hex.fill('#00AA00')
    await hex.press('Tab')
    await expect.poll(() => background(host)).toBe('rgb(0, 170, 0)')
    await hex.fill('#AA00AA')
    await hex.press('Tab')
    await button(host, 'Done').click()
    await expect.poll(() => background(host)).toBe('rgb(170, 0, 170)')
    await expect(button(host, 'Recent color #AA00AA')).toBeVisible()
    await focusPage(host)
    await host.keyboard.press('Control+z')
    await expect.poll(() => background(host)).toBe('rgb(255, 255, 255)')
    await expect(button(host, 'Undo')).toBeDisabled()
  } finally {
    await close()
  }
})

test('a color chosen while the picker is open wins over the picker, and an untouched picker changes nothing', async ({ browser }) => {
  test.setTimeout(90_000)
  const { host, close } = await openDrawingTurn(browser)
  const picker = host.locator('.v-color-picker')
  const hex = host.locator('.v-color-picker-edit input')
  const pen = () => button(host, 'Pen color')
  try {
    // The pen picker open and untouched, then a tap on Red, which also closes it: red.
    await button(host, 'More colors').click()
    await expect(picker).toBeVisible()
    await button(host, 'Red').click()
    await expect(picker).toHaveCount(0)
    await expect(pen()).toHaveCSS('background-color', 'rgb(229, 43, 43)')

    // Moved to a custom color, then a tap on Blue: blue, and the custom color
    // the player didn't keep isn't a recent one.
    await button(host, 'More colors').click()
    await hex.fill('#00AA00')
    await hex.press('Tab')
    await expect(pen()).toHaveCSS('background-color', 'rgb(0, 170, 0)')
    await button(host, 'Blue').click()
    await expect(picker).toHaveCount(0)
    await expect(pen()).toHaveCSS('background-color', 'rgb(34, 100, 216)')
    await expect(host.locator('.palette-recents .palette-sw')).toHaveCount(0)

    // An untouched picker opened and closed while erasing leaves the eraser on.
    await button(host, 'Eraser').click()
    await button(host, 'More colors').click()
    await button(host, 'Done').click()
    await expect(picker).toHaveCount(0)
    await expect(button(host, 'Eraser')).toHaveAttribute('aria-pressed', 'true')

    // The eyedropper with the picker open: the color it picks up stays.
    await button(host, 'Eyedropper').click()
    await button(host, 'More colors').click()
    await tap(host, 200, 200)
    await expect(picker).toHaveCount(0)
    await expect(pen()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(button(host, 'Eraser')).toHaveAttribute('aria-pressed', 'true')

    // The background picker open and untouched, then a tap on Yellow: yellow,
    // as one step that Undo takes back to white.
    await button(host, 'Background color').click()
    await button(host, 'More colors').click()
    await button(host, 'Yellow').click()
    await expect(picker).toHaveCount(0)
    await expect.poll(() => background(host)).toBe('rgb(249, 212, 35)')
    await expect(pen()).toHaveAttribute('aria-pressed', 'true')
    await focusPage(host)
    await host.keyboard.press('Control+z')
    await expect.poll(() => background(host)).toBe('rgb(255, 255, 255)')
    await expect(button(host, 'Undo')).toBeDisabled()

    // The background picker moved, then a right-click on Red, which picks red
    // and leaves the picker open, then Done: red stays, as one step from white.
    await button(host, 'Background color').click()
    await button(host, 'More colors').click()
    await hex.fill('#00AA00')
    await hex.press('Tab')
    await expect.poll(() => background(host)).toBe('rgb(0, 170, 0)')
    await button(host, 'Red').click({ button: 'right' })
    await expect.poll(() => background(host)).toBe('rgb(229, 43, 43)')
    await button(host, 'Done').click()
    await expect(picker).toHaveCount(0)
    await expect.poll(() => background(host)).toBe('rgb(229, 43, 43)')
    await focusPage(host)
    await host.keyboard.press('Control+z')
    await expect.poll(() => background(host)).toBe('rgb(255, 255, 255)')
    await expect(button(host, 'Undo')).toBeDisabled()

    // The same, but after the right-click the picker moves on to the pen's own
    // color (white, from the eyedropper): the background still follows it.
    await button(host, 'Background color').click()
    await button(host, 'More colors').click()
    await hex.fill('#00AA00')
    await hex.press('Tab')
    await button(host, 'Red').click({ button: 'right' })
    await expect.poll(() => background(host)).toBe('rgb(229, 43, 43)')
    await hex.fill('#FFFFFF')
    await hex.press('Tab')
    await expect.poll(() => background(host)).toBe('rgb(255, 255, 255)')
    await button(host, 'Done').click()
    await expect(picker).toHaveCount(0)
    await expect.poll(() => background(host)).toBe('rgb(255, 255, 255)')
    await focusPage(host)
    await host.keyboard.press('Control+z')
    await expect.poll(() => background(host)).toBe('rgb(229, 43, 43)')
  } finally {
    await close()
  }
})

test('every keyboard shortcut, and none while typing a color or on the Upload Photo tab', async ({ browser }) => {
  test.setTimeout(90_000)
  const { host, close } = await openDrawingTurn(browser)
  try {
    await focusPage(host)
    for (const t of TOOLS.filter((tool) => tool.key)) {
      await host.keyboard.press(t.key)
      await expect(button(host, t.name), `${t.key} picks ${t.name}`).toHaveAttribute('aria-pressed', 'true')
    }
    await host.keyboard.press('h')
    await expect(button(host, 'Behind lines')).toHaveAttribute('aria-pressed', 'true')
    await host.keyboard.press('h')
    await expect(button(host, 'Behind lines')).toHaveAttribute('aria-pressed', 'false')

    // One size button per size, its dot growing with it; the number keys pick
    // them, and [ and ] step without going past either end.
    const sizeButton = (i) => button(host, `Size ${i + 1}, ${SIZES[i]} pixels`)
    await host.keyboard.press('b')
    await expect(host.locator('.toolbox-size')).toHaveCount(SIZES.length)
    const dots = await host.locator('.toolbox-dot').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
    for (let i = 1; i < dots.length; i++) expect(dots[i], `dot ${i + 1}`).toBeGreaterThan(dots[i - 1])
    for (let i = 0; i < SIZES.length; i++) {
      await host.keyboard.press(String(i + 1))
      await expect(sizeButton(i), `key ${i + 1}`).toHaveAttribute('aria-pressed', 'true')
    }
    await host.keyboard.press(String(SIZES.length + 1)) // past the last size: nothing
    await expect(sizeButton(SIZES.length - 1)).toHaveAttribute('aria-pressed', 'true')
    await host.keyboard.press(']')
    await expect(sizeButton(SIZES.length - 1)).toHaveAttribute('aria-pressed', 'true')
    await host.keyboard.press('[')
    await expect(sizeButton(SIZES.length - 2)).toHaveAttribute('aria-pressed', 'true')
    for (let i = 0; i < SIZES.length + 2; i++) await host.keyboard.press('[')
    await expect(sizeButton(0)).toHaveAttribute('aria-pressed', 'true')
    await host.keyboard.press(']')
    await expect(sizeButton(1)).toHaveAttribute('aria-pressed', 'true')

    // Undo and both redo keys.
    const drawn = () => countPixels(host, BLACK, { x: 20, y: 30, w: 110, h: 20 })
    await stroke(host, 40)
    await away(host)
    expect(await drawn()).toBeGreaterThan(20)
    await host.keyboard.press('Control+z')
    expect(await drawn()).toBe(0)
    await host.keyboard.press('Control+y')
    expect(await drawn()).toBeGreaterThan(20)
    await host.keyboard.press('Control+z')
    await host.keyboard.press('Control+Shift+z')
    expect(await drawn()).toBeGreaterThan(20)

    // Typing in the picker's hex field types; it doesn't switch tools.
    await button(host, 'More colors').click()
    await host.locator('.v-color-picker-edit input').pressSequentially('eg')
    await expect(button(host, 'Brush')).toHaveAttribute('aria-pressed', 'true')
    await host.keyboard.press('Escape')
    await expect(host.locator('.v-color-picker')).toHaveCount(0)

    // On the Upload Photo tab, the hidden drawing ignores keys.
    await host.getByRole('tab', { name: /Upload Photo/ }).click()
    await expect(host.locator(CANVAS)).toBeHidden()
    await host.keyboard.press('e')
    await host.keyboard.press('Control+z')
    await host.getByRole('tab', { name: /Draw Picture/ }).click()
    await expect(host.locator(CANVAS)).toBeVisible()
    await expect(button(host, 'Brush')).toHaveAttribute('aria-pressed', 'true')
    expect(await drawn()).toBeGreaterThan(20)
  } finally {
    await close()
  }
})

test('right-click sets the background, custom colors outlast a reload, bad saved ones are dropped, and the PNG saved is 1200 × 800', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const { host, close } = await openDrawingTurn(browser)
  const errors = []
  host.on('pageerror', (e) => errors.push(e.message))
  const KEY = 'telestrations.paint.recentColors'
  const reload = async () => {
    await host.reload()
    await expect(host.locator(CANVAS)).toBeVisible({ timeout: 15_000 })
  }
  try {
    // Right-click: the background changes and the pen stays black.
    await button(host, 'Red').click({ button: 'right' })
    await expect.poll(() => background(host)).toBe('rgb(229, 43, 43)')
    await expect(button(host, 'Pen color')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await expect(button(host, 'Pen color')).toHaveAttribute('aria-pressed', 'true')

    // A custom color is kept on this device through a reload.
    await button(host, 'More colors').click()
    const hex = host.locator('.v-color-picker-edit input')
    await hex.fill('#123456')
    await hex.press('Tab')
    await button(host, 'Done').click()
    await expect(button(host, 'Recent color #123456')).toBeVisible()
    await reload()
    await expect(button(host, 'Recent color #123456')).toBeVisible()

    // Saved colors that aren't colors are dropped; the good ones stay.
    await host.evaluate((key) => localStorage.setItem(key, JSON.stringify(['#ABCDEF', 'red', 7, '#abc', null, '#00FF00'])), KEY)
    await reload()
    await expect(host.locator('.palette-recents .palette-sw')).toHaveCount(2)
    await expect(button(host, 'Recent color #ABCDEF')).toBeVisible()
    await expect(button(host, 'Recent color #00FF00')).toBeVisible()
    await host.evaluate((key) => localStorage.setItem(key, '{not json'), KEY)
    await reload()
    await expect(host.locator('.palette-recents .palette-empty')).toHaveCount(4)
    expect(errors).toEqual([])

    // What Submit saves is a 1200 × 800 PNG: read it back from the server.
    await stroke(host, 40)
    const [saved] = await Promise.all([
      host.waitForResponse((r) => /\/api\/collections\/turns\/records/.test(r.url()) && r.request().method() === 'POST' && r.status() === 200),
      host.locator('.v-window-item--active').getByRole('button', { name: 'Submit' }).click(),
    ])
    const turn = await saved.json()
    const file = Buffer.from(await (await request.get(`${PB_URL}/api/files/${turn.collectionId}/${turn.id}/${turn.drawing}`)).body())
    expect(file.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([1200, 800])
  } finally {
    await close()
  }
})

test('the turn fits the screen: tips beside the canvas when there\'s room, buttons lined up with its edges, stacked and centered on a phone', async ({ browser }) => {
  test.setTimeout(90_000)
  const { host, close } = await openDrawingTurn(browser)
  const box = (locator) => locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
  })
  const rect = (selector) => box(host.locator(selector).first())
  const submit = () => box(host.locator('.v-window-item--active').getByRole('button', { name: 'Submit' }))
  const fits = () => host.evaluate(() => document.documentElement.scrollHeight <= innerHeight)
  const resize = async (width, height) => {
    await host.setViewportSize({ width, height })
    await host.waitForTimeout(200)
  }
  try {
    // A laptop: everything on one screen, the tips beside the canvas, and the
    // top buttons lined up with the outer edges, centered as one block.
    await resize(1280, 720)
    await expect(host.locator('.paint-help')).toBeVisible()
    expect(await fits()).toBe(true)
    const help = await rect('.paint-help')
    const tools = await rect('.toolbox')
    const inner = await rect('.paint-inner')
    const undo = await rect('.paint-edits .v-btn')
    expect(Math.abs((await submit()).right - help.right)).toBeLessThanOrEqual(1)
    expect(Math.abs(undo.left - tools.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(inner.left - (1280 - inner.right))).toBeLessThanOrEqual(2)
    expect((await rect('.palette')).bottom).toBeLessThanOrEqual(720)
    // The tips fit in their box without scrolling, and list every shortcut.
    expect(await host.locator('.paint-help').evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    const listed = await host.locator('.help-keys li').allInnerTexts()
    for (const t of TOOLS.filter((tool) => tool.key)) expect(listed).toContain(`${t.key.toUpperCase()} ${t.name}`)
    expect(listed).toContain('Ctrl Y Redo')
    expect(listed).toContain(`[ ] 1–${SIZES.length} Size`)

    // A 1366 × 768 laptop's window.
    await resize(1366, 658)
    expect(await fits()).toBe(true)
    await expect(host.locator('.paint-help')).toBeVisible()

    // Tall and narrow: no room for tips, so the canvas takes the width and
    // Submit lines up with it.
    await resize(1000, 900)
    await expect(host.locator('.paint-help')).toHaveCount(0)
    expect(await fits()).toBe(true)
    expect(Math.abs((await submit()).right - (await rect('.paint-frame')).right)).toBeLessThanOrEqual(1)

    // A wide phone: the size box sits beside the tools.
    await resize(700, 900)
    const grid = await rect('.toolbox-tools')
    const options = await rect('.toolbox-options')
    expect(options.left).toBeGreaterThan(grid.right)
    expect(Math.abs(options.top - grid.top)).toBeLessThanOrEqual(1)

    // A narrow phone: canvas, then tools, then colors, full width and centered.
    await resize(400, 800)
    await button(host, 'Rectangle').click() // so the shape style shows too
    const frame = await rect('.paint-frame')
    const toolbox = await rect('.toolbox')
    const colors = await rect('.palette')
    expect(frame.bottom).toBeLessThan(toolbox.top)
    expect(toolbox.bottom).toBeLessThan(colors.top)
    expect(Math.abs(frame.width - (await rect('.paint-studio')).width)).toBeLessThanOrEqual(1)
    const offCenter = (outer, first, last) => Math.abs((first.left - outer.left) - (outer.right - last.right))
    const narrowGrid = await rect('.toolbox-tools')
    expect(offCenter(toolbox, narrowGrid, narrowGrid), 'tool grid').toBeLessThanOrEqual(2)
    const lastStyle = await box(host.locator('.toolbox-style-btn').last())
    expect(offCenter(await rect('.toolbox-options'), await rect('.toolbox-size'), lastStyle), 'sizes and style').toBeLessThanOrEqual(2)
    expect(offCenter(colors, await rect('.palette-now'), await rect('.palette-scroll')), 'colors').toBeLessThanOrEqual(2)

    // And on a phone too, switching tools moves nothing.
    const top = async () => (await rect('.palette')).top
    const before = await top()
    for (const t of TOOLS) {
      await button(host, t.name).click()
      expect(await top(), t.name).toBe(before)
    }
  } finally {
    await close()
  }
})

test('a stroke still being drawn when the turn\'s timer runs out is saved as the drawing', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [alpha, bravo] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(alpha, { username: 'alpha', timed: true, seconds: 5 })
    await joinGame(bravo, code, 'bravo')
    await startGame(alpha, 2)
    await bravo.waitForURL(/\/draw$/)
    await submitWord(alpha, 'cat')
    await submitWord(bravo, 'dog')

    // Alpha's first and only stroke, the mouse still down when time runs out.
    await expect(alpha.locator(CANVAS)).toBeVisible({ timeout: 15_000 })
    const canvas = await alpha.locator(CANVAS).boundingBox()
    await alpha.mouse.move(canvas.x + 20, canvas.y + 40)
    await alpha.mouse.down()
    for (let x = 30; x <= 200; x += 10) await alpha.mouse.move(canvas.x + x, canvas.y + 40)
    await Promise.all([alpha.waitForURL(/\/review$/, { timeout: 20_000 }), bravo.waitForURL(/\/review$/, { timeout: 20_000 })])
    await alpha.mouse.up()

    const stories = await expectStoriesAlternate(request, code, 2)
    const users = await (await request.get(`${PB_URL}/api/collections/users/records?filter=${encodeURIComponent(`game_id.game_code="${code}"`)}`)).json()
    const id = Object.fromEntries(users.items.map((u) => [u.username, u.id]))
    const [, alphaDrawing] = stories[id.bravo]
    expect(alphaDrawing).toMatchObject({ skipped: false, timed_out: true })
    expect(alphaDrawing.drawing).not.toBe('')
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
