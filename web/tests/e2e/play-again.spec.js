import { test, expect } from '@playwright/test'
import { createGame, joinGame, startGame, driveGameToReview, submitWord, turnState, PB_URL } from './helpers.js'

// Play again: when a game is over, the host starts a new one from the review
// with the same players (changing the settings if they like), and everybody
// goes straight to their first turn, without leaving and rejoining.

const gameByCode = async (request, code) => {
  const filter = encodeURIComponent(`game_code="${code.toLowerCase()}"`)
  return (await (await request.get(`${PB_URL}/api/collections/games/records?filter=${filter}`)).json()).items[0]
}
const codeOf = (page) => new URL(page.url()).pathname.split('/')[1]

test('the host starts a new game with the same players, straight from the review', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  const [host, guest, pal] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'buddy')
    await joinGame(pal, code, 'pal')
    await startGame(host, 3)
    await Promise.all([guest.waitForURL(/\/draw$/), pal.waitForURL(/\/draw$/)])
    await host.waitForTimeout(2000)
    await driveGameToReview([host, guest, pal])
    // pal wanders off before the host starts again.
    await pal.goto('/')

    // Only the host can start one.
    await expect(host.getByRole('button', { name: 'Start new game' })).toBeVisible()
    await expect(guest.locator('.user-item').first()).toBeVisible()
    await expect(guest.getByRole('button', { name: 'Start new game' })).toHaveCount(0)

    // The dialog starts from this game's settings; the host wants two rounds.
    await host.getByRole('button', { name: 'Start new game' }).click()
    const dialog = host.getByRole('dialog')
    await expect(dialog.getByLabel('Rounds', { exact: true })).toHaveValue('1')
    await dialog.getByLabel('Rounds', { exact: true }).fill('2')
    await dialog.getByRole('button', { name: 'Start!' }).click()

    // Everybody's straight into the new game.
    await Promise.all([host.waitForURL(/\/draw$/), guest.waitForURL(/\/draw$/)])
    expect(codeOf(host)).not.toBe(code)
    expect(codeOf(guest)).toBe(codeOf(host))
    await expect(host.getByText('Enter your starting prompt')).toBeVisible()
    await expect(guest.getByText('Enter your starting prompt')).toBeVisible()
    const next = await gameByCode(request, codeOf(host))
    expect(next).toMatchObject({ rounds: 2, endless: false, isStarted: true })
    expect((await gameByCode(request, code)).next_game).toBe(next.id)

    // As themselves: their opening words go in.
    await submitWord(host, 'round two')
    await submitWord(guest, 'here we go')

    // pal comes back by the old game's link: it points to the new one, rather
    // than pulling them away from the old stories.
    await pal.goto(`/${code}/review`)
    await expect(pal.getByText('The host started a new game.')).toBeVisible()
    await pal.getByRole('button', { name: 'Join the new game' }).click()
    await pal.waitForURL(new RegExp(`/${codeOf(host)}/draw$`))
    await expect(pal.getByText('Enter your starting prompt')).toBeVisible()
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// A phone that sleeps through the moment the host starts again misses the
// realtime event; it must still get its player across once it's back.
test('a player who misses the new game starting still gets moved across', async ({ browser }) => {
  test.setTimeout(120_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty' })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)
    await host.waitForTimeout(2000)
    await driveGameToReview([host, guest])
    await expect(guest.locator('.user-item').first()).toBeVisible()

    await contexts[1].setOffline(true)
    await host.getByRole('button', { name: 'Start new game' }).click()
    await host.getByRole('dialog').getByRole('button', { name: 'Start!' }).click()
    await host.waitForURL(/\/draw$/)
    await guest.waitForTimeout(1000)
    await contexts[1].setOffline(false)

    await guest.waitForURL(new RegExp(`/${codeOf(host)}/draw$`), { timeout: 20_000 })
    await expect(guest.getByText('Enter your starting prompt')).toBeVisible()
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})

// An endless game is only done once the host has ended it and the countdown
// (and the grace after it) is over, and nothing is written at that moment:
// the host's review must notice by itself.
test('after End Game, the host can start a new game without reloading', async ({ browser }) => {
  test.setTimeout(120_000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    const code = await createGame(host, { username: 'hosty', endless: true })
    await joinGame(guest, code, 'buddy')
    await startGame(host, 2)
    await guest.waitForURL(/\/draw$/)
    await host.waitForTimeout(2000)
    for (const page of [host, guest]) {
      await expect.poll(() => turnState(page)).toBe('word')
      await submitWord(page, 'the opening word')
    }

    await host.getByRole('button', { name: 'Manage players' }).click()
    host.once('dialog', (d) => d.accept())
    await host.getByRole('button', { name: 'End Game' }).click()
    await Promise.all([host.waitForURL(/\/review$/, { timeout: 20_000 }), guest.waitForURL(/\/review$/, { timeout: 20_000 })])
    await expect(host.getByRole('button', { name: 'Start new game' })).toBeVisible({ timeout: 20_000 })

    await host.getByRole('button', { name: 'Start new game' }).click()
    await expect(host.getByRole('dialog').getByLabel('Infinite')).toBeChecked() // this game's settings
    await host.getByRole('dialog').getByRole('button', { name: 'Start!' }).click()
    await Promise.all([host.waitForURL(/\/draw$/), guest.waitForURL(/\/draw$/)])
    expect(codeOf(guest)).toBe(codeOf(host))
    expect(codeOf(host)).not.toBe(code)
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
