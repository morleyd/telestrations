import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { startGame, submitWord, submitDrawing, turnState, turnCreated, joinGame, createGame, driveGameToReview } from './helpers.js'

// Checks a deployed server in public mode (DEPLOY.md: `make -C web hosted
// URL=https://...`): its headers, that the dashboard and other games stay
// hidden, and real games played in browsers through its CSP, with not one
// policy violation. Skipped unless HOSTED_URL is set.

const URL = process.env.HOSTED_URL
test.skip(!URL, 'checks a deployed server; set HOSTED_URL')

// A tiny HEIC (16 × 16), converted to JPEG in the browser before upload.
const HEIC = Buffer.from('AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADQAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAEAAAAAEAAAAQAAAAAf///9AAAAAC////0AAAAAIAAAAQcGl4aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAAPG1kYXQAAAAwKAGvEyFmY0D4EPdn/+u8Ff+Vaz/zN7HpzshHQMDSIICbQEiTXVALFhCAh3alVtz4', 'base64')

// Collects any CSP violation or page error on page.
function watch(page, problems) {
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
}

test('the server is in public mode', async ({ request }) => {
  const home = await request.get(URL)
  expect(home.status()).toBe(200)
  const h = home.headers()
  expect(h['strict-transport-security']).toContain('max-age=')
  expect(h['content-security-policy']).toContain("default-src 'self'")
  expect(h['x-frame-options']).toBe('DENY')
  expect((await request.get(`${URL}/_/`)).status()).toBe(404)
  const guess = await request.get(`${URL}/api/collections/games/records`, { headers: { 'X-Game-Code': 'zzzzz' } })
  expect((await guess.json()).items).toEqual([])
  expect((await request.get(`${URL}/api/expiry`)).status()).toBe(200)
})

test('one person plays a whole game with the bots', async ({ page }) => {
  test.setTimeout(240_000)
  const problems = []
  watch(page, problems)
  await page.goto('/')
  await page.getByRole('button', { name: 'Play with bots' }).click()
  await page.getByLabel('Username').fill('smoke')
  await page.getByRole('button', { name: 'Begin!' }).click()
  await page.waitForURL(/\/[a-z]{5}$/)
  await startGame(page, 4)
  const deadline = Date.now() + 200_000
  let turns = 0
  for (;;) {
    const state = await turnState(page)
    if (state === 'review') break
    if (Date.now() > deadline) throw new Error(`no review after ${turns} turns (state: ${state})`)
    if (state === 'word') await submitWord(page, `smoke ${turns++}`)
    else if (state === 'draw') {
      // The first drawing is a phone photo, converted in the browser.
      if (turns === 1) {
        await page.getByRole('tab', { name: /Upload Photo/ }).click()
        await page.locator('#fileInput').setInputFiles({ name: 'IMG_0001.HEIC', mimeType: '', buffer: HEIC })
        await expect(page.locator('.v-window-item--active .v-img img')).toHaveJSProperty('naturalWidth', 16, { timeout: 30_000 })
        await Promise.all([turnCreated(page), page.locator('.v-window-item--active').getByRole('button', { name: 'Submit' }).click()])
      } else {
        await submitDrawing(page)
      }
      turns++
    } else await page.waitForTimeout(500)
  }
  await expect(page.getByText('Stories are deleted 48 hours after the game ends.')).toBeVisible()
  expect(problems).toEqual([])
})

test('two devices play a game together', async ({ browser }) => {
  test.setTimeout(180_000)
  const problems = []
  const contexts = [await browser.newContext(), await browser.newContext()]
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  watch(host, problems)
  watch(guest, problems)
  try {
    const code = await createGame(host, { username: 'smoke-host' })
    await joinGame(guest, code, 'smoke-guest')
    await startGame(host, 2)
    await driveGameToReview([host, guest])
    expect(problems).toEqual([])
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
