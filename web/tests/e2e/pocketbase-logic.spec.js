import { test, expect } from '@playwright/test'
import http from 'node:http'
import PocketBase from 'pocketbase'
import { fetchWhole } from '../../src/services/pocketbase/fetchWhole.js'

// The PocketBase SDK cancels a request when another with the same key starts.
// One cancelled after its headers are in, while its body is still on the way,
// must fail as cancelled: the SDK alone answers it with an empty list, which
// blanked the review's list until the next read landed. Against a local server
// standing in for PocketBase; no page is opened.

const LIST = { page: 1, perPage: 500, items: [{ id: 'a' }, { id: 'b' }] }

// A stand-in server. The first list read sends its headers and part of its
// body, then stalls; the rest answer at once. /empty answers 204, /bad 400.
async function startServer() {
  let reads = 0
  let stalled
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/empty')) return res.writeHead(204).end()
    if (req.url.startsWith('/api/bad')) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ message: 'no good' }))
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    const body = JSON.stringify(LIST)
    if (++reads > 1) return res.end(body)
    stalled = res
    res.write(body.slice(0, 12))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      stalled?.destroy()
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    },
  }
}

// Two reads of the same list, the second started once the first's headers are
// in: what the first resolves to (or the error it fails with), and the second.
async function overlappingReads(pb) {
  const realFetch = globalThis.fetch
  let headersIn
  const firstHeaders = new Promise((resolve) => { headersIn = resolve })
  globalThis.fetch = async (...args) => {
    const resp = await realFetch(...args)
    headersIn()
    return resp
  }
  try {
    const first = pb.collection('progress').getFullList({ requestKey: 'list' }).catch((err) => err)
    await firstHeaders
    const second = await pb.collection('progress').getFullList({ requestKey: 'list' })
    return { first: await first, second }
  } finally {
    globalThis.fetch = realFetch
  }
}

test('a read cancelled while its body is on the way fails as cancelled, not as an empty list', async () => {
  // The SDK alone: the cancelled read "succeeds" with nothing in it.
  let server = await startServer()
  try {
    const { first, second } = await overlappingReads(new PocketBase(server.url))
    expect(first).toEqual([])
    expect(second.map((r) => r.id)).toEqual(['a', 'b'])
  } finally {
    await server.close()
  }

  // With every request reading its whole body (as services/pocketbase sets up).
  server = await startServer()
  try {
    const pb = new PocketBase(server.url)
    pb.beforeSend = (url, options) => ({ url, options: { ...options, fetch: fetchWhole } })
    const { first, second } = await overlappingReads(pb)
    expect(first.isAbort).toBe(true)
    expect(second.map((r) => r.id)).toEqual(['a', 'b'])
  } finally {
    await server.close()
  }
})

test('reading the whole body keeps empty answers and errors as they were', async () => {
  const server = await startServer()
  try {
    const pb = new PocketBase(server.url)
    pb.beforeSend = (url, options) => ({ url, options: { ...options, fetch: fetchWhole } })
    // A 204, as the realtime subscription gets: no body to give it.
    expect(await pb.send('/api/empty', { method: 'POST' })).toEqual({})
    // An error keeps its status, message and address.
    const err = await pb.send('/api/bad', {}).catch((e) => e)
    expect(err.status).toBe(400)
    expect(err.message).toBe('no good')
    expect(err.url).toBe(`${server.url}/api/bad`)
    expect(err.isAbort).toBe(false)
  } finally {
    await server.close()
  }
})
