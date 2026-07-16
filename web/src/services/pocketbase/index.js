import PocketBase from 'pocketbase';

export const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL || "http://127.0.0.1:8090/")
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
function getFirstListItemRetry(collection, filter) {
  return retry(
    () => pb.collection(collection).getFirstListItem(filter, { requestKey: null }),
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

export const pbService = {
  games: {
    async getGameId(gameCode) {
      return await getFirstListItemRetry('games', `game_code="${gameCode}"`).then(function (resp) {
        console.log("getGameId resp", resp)
        if (resp.hasOwnProperty("id")) {
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
      return await pb.collection('games').create(data).then(function (resp) {
        console.log("createGame resp", resp)
        if (resp.hasOwnProperty("id")) {
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
        if (resp.hasOwnProperty("id")) {
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
    async checkGameStatus(gameCode) {
      return await getFirstListItemRetry('games', `game_code="${gameCode}"`).then(function (resp) {
        console.log("checkGameStatus resp", resp)
        return {
          duration: resp.roundDuration,
          gameId: resp.id,
          isStarted: resp.isStarted,
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
      return await pb.collection('users').create(data).then(function (resp) {
        console.log("createUser resp", resp)
        if (resp.hasOwnProperty("id")) {
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
        if (resp.hasOwnProperty("id")) {
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
        if (resp.hasOwnProperty("id")) {
          return { exists: true, data: resp }
        } else {
          throw new Error("Failed to find user ID.")
        }
      }).catch(function (err) {
        console.log("isUserInGame err", err)
        return { exists: false }
      })
    },
    async getUser(username, gameId) {
      let query = `game_id="${gameId}"&&username="${username}"`
      return await pb.collection('users').getFirstListItem(query).then(function (resp) {
        console.log("getUser resp", resp)
        if (resp.hasOwnProperty("id")) {
          return resp
        } else {
          throw new Error(`Failed to find user "${username} for game "${gameId}"`)
        }
      }).catch(function (err) {
        return { errMsg: "getUser:" + JSON.stringify(err?.response?.message || err) }
      })
    },
    async getUsername(userId) {
      let query = `id="${userId}"`
      return await pb.collection('users').getFirstListItem(query).then(function (resp) {
        console.log("getUser resp", resp)
        if (resp.hasOwnProperty("id")) {
          return { data: resp.username }
        } else {
          throw new Error(`Failed to find user "${username} for game "${gameId}"`)
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
    async getTotalUsers(gameId) {
      return await pb.collection('users').getList(1, 1, {
        filter: `game_id="${gameId}"`
      }).then(function (resp) {
        console.log("getTotalUsers resp", resp)
        return { data: resp.totalItems }
      }).catch(function (err) {
        return { data: 0, errMsg: "getTotalUsers:" + JSON.stringify(err?.response?.message || err) }
      });;
    },
  },
  progress: {
    async getFullProgress(gameCode) {
      let data = {
        filter: `game_id.game_code="${gameCode}"`,
      }
      console.log("getFullProgress request", data)
      return await pb.collection('progress').getFullList(data).then(function (resp) {
        console.log("getFullProgress resp", resp)
        return { data: resp }
      }).catch(function (err) {
        return { errMsg: "getFullProgress:" + JSON.stringify(err?.response?.message || err) }
      });
    },
    async getNextPerUser(userId) {
      let data = {
        filter: `next_user_id="${userId}"`,
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
        return { errMsg: "createStory:" + JSON.stringify(err?.response?.message || err) }
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
        return { errMsg: "createTurn:" + JSON.stringify(err?.response?.message || err) }
      });
    },
    async getUserTurnCount(userId) {
      return await pb.collection('turns').getList(1, 1, {
        filter: `user_id="${userId}"`,
      }).then(function (resp) {
        console.log("checkNumTurns resp", resp)
        return { data: resp.totalItems }
      }).catch(function (err) {
        return { data: 0, errMsg: "checkNumTurns:" + JSON.stringify(err?.response?.message || err) }
      });
    },
    async getUserStoryWithTurns(userId) {
      let data = {
        sort: "turn_number",
        filter: `starter_id="${userId}"`,
      }
      console.log("getUserStoryWithTurns request", data)
      return await pb.collection('results').getFullList(data).then(async function (resp) {
        console.log("getUserStoryWithTurns resp", resp)
        if (resp.length) {
          for (let record of resp) {
            if (record.drawing) {
              const turn = await pb.collection('turns').getOne(record.turn_id);
              let drawing_url = await pb.files.getUrl(turn, record.drawing)
              record.drawing = drawing_url
            }
            // console.log(record)
          }
          return { data: resp }
        } else {
          throw new Error("Failed to get user Story With Turns.")
        }
      }).catch(function (err) {
        return { data: 0, errMsg: "getUserStoryWithTurns:" + JSON.stringify(err?.response?.message || err) }
      });
    },
  },
}