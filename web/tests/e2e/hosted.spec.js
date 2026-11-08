import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { startGame, submitWord, submitDrawing, turnState, turnCreated, joinGame, createGame } from './helpers.js'

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

test('two devices play a game together, one drawing with a phone photo', async ({ browser }) => {
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
    await guest.waitForURL(/\/draw$/)
    let photo = false
    const done = new Set()
    const deadline = Date.now() + 150_000
    while (done.size < 2) {
      if (Date.now() > deadline) throw new Error(`no review in time (done: ${[...done].join(', ')})`)
      let acted = false
      for (const page of [host, guest]) {
        if (done.has(page)) continue
        const state = await turnState(page)
        if (state === 'review') done.add(page)
        else if (state === 'word') await submitWord(page, 'smoke')
        else if (state === 'draw' && page === host && !photo) {
          await drawWithPhoto(page)
          photo = true
        } else if (state === 'draw') await submitDrawing(page)
        acted ||= state === 'word' || state === 'draw'
      }
      if (!acted) await host.waitForTimeout(400)
    }
    expect(photo).toBe(true)
    await expect(host.getByText('Stories are deleted 48 hours after the game ends.')).toBeVisible()
    expect(problems).toEqual([])
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// drawWithPhoto submits a phone photo (HEIC) as the drawing, converted to JPEG
// in the browser.
async function drawWithPhoto(page) {
  await page.getByRole('tab', { name: /Upload Photo/ }).click()
  await page.locator('#fileInput').setInputFiles({ name: 'IMG_0001.HEIC', mimeType: '', buffer: HEIC })
  await expect(page.locator('.v-window-item--active .v-img img')).toHaveJSProperty('naturalWidth', 16, { timeout: 30_000 })
  await Promise.all([turnCreated(page), page.locator('.v-window-item--active').getByRole('button', { name: 'Submit' }).click()])
}
