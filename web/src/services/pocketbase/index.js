import PocketBase from 'pocketbase';

export const pb = new PocketBase("http://127.0.0.1:8090/")
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
    async checkGameStatus(gameCode) {
      return await pb.collection('games').getFirstListItem(`game_code="${gameCode}"`).then(function (resp) {
        console.log("checkGameStatus resp", resp)
        return {
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
      return await pb.collection('stories').create(data).then(function (resp) {
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
      return await pb.collection('turns').create(data).then(function (resp) {
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