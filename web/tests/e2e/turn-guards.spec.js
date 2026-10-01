import { test, expect } from '@playwright/test'
import { PB_URL, PNG_PIXEL } from './helpers.js'

// The server refuses turns of the wrong kind (wrongTurnType in host.go). A page
// running an out-of-date build once drew where it should have guessed, and every
// later turn in that story was garbled. API-only: no browser needed.

async function setUpGame(request, { roundDuration = -1 } = {}) {
  const post = async (path, data) => {
    const r = await request.post(`${PB_URL}${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const game = await post('/api/collections/games/records', {
    game_code: `g${Date.now().toString(36)}`, roundDuration,
  })
  const users = []
  for (const [i, name] of ['ann', 'ben', 'cat'].entries()) {
    users.push(await post('/api/collections/users/records', {
      username: name, avatar: '', color: '#123456', game_id: game.id, is_host: i === 0,
    }))
  }
  await post(`/api/games/${game.id}/begin`, { order: users.map((u) => u.id) })
  const story = await post('/api/collections/stories/records', { starter_id: users[0].id, game_id: game.id })
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
