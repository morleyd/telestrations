import PocketBase from 'pocketbase';
import { sameName } from '@/services/player';
import { fetchWhole } from './fetchWhole';

export const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL || "http://127.0.0.1:8090/")
// So a cancelled request always rejects as cancelled, never as an empty answer
// (see fetchWhole).
pb.beforeSend = (url, options) => ({ url, options: { ...options, fetch: fetchWhole } })
// A note on the SDK's auto-cancellation: it aborts an in-flight request whenever
// a second one with the same resource key starts. That is exactly right for the
// recurring state refreshes (e.g. WaitingRoom's roster refetch on every realtime
// event — latest response wins, stale ones can never land out of order and stick),
// so we keep it globally ON and callers treat an aborted refresh as "superseded".
// It is exactly wrong for one-shot lookups fired during navigation (when the host
// starts the game, every player's WaitingRoom -> TakeTurn transition runs
// checkGameStatus at once and the aborts stranded players on the "Error..."
// screen), so those lookups opt out per-request with `requestKey: null` below
// instead of disabling cancellation for the whole client.

// One retry loop for every helper below, so the policy can't drift between them.
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
// `requestKey: null` opts out of auto-cancellation: these are one-shot lookups
// that legitimately overlap during navigation (see the note on the client above).
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
// Defense in depth on top of the backend fix (see main.go), plus the schema's
// unique indexes now make duplicate stories/turns impossible server-side.
// `requestKey: null`: creates must never cancel each other.
function createWithRetry(collection, data) {
  return retry(
    () => pb.collection(collection).create(data, { requestKey: null }),
    isTransientRelationError,
  )
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

export const pbService = {
  games: {
    async getGameId(gameCode) {
      return await getFirstListItemRetry('games', `game_code="${gameCode}"`).then(function (resp) {
        console.log("getGameId resp", resp)
        if (Object.prototype.hasOwnProperty.call(resp, "id")) {
          return { data: resp.id }
        } else {
          throw new Error("Failed to find game ID.")
        }
      }).catch(function (err) {
        return { errMsg: "getGameId:" + JSON.stringify(err.response.message || err) }
      })
    },
    async createGame(data) {
      console.log("createGame request", data)
      // requestKey: null for the same reason as createUser/createWithRetry: a
      // create must never auto-cancel another, which would strand a game that
      // the server actually committed. Games point at no relations, so the
      // relation-race retry isn't needed here.
      return await pb.collection('games').create(data, { requestKey: null }).then(function (resp) {
        console.log("createGame resp", resp)
        if (Object.prototype.hasOwnProperty.call(resp, "id")) {
          return { data: resp }
        } else {
          throw new Error("Failed to create game.")
        }
      }).catch(function (err) {
        return { errMsg: "createGame:" + JSON.stringify(err.response.message || err) }
      })
    },
    async updateGame(gameId, data) {
      console.log("updateGame request", data)
      return await pb.collection('games').update(gameId, data).then(function (resp) {
        console.log("updateGame resp", resp)
        if (Object.prototype.hasOwnProperty.call(resp, "id")) {
          return { data: resp }
        } else {
          throw new Error("Failed to create game.")
        }
      }).catch(function (err) {
        return { errMsg: "updateGame:" + JSON.stringify(err.response.message || err) }
      })
    },
    async beginGame(gameId, order) {
      console.log("beginGame request", { gameId, order })
      return await pb.send(`/api/games/${gameId}/begin`, {
        method: "POST",
        body: { order },
      }).then(function (resp) {
        console.log("beginGame resp", resp)
        return { data: resp }
      }).catch(function (err) {
        return { errMsg: "beginGame:" + JSON.stringify(err?.response?.message || err) }
      })
    },
    // Where every player stands mid-game (see gamePlayers in host.go): turns
    // taken, stories waiting on them, dropped, and whether they're finished.
    async getPlayers(gameId) {
      // requestKey: null: polled from more than one place; overlapping calls
      // must not cancel each other.
      return await pb.send(`/api/games/${gameId}/players`, { requestKey: null }).then(function (resp) {
        return { data: resp.players }
      }).catch(function (err) {
        return { errMsg: "getPlayers:" + JSON.stringify(err?.response?.message || err) }
      })
    },
    // Host-only: action is "skip" (their pending turns) or "drop" (from the game).
    async hostAction(gameId, userId, action, hostId) {
      return await pb.send(`/api/games/${gameId}/players/${userId}/${action}`, {
        method: "POST",
        body: { host_id: hostId },
        requestKey: null,
      }).then(function (resp) {
        return { data: resp }
      }).catch(function (err) {
        return { errMsg: JSON.stringify(err?.response?.message || err) }
      })
    },
    // Host-only End Game: everyone gets a few seconds to finish the turn
    // they're on, then the game is over. Returns when it ends (endsAt below).
    async endGame(gameId, hostId) {
      return await pb.send(`/api/games/${gameId}/end`, {
        method: "POST",
        body: { host_id: hostId },
        requestKey: null,
      }).then(function (resp) {
        return { data: endsAt(resp) }
      }).catch(function (err) {
        return { errMsg: JSON.stringify(err?.response?.message || err) }
      })
    },
    // Host-only Play again: a new game with the same players, straight into
    // play. fields: roundDuration (seconds, -1 untimed), rounds, endless.
    // Returns { game_id, game_code }.
    async rematch(gameId, hostId, { roundDuration, rounds, endless }) {
      return await pb.send(`/api/games/${gameId}/rematch`, {
        method: "POST",
        body: { host_id: hostId, round_duration: roundDuration, rounds, endless },
        requestKey: null,
      }).then(function (resp) {
        return { data: resp }
      }).catch(function (err) {
        return { errMsg: JSON.stringify(err?.response?.message || err) }
      })
    },
    async checkGameStatus(gameCode) {
      return await getFirstListItemRetry('games', `game_code="${gameCode}"`).then(function (resp) {
        console.log("checkGameStatus resp", resp)
        return {
          duration: resp.roundDuration,
          rounds: resp.rounds,
          endless: resp.endless,
          gameId: resp.id,
          isStarted: resp.isStarted,
          endsAt: endsAt(resp),
          endCountdown: endCountdown(resp),
          // The game the host started after this one (Play again), if any.
          nextGame: resp.next_game || "",
        }
      }).catch(function (err) {
        return { errMsg: JSON.stringify(err.response.message || err) }
      })

    },
  },
  users: {
    async deleteUser(userId) {
      return await pb.collection('users').delete(userId).then(function (resp) {
        console.log("deleteUser resp", resp)
        return { data: resp }
      }).catch(function (err) {
        return { errMsg: "deleteUser:" + JSON.stringify(err.response.message || err) }
      })
    },
    async createUser(data) {
      console.log("createUser request", data)
      // createWithRetry (not the raw client) so a user create can never
      // auto-cancel a concurrent one: the SDK aborts the first same-keyed POST
      // when the second starts, but the server still commits it, leaving the
      // record created while the client sees an abort and the second POST hits
      // the unique index with "Failed to create record." See the note at the top.
      return await createWithRetry('users', data).then(function (resp) {
        console.log("createUser resp", resp)
        if (Object.prototype.hasOwnProperty.call(resp, "id")) {
          return { data: resp }
        } else {
          throw new Error("Failed to create user.")
        }
      }).catch(function (err) {
        return { errMsg: "createUser:" + JSON.stringify(err.response.message || err) }
      })
    },
    async updateUser(userId, data) {
      console.log("updateUser request", data)
      return await pb.collection('users').update(userId, data).then(function (resp) {
        console.log("updateUser resp", resp)
        if (Object.prototype.hasOwnProperty.call(resp, "id")) {
          return { data: resp }
        } else {
          throw new Error("Failed to update user.")
        }
      }).catch(function (err) {
        return { errMsg: "updateUser:" + JSON.stringify(err.response.message || err) }
      })
    },
    async isUserInGame(username, gameId) {
      let query = `game_id="${gameId}"&&username="${username}"`
      return await pb.collection('users').getFirstListItem(query).then(function (resp) {
        console.log("isUserInGame resp", resp)
        if (Object.prototype.hasOwnProperty.call(resp, "id")) {
          return { exists: true, data: resp }
        } else {
          throw new Error("Failed to find user ID.")
        }
      }).catch(function (err) {
        console.log("isUserInGame err", err)
        return { exists: false }
      })
    },
    // The game's player with this name, whatever its capitals (see sameName).
    // Matched here, not in the filter: SQLite's LOWER only folds A-Z, so a
    // stored "Émile" would never match "émile".
    async getUser(username, gameId) {
      return await pb.collection('users').getFullList({
        filter: pb.filter("game_id={:gameId}", { gameId }),
        requestKey: null,
      }).then(function (players) {
        const resp = players.find((p) => sameName(p.username, username))
        console.log("getUser resp", resp)
        if (resp) {
          return resp
        } else {
          throw new Error(`Failed to find user "${username} for game "${gameId}"`)
        }
      }).catch(function (err) {
        return { errMsg: "getUser:" + JSON.stringify(err?.response?.message || err) }
      })
    },
    // userId's seat in the game the host started after theirs (Play again),
    // with that game expanded: { seat }, or { notFound } if they don't have one
    // (they were dropped), or { errMsg } if it couldn't be read.
    async getNextSeat(userId) {
      return await getFirstListItemRetry('users', `from_user="${userId}"`, { expand: "game_id" })
        .then((seat) => ({ seat }))
        .catch((err) => ({ errMsg: JSON.stringify(err?.response?.message || err), notFound: err?.status === 404 }))
    },
    async getUserById(userId) {
      return await pb.collection('users').getOne(userId, { requestKey: null }).catch(function (err) {
        // notFound: the player really is gone, not just a failed read.
        return { errMsg: "getUserById:" + JSON.stringify(err?.response?.message || err), notFound: err?.status === 404 }
      })
    },
    async getUsername(userId) {
      let query = `id="${userId}"`
      return await pb.collection('users').getFirstListItem(query).then(function (resp) {
        console.log("getUser resp", resp)
        if (Object.prototype.hasOwnProperty.call(resp, "id")) {
          return { data: resp.username }
        } else {
          throw new Error(`Failed to find user "${userId}"`)
        }
      }).catch(function (err) {
        return { errMsg: "getUsername:" + JSON.stringify(err?.response?.message || err) }
      })
    },
    async getUsers(gameCode) {
      return await pb.collection('users').getFullList({
        filter: `game_id.game_code="${gameCode}"`
      }).then(function (resp) {
        console.log("getUsers resp", resp)
        return { data: resp }
      }).catch(function (err) {
        // Auto-cancellation aborted this fetch because a newer identical one
        // started (e.g. back-to-back roster events). The newer request's
        // response supersedes this one — not an error, just skip.
        if (err?.isAbort) return { aborted: true }
        return { errMsg: "getUsers:" + JSON.stringify(err?.response?.message || err) }
      })
    },
  },
  progress: {
    async getFullProgress(gameCode) {
      // Own cancellation key: the default one is per collection, so this
      // display refresh would cancel getNextPerUser (and vice versa).
      let data = {
        filter: `game_id.game_code="${gameCode}"`,
        requestKey: "fullProgress",
      }
      console.log("getFullProgress request", data)
      return await pb.collection('progress').getFullList(data).then(function (resp) {
        console.log("getFullProgress resp", resp)
        return { data: resp }
      }).catch(function (err) {
        // Superseded by a newer refresh (latest wins), not an error.
        if (err?.isAbort) return { aborted: true }
        return { errMsg: "getFullProgress:" + JSON.stringify(err?.response?.message || err) }
      });
    },
    async getNextPerUser(userId) {
      // requestKey: null: TakeTurn serializes these itself, and losing one to a
      // concurrent progress read costs a whole poll cycle.
      let data = {
        filter: `next_user_id="${userId}"`,
        requestKey: null,
      }
      return await pb.collection('progress').getFullList(data).then(function (resp) {
        console.log("getNextPerUser resp", resp)
        return resp
      }).catch(function (err) {
        return { errMsg: "getNextPerUser:" + JSON.stringify(err?.response?.message || err) }
      });
    },
    async createStory(userId, gameId) {
      let data = {
        "starter_id": userId,
        "game_id": gameId
      }
      console.log("createStory request", data)
      return await createWithRetry('stories', data).then(function (resp) {
        console.log("createStory resp", resp)
        return resp
      }).catch(function (err) {
        return { errMsg: "createStory:" + JSON.stringify(err?.response?.message || err), errCode: refusalCode(err) }
      });
    },
    async getStory(userId, gameId) {
      let filter = `starter_id="${userId}"&&game_id="${gameId}"`
      console.log("getStory filter", filter)
      return await getFirstListItemRetry('stories', filter).then(function (resp) {
        console.log("getStory resp", resp)
        return resp
      }).catch(function (err) {
        // notFound lets callers tell "record really doesn't exist" (safe to
        // create one) apart from a transient failure (retry later — creating
        // now would mint a duplicate story).
        return { errMsg: "getStory:" + JSON.stringify(err?.response?.message || err), notFound: err?.status === 404 }
      });
    },
    async getTurn(userId, storyId) {
      let filters = `user_id="${userId}"&&story_id="${storyId}"`
      console.log("getTurn filter", filters)
      return await getFirstListItemRetry('turns', filters).then(function (resp) {
        console.log("getTurn resp", resp)
        return resp
      }).catch(function (err) {
        // Same contract as getStory: only notFound means "no such turn".
        return { errMsg: "getTurn:" + JSON.stringify(err?.response?.message || err), notFound: err?.status === 404 }
      });;
    },
    async createTurn(data) {
      // console.log("creatTurn data", data.getAll())
      return await createWithRetry('turns', data).then(function (resp) {
        console.log("createTurn resp", resp)
        return resp
      }).catch(function (err) {
        return { errMsg: "createTurn:" + JSON.stringify(err?.response?.message || err), errCode: refusalCode(err) }
      });
    },
    // The round timer ran out with nothing entered: the server skips the turn.
    // turnIndex is the turn's place in the story, so the server can tell a
    // timer left over from an earlier round apart from this one.
    async timeoutTurn(storyId, userId, turnIndex) {
      return await pb.send(`/api/stories/${storyId}/timeout`, {
        method: "POST",
        body: { user_id: userId, turn_index: turnIndex },
        requestKey: null,
      }).then(function (resp) {
        return { data: resp }
      }).catch(function (err) {
        return { errMsg: "timeoutTurn:" + JSON.stringify(err?.response?.message || err), errCode: refusalCode(err) }
      })
    },
    async getUserStoryWithTurns(userId) {
      let data = {
        sort: "turn_number",
        filter: `starter_id="${userId}"`,
      }
      console.log("getUserStoryWithTurns request", data)
      // requestKey: null: opening a story while Download all reads them all
      // mustn't cancel either. (Review drops a late answer for a story it has
      // moved on from.)
      return await pb.collection('results').getFullList({ ...data, requestKey: null }).then(async function (resp) {
        console.log("getUserStoryWithTurns resp", resp)
        // No turns is an empty story (opened, not started yet), not an error.
        for (let record of resp) {
          if (record.drawing) {
            const turn = await pb.collection('turns').getOne(record.turn_id);
            let drawing_url = await pb.files.getUrl(turn, record.drawing)
            record.drawing = drawing_url
          }
        }
        return { data: resp }
      }).catch(function (err) {
        return { data: 0, errMsg: "getUserStoryWithTurns:" + JSON.stringify(err?.response?.message || err) }
      });
    },
  },
}