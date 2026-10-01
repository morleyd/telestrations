import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame, submitWord, stroke } from './helpers.js'

// The drawing toolbar's color pickers. A tapped color applies straight away:
// no "Done" needed, and tapping the canvas both closes the picker and draws.

// Count canvas pixels close to `rgb` inside a box (canvas CSS coordinates).
async function countPixels(page, rgb, box) {
  return page.evaluate(([rgb, box]) => {
    const c = document.querySelector('canvas')
    const scale = c.width / c.getBoundingClientRect().width
    const d = c.getContext('2d').getImageData(box.x * scale, box.y * scale, box.w * scale, box.h * scale).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) n++
    }
    return n
  }, [rgb, box])
}

// Picks a color in the open picker, the way a tap on that hexagon does.
const pick = (page, hex) => page.locator(`.v-overlay--active area[alt="${hex}"]`).dispatchEvent('click')

test('a picked color applies immediately, without pressing Done', async ({ browser }) => {
  test.setTimeout(90_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty', timed: false })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)
    await host.waitForTimeout(1500)
    await submitWord(host, 'apple')
    await submitWord(guest, 'pear')
    await expect(host.getByRole('tab', { name: /Upload Photo/ })).toBeVisible({ timeout: 15_000 })
    await expect(host.locator('canvas')).toBeVisible()

    // Red, then straight onto the canvas: the stroke is red.
    await host.getByRole('button', { name: 'Pen color' }).click()
    await pick(host, '#FF0000')
    await stroke(host, 20)
    await expect(host.locator('.v-overlay--active #colorPicker')).toHaveCount(0) // tapping the canvas closed it
    expect(await countPixels(host, [255, 0, 0], { x: 20, y: 10, w: 110, h: 20 })).toBeGreaterThan(20)

    // The background picker changes the background, not the pen.
    await host.getByRole('button', { name: 'Background color' }).click()
    await pick(host, '#FFFF00')
    await host.keyboard.press('Escape')
    expect(await countPixels(host, [255, 255, 0], { x: 150, y: 100, w: 20, h: 20 })).toBeGreaterThan(100)
    await stroke(host, 60)
    expect(await countPixels(host, [255, 0, 0], { x: 20, y: 50, w: 110, h: 20 })).toBeGreaterThan(20)

    // With the eraser on, picking a color switches back to the pen.
    await host.locator('.actions-inner button:has(.mdi-pencil)').click()
    await host.getByRole('button', { name: 'Pen color' }).click()
    await pick(host, '#0000FF')
    await stroke(host, 100)
    expect(await countPixels(host, [0, 0, 255], { x: 20, y: 90, w: 110, h: 20 })).toBeGreaterThan(20)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
