// Client-side event log, shipped to the backend (/api/client-log) so a game
// night played across several devices can be reconstructed afterwards from one
// place: the PocketBase dashboard's Logs view (filter e.g. `data.game = "abcde"`),
// instead of needing devtools open on every phone.
//
// Entries are batched and flushed every couple of seconds, immediately on
// warn/error, and via sendBeacon when the tab is hidden or closed. Logging must
// never break the game, so every failure here is swallowed.
import { pb } from '@/services/pocketbase'

const FLUSH_MS = 2000
const MAX_BUFFER = 200

// Per-tab id so two tabs for the same player can be told apart. Not
// crypto.randomUUID: that only exists in secure contexts, and LAN play is plain
// http://<ip>.
const session = Math.random().toString(36).slice(2, 10)
const browser = detectBrowser(navigator.userAgent)
const context = {}
let seq = 0
let buffer = []
let timer = null

function detectBrowser(ua) {
  // Order matters: Edge/Opera/Brave-in-Chrome all include "Chrome", and
  // Chrome includes "Safari".
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Edg\//.test(ua)) return 'edge'
  if (/OPR\//.test(ua)) return 'opera'
  if (navigator.brave) return 'brave'
  if (/CriOS|Chrome\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua)) return 'safari'
  return 'other'
}

function endpoint() {
  return pb.buildURL('/api/client-log')
}

function payload(entries) {
  return JSON.stringify({ session, browser, ua: navigator.userAgent, ...context, entries })
}

function flush({ beacon = false } = {}) {
  clearTimeout(timer)
  timer = null
  if (!buffer.length) return
  const entries = buffer
  buffer = []
  try {
    const body = payload(entries)
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint(), body)
      return
    }
    fetch(endpoint(), { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
      .catch(() => {})
  } catch {
    // ignore
  }
}

function record(level, event, attrs = {}) {
  const entry = { seq: seq++, t: new Date().toISOString(), level, event, attrs: sanitize(attrs) }
  const line = `[${level}] ${event}`
  if (level === 'error') console.error(line, attrs)
  else if (level === 'warn') console.warn(line, attrs)
  else console.log(line, attrs)

  buffer.push(entry)
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
  if (level !== 'info') flush()
  else if (!timer) timer = setTimeout(flush, FLUSH_MS)
}

// Keep entries small and JSON-safe: Blobs (drawings) become their size/type,
// Errors become their message.
function sanitize(attrs) {
  const out = {}
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v instanceof Blob) out[k] = { blob: true, size: v.size, type: v.type }
    else if (v instanceof Error) out[k] = v.message
    else if (typeof v === 'string' && v.length > 500) out[k] = v.slice(0, 500) + '…'
    else out[k] = v
  }
  return out
}

export const log = {
  // Merge fields (game, gameId, username, userId) into every future batch.
  setContext(fields) {
    Object.assign(context, fields)
  },
  info: (event, attrs) => record('info', event, attrs),
  warn: (event, attrs) => record('warn', event, attrs),
  error: (event, attrs) => record('error', event, attrs),
  flush,
}

window.addEventListener('error', (e) => {
  log.error('window.error', { message: e.message, source: e.filename, line: e.lineno })
})
window.addEventListener('unhandledrejection', (e) => {
  log.error('unhandledrejection', { reason: String(e.reason?.message || e.reason) })
})
document.addEventListener('visibilitychange', () => {
  log.info('visibility', { state: document.visibilityState })
  if (document.visibilityState === 'hidden') flush({ beacon: true })
})
window.addEventListener('pagehide', () => flush({ beacon: true }))
