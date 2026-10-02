import { test, expect } from '@playwright/test'
import { avatarPaper, scrapColor } from '../../src/services/avatarPaper.js'

// The cut paper an avatar is made of. No page is opened.

const NAMES = ['theo', 'Priya', 'Sam', 'Jonas Berg', 'Ana', 'Kofi', 'Maya Lin', 'zed', 'hosty', 'buddy', 'alpha',
  'bravo', 'charlie', 'Mia', 'Leo', 'Ava', 'Noah', 'Zoe', 'Eli', 'Ivy', 'Omar', 'Lena', 'Raj', 'Bea']

test('a name always gets the same paper, and different names get their own', () => {
  expect(avatarPaper('Maya Lin')).toEqual(avatarPaper('Maya Lin'))
  expect(new Set(NAMES.map((n) => avatarPaper(n).scrap.path)).size).toBe(NAMES.length)
  expect(new Set(NAMES.map((n) => avatarPaper(n).cut)).size).toBe(NAMES.length)
})

test('the scrap lies under the avatar like a shadow, a little off center, any way round', () => {
  const names = [...NAMES, ...Array.from({ length: 56 }, (_, i) => `player ${i}`)]
  const octants = Array(8).fill(0)
  for (const name of names) {
    const { x, y, size } = avatarPaper(name).scrap
    // A little bigger than the avatar
    expect(size, name).toBeGreaterThanOrEqual(1.1)
    expect(size, name).toBeLessThanOrEqual(1.22 + 1e-3)
    // Its center only 10-17% of the avatar's size off the avatar's
    const [dx, dy] = [x + size / 2 - 0.5, y + size / 2 - 0.5]
    const off = Math.hypot(dx, dy)
    expect(off, name).toBeGreaterThanOrEqual(0.1 - 1e-3)
    expect(off, name).toBeLessThanOrEqual(0.17 + 1e-3)
    octants[Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 8) % 8]++
  }
  // Not stuck in a few directions: every eighth of the way round gets some,
  // and none gets a quarter of them
  for (const count of octants) {
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(names.length / 4)
  }
})

test('the scrap is the avatar color\'s complement, a little darker', () => {
  expect(scrapColor('hsl(210, 80%, 65%)')).toBe('hsl(30, 80%, 55%)')
  expect(scrapColor('hsl(300, 70%, 40%)')).toBe('hsl(120, 70%, 35%)')
  // Anything not hsl() (none are, today) gets a paper color instead
  expect(scrapColor('#ff0000')).toBe('rgb(var(--v-theme-secondary))')
  expect(scrapColor(undefined)).toBe('rgb(var(--v-theme-secondary))')
})
