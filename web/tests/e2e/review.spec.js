import { test, expect } from '@playwright/test'
import { startThreePlayerGame, driveGameToReview } from './helpers.js'

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
