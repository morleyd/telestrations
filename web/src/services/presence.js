// How long a player's device can be quiet before the waiting screen shows them
// as away, and how often TakeTurn says it's still here.
import { AWAY_SECONDS } from '@/services/table'

const KEY = "awaySeconds"

// AWAY_SECONDS, unless this device's localStorage.awaySeconds says otherwise
// (the browser tests shorten it, so they needn't wait a minute).
export function awaySeconds() {
  try {
    const n = Number(localStorage.getItem(KEY))
    return n > 0 ? n : AWAY_SECONDS
  } catch {
    return AWAY_SECONDS
  }
}

// How often a device says it's here: every 20s, or a third of the time to go
// away if that's shorter, so a beat or two can go missing without it.
export function heartbeatSeconds() {
  return Math.min(20, awaySeconds() / 3)
}
