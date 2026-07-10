import PocketBase from 'pocketbase';

export const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL || "http://127.0.0.1:8090/")
// Disable the SDK's auto-cancellation. It cancels an in-flight request whenever
// a second one with the same resource key starts, which the app hits constantly:
// the shared client fires overlapping reads (e.g. checkGameStatus / getUsers) as
// components mount and realtime callbacks fire. When the host starts the game and
// every player navigates WaitingRoom -> TakeTurn at once, those reads abort
// ("ClientResponseError 0"), isValidGame() sees the error and bails, and the
// player is stranded on the "Error..." screen. We manage subscriptions manually,
// so global auto-cancellation only causes harm here.
pb.autoCancellation(false)

// getFirstListItem, but retried. When a player navigates into a game we KNOW the
// game exists, yet a lookup fired the instant the realtime "game started" event
// arrives can momentarily come back empty (a 200 with items=[]) — the write that
// started the game isn't visible to this read yet. Treating that single empty
// read as "no such game" is what stranded players on the "Error..." screen and
// made joins flaky. A couple of quick retries rides over the gap; a code that is
// genuinely missing still ends up throwing after the last attempt.
async function getFirstListItemRetry(collection, filter, { tries = 8, delayMs = 250 } = {}) {
  let lastErr
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await pb.collection(collection).getFirstListItem(filter)
    } catch (err) {
      lastErr = err
      if (err?.isAbort) continue // autocancelled — just try again
      if (err?.status && err.status !== 404) throw err // real error (auth, 5xx) — don't paper over it
      if (attempt < tries - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
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
async function createWithRetry(collection, data, { tries = 8, delayMs = 250 } = {}) {
  let lastErr
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await pb.collection(collection).create(data)
    } catch (err) {
      lastErr = err
      if (!isTransientRelationError(err)) throw err
      if (attempt < tries - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

export const pbService = {
  games: {
    async getGameId(gameCode) {
      return await pb.collection('games').getFirstListItem(`game_code="${gameCode}"`).then(function (resp) {
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
      return await pb.collection('stories').getFirstListItem(filter).then(function (resp) {
        console.log("getStory resp", resp)
        return resp
      }).catch(function (err) {
        return { errMsg: "getStory:" + JSON.stringify(err?.response?.message || err) }
      });
    },
    async getTurn(userId, storyId) {
      let filters = `user_id="${userId}"&&story_id="${storyId}"`
      console.log("getTurn filter", filters)
      return await pb.collection('turns').getFirstListItem(filters).then(function (resp) {
        console.log("getTurn resp", resp)
        return resp
      }).catch(function (err) {
        return { errMsg: "getTurn:" + JSON.stringify(err?.response?.message || err) }
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