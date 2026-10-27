import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { createGame, startGame, submitWord, turnState, PNG_PIXEL, PB_URL } from './helpers.js'

// The Upload Photo tab: an iPhone's HEIC goes up as a JPEG every browser can
// show, a big photo is shrunk to fit, and a type only some browsers draw is
// turned away before it's sent.

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
const preview = (page) => page.locator('.v-window-item--active .v-img img')

// Submits the turn on screen, and gives back the saved drawing's bytes.
async function submitAndFetch(page) {
  const [created] = await Promise.all([
    page.waitForResponse((r) => /\/api\/collections\/turns\/records/.test(r.url()) &&
      r.request().method() === 'POST' && r.status() === 200),
    submit(page).click(),
  ])
  const turn = await created.json()
  const file = await page.request.get(`${PB_URL}/api/files/turns/${turn.id}/${turn.drawing}`)
  return { name: turn.drawing, bytes: await file.body() }
}

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

// A photo as a phone takes it: big, noisy (so it doesn't compress away), and
// stored on its side with an EXIF orientation of 6 ("turn 90° clockwise to
// show"), so upright it's 2000 wide by 4000 tall. Picked in the page, as it's
// made there; gives back its size in bytes.
async function pickSidewaysPhoto(page) {
  return page.evaluate(async () => {
    const canvas = new OffscreenCanvas(4000, 2000)
    const ctx = canvas.getContext('2d')
    const pixels = ctx.createImageData(4000, 2000)
    for (let i = 0; i < pixels.data.length; i += 65536) crypto.getRandomValues(pixels.data.subarray(i, i + 65536))
    ctx.putImageData(pixels, 0, 0)
    const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 1 })).arrayBuffer())
    // An APP1 Exif segment with just the orientation, right after the JPEG's start.
    const exif = Uint8Array.from([
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1, its length, "Exif\0\0"
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, first IFD at 8
      0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // Orientation = 6
      0x00, 0x00, 0x00, 0x00, // no next IFD
    ])
    const photo = new File([jpeg.subarray(0, 2), exif, jpeg.subarray(2)], 'IMG_0620.JPG', { type: 'image/jpeg' })
    const input = document.querySelector('#fileInput')
    const picked = new DataTransfer()
    picked.items.add(photo)
    input.files = picked.files
    input.dispatchEvent(new Event('change'))
    return photo.size
  })
}

test('a big photo is shrunk to a smaller JPEG, the right way up', async ({ page }) => {
  test.setTimeout(60_000)
  await toDrawing(page)
  const size = await pickSidewaysPhoto(page)
  // Over PocketBase's default cap of 5 MB, which refused it before.
  expect(size).toBeGreaterThan(5 << 20)

  // Upright, and 1600 on its long side.
  await expect(preview(page)).toHaveJSProperty('naturalHeight', 1600, { timeout: 20_000 })
  await expect(preview(page)).toHaveJSProperty('naturalWidth', 800)

  const saved = await submitAndFetch(page)
  expect(saved.name).toMatch(/^img_0620_\w+\.jpg$/)
  expect(saved.bytes.length).toBeLessThan(size)
  expect(saved.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
})

// A 1x1 GIF, and then padding to make it big, which a browser ignores.
const BIG_GIF = Buffer.concat([
  Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'),
  Buffer.alloc(3 << 20),
])

test('a big GIF goes up byte for byte, so it still moves', async ({ page }) => {
  await toDrawing(page)
  await pick(page, 'party.gif', 'image/gif', BIG_GIF)
  await expect(preview(page)).toHaveJSProperty('naturalWidth', 1)

  const saved = await submitAndFetch(page)
  expect(saved.name).toMatch(/^party_\w+\.gif$/)
  expect(saved.bytes.equals(BIG_GIF)).toBe(true)
})

test('a picture too big for the server says so and stays on screen', async ({ page }) => {
  await toDrawing(page)
  // PocketBase's answer to a drawing over turns.drawing's maxSize.
  await page.route('**/api/collections/turns/records', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 400, message: 'Failed to create record.',
        data: {
          drawing: {
            code: 'validation_file_size_limit',
            message: 'Failed to upload d.png - the maximum allowed file size is 20971520 bytes.',
            params: { file: 'd.png', maxSize: 20971520 },
          },
        },
      }),
    })
  })
  await pick(page, 'd.png', 'image/png', PNG_PIXEL)
  await submit(page).click()
  await expect(page.getByText('That picture is too big. Try a smaller one.')).toBeVisible()
  await expect(page.getByText('Failed to create record')).toHaveCount(0)
  expect(await turnState(page)).toBe('draw')
  await expect(submit(page)).toBeVisible()
})
