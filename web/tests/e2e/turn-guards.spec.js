import { test, expect } from '@playwright/test'
import { PB_URL, PNG_PIXEL } from './helpers.js'

// The server's guards on client writes (bindTurnGuards in host.go). A page
// running an out-of-date build once drew where it should have guessed, and every
// later turn in that story was garbled; a refused write carries a code the
// client acts on. API-only: no browser needed.

const post = (request) => async (path, data) => {
  const r = await request.post(`${PB_URL}${path}`, { data })
  expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
  return r.json()
}

async function setUpLobby(request, { roundDuration = -1 } = {}) {
  const game = await post(request)('/api/collections/games/records', {
    game_code: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, roundDuration,
  })
  const users = []
  for (const [i, name] of ['ann', 'ben', 'cat'].entries()) {
    users.push(await post(request)('/api/collections/users/records', {
      username: name, avatar: '', color: '#123456', game_id: game.id, is_host: i === 0,
    }))
  }
  return { game, users }
}

async function setUpGame(request, { roundDuration = -1 } = {}) {
  const { game, users } = await setUpLobby(request, { roundDuration })
  await post(request)(`/api/games/${game.id}/begin`, { order: users.map((u) => u.id) })
  const story = await post(request)('/api/collections/stories/records', { starter_id: users[0].id, game_id: game.id })
  return { game, users, story }
}

function turn(request, { game, story }, user, isDrawing) {
  return request.post(`${PB_URL}/api/collections/turns/records`, {
    multipart: {
      user_id: user.id, story_id: story.id, game_id: game.id, is_drawing: String(isDrawing),
      prompt: isDrawing ? '' : 'a word',
      ...(isDrawing ? { drawing: { name: 'd.png', mimeType: 'image/png', buffer: PNG_PIXEL } } : {}),
    },
  })
}

test('a story must open with a word, and a drawing never follows a drawing', async ({ request }) => {
  const g = await setUpGame(request)
  const [ann, ben, cat] = g.users

  const openingDrawing = await turn(request, g, ann, true)
  expect(openingDrawing.status()).toBe(400)
  expect((await openingDrawing.json()).message).toMatch(/needs a starting word/)

  expect((await turn(request, g, ann, false)).ok()).toBe(true)
  expect((await turn(request, g, ben, true)).ok()).toBe(true)

  const secondDrawing = await turn(request, g, cat, true)
  expect(secondDrawing.status()).toBe(400)
  expect((await secondDrawing.json()).message).toMatch(/needs a guess/)
  expect((await turn(request, g, cat, false)).ok()).toBe(true)
})

test('a word after a word is refused, timed game or not', async ({ request }) => {
  // A timed-out drawing turn with a blank canvas is skipped by the server now
  // (it used to submit the word again), so no client should ever do this.
  for (const roundDuration of [-1, 60]) {
    const g = await setUpGame(request, { roundDuration })
    expect((await turn(request, g, g.users[0], false)).ok()).toBe(true)
    const refused = await turn(request, g, g.users[1], false)
    expect(refused.status(), `roundDuration ${roundDuration}`).toBe(400)
    expect((await refused.json()).message).toMatch(/needs a drawing/)
  }
})

const code = async (resp) => (await resp.json()).data?.code?.code

test('a refused turn says why with a code: taken, or not yours', async ({ request }) => {
  const g = await setUpGame(request)
  const [ann, , cat] = g.users
  expect((await turn(request, g, ann, false)).ok()).toBe(true)

  const again = await turn(request, g, ann, true)
  expect(again.status()).toBe(400)
  expect(await code(again)).toBe('turn_taken')

  const early = await turn(request, g, cat, true)
  expect(early.status()).toBe(400)
  expect(await code(early)).toBe('not_your_turn')
})

test('a finished story takes no more turns, not even one with no player', async ({ request }) => {
  const g = await setUpGame(request, { roundDuration: 60 })
  const [ann, ben, cat] = g.users
  for (const [user, isDrawing] of [[ann, false], [ben, true], [cat, false]]) {
    expect((await turn(request, g, user, isDrawing)).ok()).toBe(true)
  }

  const nobody = await turn(request, g, { id: '' }, true)
  expect(nobody.status()).toBe(400)
  expect(await code(nobody)).toBe('not_your_turn')
  const timeout = await request.post(`${PB_URL}/api/stories/${g.story.id}/timeout`, { data: { user_id: '' } })
  expect(timeout.status()).toBe(400)

  const turns = await (await request.get(
    `${PB_URL}/api/collections/turns/records?filter=${encodeURIComponent(`story_id="${g.story.id}"`)}`,
  )).json()
  expect(turns.totalItems).toBe(3)
})

test('an untimed game refuses timeouts', async ({ request }) => {
  const g = await setUpGame(request)
  const resp = await request.post(`${PB_URL}/api/stories/${g.story.id}/timeout`, { data: { user_id: g.users[0].id } })
  expect(resp.status()).toBe(400)
  expect((await resp.json()).message).toMatch(/no round timer/)
})

test('only the player who created a game is its host', async ({ request }) => {
  // Joining as a second host is ignored...
  const lobby = await setUpLobby(request)
  const extra = await post(request)('/api/collections/users/records', {
    username: 'dee', avatar: '', color: '#123456', game_id: lobby.game.id, is_host: true,
  })
  expect(extra.is_host).toBe(false)
  expect(lobby.users.map((u) => u.is_host)).toEqual([true, false, false])

  // ...and so is promoting yourself mid-game, which would unlock Skip/Drop.
  const g = await setUpGame(request)
  const [, ben, cat] = g.users
  const patched = await request.patch(`${PB_URL}/api/collections/users/records/${ben.id}`, {
    data: { is_host: true, position: 7, username: 'benny' },
  })
  expect(patched.ok()).toBe(true)
  expect(await patched.json()).toMatchObject({ is_host: false, username: 'benny' })
  expect((await patched.json()).position).not.toBe(7)

  const skip = await request.post(`${PB_URL}/api/games/${g.game.id}/players/${cat.id}/skip`, { data: { host_id: ben.id } })
  expect(skip.status()).toBe(403)
})
