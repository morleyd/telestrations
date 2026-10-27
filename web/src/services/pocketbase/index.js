import PocketBase from 'pocketbase';
import { sameName } from '@/services/player';
import { fetchWhole } from './fetchWhole';

export const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL || "http://127.0.0.1:8090/")
// So a cancelled request always rejects as cancelled, never as an empty answer
// (see fetchWhole).
pb.beforeSend = (url, options) => ({ url, options: { ...options, fetch: fetchWhole } })
// A note on the SDK's auto-cancellation: it aborts an in-flight request whenever
// a second one with the same key starts. That is right for the recurring
// refreshes (getUsers and getFullProgress below): the latest response wins, and
// a stale one can never land out of order and stick. It is wrong for everything
// else, a one-shot lookup or a write: when the host starts the game, every
// player's WaitingRoom -> TakeTurn transition looks the game up at once, and
// the aborts stranded players on the "Error..." screen. So those opt out with
// `requestKey: null`.

// One retry loop for the helpers below, so the policy can't drift between them.
// isRetryable decides which failures are worth re-issuing; everything else
// propagates immediately. Gives up (throws the last error) after `tries`.
async function retry(fn, isRetryable, { tries = 3, delayMs = 150 } = {}) {
  let lastErr
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isRetryable(err)) throw err
      if (attempt < tries - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

// getFirstListItem, but retried a few times on an empty (404) result. The root
// cause of the empty reads — a stale snapshot served by one of PocketBase's
// pooled read connections just after a write — is fixed on the backend (data.db
// is now capped at a single read connection; see main.go). This is kept as cheap
// defense in depth: a transient blip can still make one lookup for a record we
// know exists come back empty, and a couple of quick retries ride over it. A
// genuinely missing code still throws after the last attempt (~0.5s later).
function getFirstListItemRetry(collection, filter, options = {}) {
  return retry(
    () => pb.collection(collection).getFirstListItem(filter, { ...options, requestKey: null }),
    (err) => !err?.status || err.status === 404,
  )
}

// True when a create failed only because a related record it points at (game,
// story, user) wasn't visible to the validation read yet — the write-side twin
// of the empty-read race above. The record definitely exists (we just created or
// navigated into it), so this is safe to retry; a genuinely bad relation id keeps
// failing the same way and surfaces after the last attempt.
function isTransientRelationError(err) {
  const data = err?.response?.data
  if (err?.status !== 400 || !data) return false
  return Object.values(data).some((f) => f?.code === 'validation_missing_rel_records')
}

// create(), retried past the transient relation race. A 400 means nothing was
// written, so re-issuing can't duplicate; other errors propagate immediately.
function createWithRetry(collection, data) {
  return retry(
    () => pb.collection(collection).create(data, { requestKey: null }),
    isTransientRelationError,
  )
}

// POST to one of the game's own routes (routes.go, host.go)
function post(path, body) {
  return pb.send(path, { method: "POST", body, requestKey: null })
}

// The address of a turn's drawing. It needs only the turn's id, so it's built
// here rather than read.
export function drawingURL(turnId, filename) {
  return pb.files.getURL({ collectionName: "turns", id: turnId }, filename)
}

// A PocketBase date as a Date, or null. PocketBase writes them as
// "2026-10-01 12:00:00.000Z"; Safari only parses them with a "T" in place of
// the space.
function parseDate(s) {
  const t = s ? Date.parse(s.replace(" ", "T")) : NaN
  return Number.isNaN(t) ? null : new Date(t)
}

// When the host's End Game runs out (a Date), or null while the game is on.
export function endsAt(game) {
  return parseDate(game?.ends_at)
}

// How many seconds End Game gave players to finish their turns, or null while
// the game is on. The server's /end sets ends_at and updated in one save, and
// nothing else saves a game while anyone is still on a turn (Play again waits
// for everyone to finish), so the gap between them is its countdown, by the
// server's clock.
export function endCountdown(game) {
  const at = endsAt(game)
  const from = parseDate(game?.updated)
  return at && from ? Math.max(0, Math.round((at - from) / 1000)) : null
}

// Every request below answers { data } if it works. If it fails: { errMsg }
// to show the player, with errCode (a refusal's code) and notFound (a 404) to
// act on. A refresh cancelled by a newer one of its kind answers just
// { aborted }: the newer one has it covered.
async function call(request) {
  try {
    return { data: await request() }
  } catch (err) {
    if (err?.isAbort) return { aborted: true }
    return { errMsg: errorMessage(err), errCode: refusalCode(err), notFound: err?.status === 404 }
  }
}

// The stable code a refused write carries (refuse() in host.go), so callers
// branch on it rather than on the message. Anything else, a unique-index error
// included, gets no code: the server's guard is what says a turn was really
// taken ("turn_taken", checked at its place in the story). Reading an index
// error as "taken" once marked turns done that were never saved, and the
// player waited forever (a leftover one-turn-per-player index; see migration
// 1784500000). Without a code the turn stays on screen to send again.
function refusalCode(err) {
  return err?.response?.data?.code?.code || ""
}

// What the player is told. PocketBase answers a record it won't save with a
// bare "Failed to create record." and puts the reason on the field; of those,
// only a picture over turns.drawing's maxSize (migration 1784600000) is one a
// player can act on, as is the request body cap's 413.
function errorMessage(err) {
  if (err?.status === 413 || err?.response?.data?.drawing?.code === 'validation_file_size_limit') {
    return "That picture is too big. Try a smaller one."
  }
  return err?.message || String(err)
}

// A game as the pages use it, from its record
function gameStatus(game) {
  return {
    gameId: game.id,
    duration: game.roundDuration,
    rounds: game.rounds,
    endless: game.endless,
    isStarted: game.isStarted,
    endsAt: endsAt(game),
    endCountdown: endCountdown(game),
    // The game the host started after this one (Play again), if any
    nextGame: game.next_game || "",
  }
}

export const pbService = {
  games: {
    // The server picks the game's code (see the games create guard in host.go).
    createGame: (data) => call(() => pb.collection('games').create(data, { requestKey: null })),
    // Seats the players in `order` (the host's drag order; the server seats
    // anyone it leaves out after them) and starts the game.
    beginGame: (gameId, order) => call(() => post(`/api/games/${gameId}/begin`, { order })),
    // Where every player stands mid-game (see gamePlayers in host.go): turns
    // taken, stories waiting on them, dropped, and whether they're finished.
    getPlayers: (gameId) => call(async () =>
      (await pb.send(`/api/games/${gameId}/players`, { requestKey: null })).players),
    // Host-only: action is "skip" (their pending turns) or "drop" (from the game).
    hostAction: (gameId, userId, action, hostId) =>
      call(() => post(`/api/games/${gameId}/players/${userId}/${action}`, { host_id: hostId })),
    // Host-only End Game: everyone gets a few seconds to finish the turn
    // they're on, then the game is over. Answers when it ends (see endsAt).
    endGame: (gameId, hostId) => call(async () => endsAt(await post(`/api/games/${gameId}/end`, { host_id: hostId }))),
    // Host-only Play again: a new game with the same players, straight into
    // play. roundDuration is in seconds (-1 untimed). Answers { game_id, game_code }.
    rematch: (gameId, hostId, { roundDuration, rounds, endless }) => call(() =>
      post(`/api/games/${gameId}/rematch`, { host_id: hostId, round_duration: roundDuration, rounds, endless })),
    // The game with this code (see gameStatus). notFound: there's none, and
    // errMsg says so.
    async checkGameStatus(gameCode) {
      const resp = await call(async () =>
        gameStatus(await getFirstListItemRetry('games', pb.filter("game_code = {:gameCode}", { gameCode }))))
      return resp.notFound ? { ...resp, errMsg: "Invalid Game Code. Try again or create a new game." } : resp
    },
  },
  users: {
    deleteUser: (userId) => call(() => pb.collection('users').delete(userId, { requestKey: null })),
    createUser: (data) => call(() => createWithRetry('users', data)),
    updateUser: (userId, data) => call(() => pb.collection('users').update(userId, data, { requestKey: null })),
    // The game's player with this name, whatever its capitals (see sameName),
    // or null if there's none. Matched here, not in the filter: SQLite's LOWER
    // only folds A-Z, so a stored "Émile" would never match "émile".
    getUser: (username, gameId) => call(async () => {
      const players = await pb.collection('users').getFullList({
        filter: pb.filter("game_id = {:gameId}", { gameId }),
        requestKey: null,
      })
      return players.find((p) => sameName(p.username, username)) || null
    }),
    // userId's seat in the game the host started after theirs (Play again),
    // with that game expanded. notFound: they don't have one (they were dropped).
    getNextSeat: (userId) => call(() =>
      getFirstListItemRetry('users', pb.filter("from_user = {:userId}", { userId }), { expand: "game_id" })),
    // notFound: the player really is gone, not just a failed read.
    getUserById: (userId) => call(() => pb.collection('users').getOne(userId, { requestKey: null })),
    // The game's players, in the order they joined. A refresh: a newer one
    // cancels it (aborted).
    getUsers: (gameCode) => call(() => pb.collection('users').getFullList({
      filter: pb.filter("game_id.game_code = {:gameCode}", { gameCode }),
      sort: "created",
    })),
  },
  progress: {
    // Every story in the game, as the progress view has it. A refresh: a newer
    // one cancels it (aborted). Its own key, as the default one is per
    // collection, and this mustn't cancel getNextPerUser. A page that also
    // shows the waiting screen passes a key of its own, or each would cancel
    // the other's.
    getFullProgress: (gameCode, requestKey = "fullProgress") => call(() => pb.collection('progress').getFullList({
      filter: pb.filter("game_id.game_code = {:gameCode}", { gameCode }),
      requestKey,
    })),
    // The stories waiting on userId. Never cancelled: TakeTurn serializes these
    // itself, and losing one costs a whole poll cycle.
    getNextPerUser: (userId) => call(() => pb.collection('progress').getFullList({
      filter: pb.filter("next_user_id = {:userId}", { userId }),
      requestKey: null,
    })),
    createStory: (userId, gameId) => call(() => createWithRetry('stories', { starter_id: userId, game_id: gameId })),
    // notFound: there's no such story yet (safe to create one), where any other
    // failure may be a blip (creating one then would mint a duplicate).
    getStory: (userId, gameId) => call(() =>
      getFirstListItemRetry('stories', pb.filter("starter_id = {:userId} && game_id = {:gameId}", { userId, gameId }))),
    // The same contract as getStory: only notFound means "no such turn".
    getTurn: (userId, storyId) => call(() =>
      getFirstListItemRetry('turns', pb.filter("user_id = {:userId} && story_id = {:storyId}", { userId, storyId }))),
    createTurn: (data) => call(() => createWithRetry('turns', data)),
    // The round timer ran out with nothing entered: the server skips the turn.
    // turnIndex is the turn's place in the story, so the server can tell a
    // timer left over from an earlier round apart from this one.
    timeoutTurn: (storyId, userId, turnIndex) =>
      call(() => post(`/api/stories/${storyId}/timeout`, { user_id: userId, turn_index: turnIndex })),
    // A story's turns in order, each drawing as its address. No turns is a
    // story opened but not started yet. Never cancelled: opening a story while
    // Download all reads them all mustn't cancel either.
    getUserStoryWithTurns: (userId) => call(async () => {
      const turns = await pb.collection('results').getFullList({
        sort: "turn_number",
        filter: pb.filter("starter_id = {:userId}", { userId }),
        requestKey: null,
      })
      return turns.map((turn) => ({ ...turn, drawing: drawingURL(turn.turn_id, turn.drawing) }))
    }),
  },
}
