import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame, submitWord, stroke } from './helpers.js'

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
