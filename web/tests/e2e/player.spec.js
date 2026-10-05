import { test, expect } from '@playwright/test'
import { avatarColor, initials, sameName } from '../../src/services/player.js'
import { createGame, joinGame, startGame, submitJoin } from './helpers.js'

// Players' names and avatars: a name keeps its capitals but matches in any
// capitals, initials fit the circle, and the avatar picker can be found.

test('initials are the first letters of the first and last words', () => {
  expect(initials('Buddy With A Long Name')).toBe('BN')
  expect(initials('buddy')).toBe('B')
  expect(initials('  sam   lee  ')).toBe('SL')
  expect(initials('')).toBe('')
  expect(initials(undefined)).toBe('')
  // Whole characters: an accent typed as its own mark, or an emoji, stays whole.
  expect(initials('émile zola')).toBe('ÉZ')
  expect(initials('🐮 cow')).toBe('🐮C')
})

test('names match whatever their capitals', () => {
  expect(sameName('Sam', 'sam')).toBe(true)
  expect(sameName('BUDDY', 'Buddy')).toBe(true)
  expect(sameName('Émile', 'émile')).toBe(true)
  // The accent typed as its own mark after the letter is the same name.
  expect(sameName('\u00c9mile', 'e\u0301mile')).toBe(true)
  expect(sameName('Sam', 'Samuel')).toBe(false)
})

// The module is imported by every page, so a browser without Intl.Segmenter
// must still load it; initials then fall back to whole code points.
test('initials work without Intl.Segmenter', async () => {
  const { Segmenter } = Intl
  delete Intl.Segmenter
  try {
    // A fresh copy of the module, loaded with no Segmenter around.
    const fresh = await import('../../src/services/player.js?no-segmenter')
    expect(fresh.initials('Buddy With A Long Name')).toBe('BN')
    expect(fresh.initials('🐮 cow')).toBe('🐮C')
  } finally {
    Intl.Segmenter = Segmenter
  }
})

test('a name gets the same color whatever its capitals', () => {
  expect(avatarColor('Buddy')).toBe(avatarColor('buddy'))
  expect(avatarColor('alpha')).not.toBe(avatarColor('bravo'))
})

// A roster row's name, matched exactly: Playwright's text matching otherwise
// ignores case, which is what these tests are about.
const onRoster = (page, name) => page.locator('.drag-item .item-content').filter({ hasText: new RegExp(`^${name}$`) })

test('a name keeps its capitals, and the same name in other capitals rejoins that seat', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'Hosty McHost' })
  await expect(hostPage.getByText('Welcome Hosty McHost!', { exact: true })).toBeVisible()

  const guestCtx = await browser.newContext()
  await joinGame(await guestCtx.newPage(), code, 'Buddy')
  await expect(onRoster(hostPage, 'Buddy')).toBeVisible({ timeout: 15_000 })

  const otherCtx = await browser.newContext()
  const other = await otherCtx.newPage()
  await submitJoin(other, code, 'BUDDY')
  await expect(other.getByText('"Buddy" is already in this game', { exact: true })).toBeVisible()
  await other.getByRole('button', { name: "That's me, rejoin" }).click()
  await expect(other).toHaveURL(new RegExp(`/${code}$`, 'i'))
  await expect(other.getByText('Welcome Buddy!', { exact: true })).toBeVisible()
  await expect(hostPage.locator('.drag-item')).toHaveCount(2)
  await expect(onRoster(hostPage, 'Buddy')).toBeVisible()

  await hostCtx.close()
  await guestCtx.close()
  await otherCtx.close()
})

// Signing in mid-game takes over a seat, avatar and all, so there's no picker.
test('signing in mid-game finds the seat in any capitals, without an avatar picker', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage)
  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'Buddy')
  await startGame(hostPage, 2)
  await guestPage.waitForURL(/\/draw$/)

  const rescueCtx = await browser.newContext()
  const rescuePage = await rescueCtx.newPage()
  await rescuePage.goto(`/${code}/draw`)
  await rescuePage.getByLabel('Username').fill('buddy')
  await expect(rescuePage.getByRole('button', { name: 'Choose your avatar' })).toHaveCount(0)
  await rescuePage.getByRole('button', { name: 'Join!' }).click()
  await rescuePage.getByRole('button', { name: "That's me, rejoin" }).click()
  await expect(rescuePage.getByText('Enter your starting prompt')).toBeVisible()

  await hostCtx.close()
  await guestCtx.close()
  await rescueCtx.close()
})

test('a player can recapitalize their own name, but not take another player\'s', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const hostPage = await hostCtx.newPage()
  const code = await createGame(hostPage, { username: 'hosty' })
  const guestCtx = await browser.newContext()
  const guestPage = await guestCtx.newPage()
  await joinGame(guestPage, code, 'buddy')

  const rename = async (name) => {
    await guestPage.locator('.drag-item', { hasText: 'buddy' }).getByRole('button').first().click()
    await guestPage.getByLabel('Username').fill(name)
    await guestPage.getByRole('dialog').getByRole('button', { name: 'Submit' }).click()
  }
  await rename('HOSTY')
  await expect(guestPage.getByText('Username already exists')).toBeVisible()
  await guestPage.keyboard.press('Escape')

  await rename('Buddy')
  await expect(guestPage.getByText('Welcome Buddy!', { exact: true })).toBeVisible()
  await expect(onRoster(hostPage, 'Buddy')).toBeVisible({ timeout: 15_000 })
  await expect(onRoster(hostPage, 'buddy')).toHaveCount(0)
  await expect(onRoster(hostPage, 'hosty')).toBeVisible()

  await hostCtx.close()
  await guestCtx.close()
})

// The roster's avatar, and its two letters' box inside it.
async function initialsFit(locator) {
  const circle = await locator.boundingBox()
  const letters = await locator.locator('.avatar-initials').boundingBox()
  return letters.x >= circle.x && letters.x + letters.width <= circle.x + circle.width
}

test('initials of a many-word name fit the avatar', async ({ page }) => {
  // M and W are about the widest pair.
  await createGame(page, { username: 'Mighty Mouse With Wings' })
  const avatar = page.locator('.drag-item .v-avatar')
  await expect(avatar).toHaveText('MW')
  expect(await initialsFit(avatar)).toBe(true)
  expect(await initialsFit(page.locator('header .v-avatar'))).toBe(true)
})

test('the avatar picker is a labeled button from the start, and the face picked sticks', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Game' }).click()
  // Before any name is typed.
  const picker = page.getByRole('button', { name: 'Choose your avatar' })
  await expect(picker).toBeVisible()
  await expect(picker).toContainText('Pick avatar')

  await page.getByLabel('Username').fill('hosty')
  await picker.click()
  await expect(page.getByText('Pick your avatar')).toBeVisible()
  await page.locator('#avatar5').click()
  await page.getByRole('button', { name: 'Submit' }).click()
  // The face (every avatar also has a scrap of paper behind it, an svg too)
  await expect(picker.locator('.avatar-circle')).toHaveCount(1)

  // Drawn across the circle, not laid out as nothing (as Safari did when the
  // face's svg had no width)
  const face = await picker.locator('.avatar-circle svg').boundingBox()
  expect(face.width).toBe(56)

  await page.getByRole('button', { name: 'Begin!' }).click()
  await expect(page.locator('.drag-item .avatar-circle')).toHaveCount(1)

  // Editing the name opens the picker on that face, so submitting it as is
  // keeps the face rather than switching back to initials.
  await page.locator('.drag-item').getByRole('button').first().click()
  await picker.click()
  await expect(page.getByText('Pick your avatar')).toBeVisible()
  await page.getByRole('button', { name: 'Submit' }).last().click()
  await expect(page.getByText('Pick your avatar')).toBeHidden()
  await expect(picker.locator('.avatar-circle')).toHaveCount(1)
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText('Edit your Username!')).toBeHidden()
  await expect(page.locator('.drag-item .avatar-circle')).toHaveCount(1)

  // Picking the letters takes the saved face off again.
  await page.locator('.drag-item').getByRole('button').first().click()
  await picker.click()
  await page.locator('#avatar1').click()
  await page.getByRole('button', { name: 'Submit' }).last().click()
  await expect(page.getByText('Pick your avatar')).toBeHidden()
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText('Edit your Username!')).toBeHidden()
  await expect(page.locator('.drag-item .avatar-circle')).toHaveCount(0)
  await expect(page.locator('.drag-item .v-avatar')).toHaveText('H')
})
