import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { createGame, startGame, submitWord, turnState, PNG_PIXEL } from './helpers.js'

// The Upload Photo tab: an iPhone's HEIC goes up as a JPEG every browser can
// show, and a type only some browsers draw is turned away before it's sent.

// A 16x16 HEIC, as an iPhone takes them (heif-enc from a red square).
const HEIC = Buffer.from('AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADQAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAEAAAAAEAAAAQAAAAAf///9AAAAAC////0AAAAAIAAAAQcGl4aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAAPG1kYXQAAAAwKAGvEyFmY0D4EPdn/+u8Ff+Vaz/zN7HpzshHQMDSIICbQEiTXVALFhCAh3alVtz4', 'base64')
const TIFF = Buffer.from('II*\0\x08\0\0\0\0\0\0\0', 'binary')

async function toDrawing(page) {
  await createGame(page, { username: 'solo', endless: true })
  await startGame(page)
  await submitWord(page, 'a red square')
  await expect.poll(() => turnState(page), { timeout: 15_000 }).toBe('draw')
  await page.getByRole('tab', { name: /Upload Photo/ }).click()
}

const pick = (page, name, mimeType, buffer) => page.locator('#fileInput').setInputFiles({ name, mimeType, buffer })
const submit = (page) => page.locator('.v-window-item--active').getByRole('button', { name: 'Submit' })

test('a HEIC photo is converted and saved as a JPEG', async ({ page }) => {
  await toDrawing(page)
  // Some browsers give a HEIC no type at all: it's told by its bytes.
  await pick(page, 'IMG_0001.HEIC', '', HEIC)
  const preview = page.locator('.v-window-item--active .v-img img')
  await expect(preview).toHaveJSProperty('naturalWidth', 16, { timeout: 20_000 })

  const [created] = await Promise.all([
    page.waitForResponse((r) => /\/api\/collections\/turns\/records/.test(r.url()) &&
      r.request().method() === 'POST' && r.status() === 200),
    submit(page).click(),
  ])
  expect((await created.json()).drawing).toMatch(/^img_0001_\w+\.jpg$/)
})

test('a picture picked while a HEIC is still converting is the one kept', async ({ page }) => {
  await toDrawing(page)
  // A stand-in decoder that finishes when the test says, with a 3x3 picture.
  await page.route(/heic-to/, (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export const heicTo = () => new Promise((resolve) => {
      window.finishHeic = () => resolve(new OffscreenCanvas(3, 3).convertToBlob())
    })`,
  }))
  await pick(page, 'IMG_0001.HEIC', '', HEIC)
  await page.waitForFunction(() => window.finishHeic)
  await pick(page, 'd.png', 'image/png', PNG_PIXEL)
  const preview = page.locator('.v-window-item--active .v-img img')
  await expect(preview).toHaveJSProperty('naturalWidth', 1)

  // The HEIC finishing after doesn't replace it, or bring the spinner back.
  await page.evaluate(() => window.finishHeic())
  await page.waitForTimeout(500)
  await expect(preview).toHaveJSProperty('naturalWidth', 1)
  await expect(page.getByText('Getting your picture ready')).toHaveCount(0)
})

test('a TIFF is turned away before it is sent, and another picture can follow', async ({ page }) => {
  await toDrawing(page)
  let sent = 0
  page.on('request', (r) => { if (/\/api\/collections\/turns\/records/.test(r.url()) && r.method() === 'POST') sent++ })

  await pick(page, 'scan.tiff', 'image/tiff', TIFF)
  await expect(page.getByText("That kind of picture can't be used here. Try a JPEG or PNG.")).toBeVisible()
  await expect(submit(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upload a File' })).toBeVisible()
  expect(sent).toBe(0)

  // The same TIFF again still gets an answer (the input was reset)...
  await page.getByText("That kind of picture can't be used here.").waitFor({ state: 'hidden', timeout: 15_000 })
  await pick(page, 'scan.tiff', 'image/tiff', TIFF)
  await expect(page.getByText("That kind of picture can't be used here. Try a JPEG or PNG.")).toBeVisible()
  // ...and a PNG after it goes through.
  await pick(page, 'd.png', 'image/png', PNG_PIXEL)
  await expect(submit(page)).toBeVisible()
})

test('a picture the server refuses says why and stays on screen', async ({ page }) => {
  await toDrawing(page)
  await page.route('**/api/collections/turns/records', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 400, message: "That kind of picture can't be used here. Try a JPEG or PNG.",
        data: { code: { code: 'unsupported_picture', message: 'unsupported_picture' } },
      }),
    })
  })
  await pick(page, 'd.png', 'image/png', PNG_PIXEL)
  await submit(page).click()
  await expect(page.getByText("That kind of picture can't be used here. Try a JPEG or PNG.")).toBeVisible()
  expect(await turnState(page)).toBe('draw')
})
