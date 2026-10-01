import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { createGame, joinGame, startGame, startThreePlayerGame, driveGameToReview, submitWord } from './helpers.js'

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
    await expect(host.locator('.user-item', { hasText: 'hosty' })).toContainText('1 / 2')
    await host.locator('.user-item', { hasText: 'hosty' }).click()
    await expect(host.locator('.v-carousel').getByText('a teapot')).toBeVisible()

    // buddy opens the link mid-turn, and goes back to it.
    await guest.goto(`/${code}/review`)
    await expect(guest.locator('.user-item', { hasText: 'buddy' })).toContainText('0 / 2')
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

    await page.locator('.user-item', { hasText: player.name }).click()
    for (let k = 0; k < 3; k++) await page.locator('.v-window__right').click()
    await expect(visible('.v-window-item')).toHaveCount(1)
    await expect(page.getByText(`That's ${player.name}'s story!`)).toBeVisible()

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
