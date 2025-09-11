// Utilities
import { defineStore } from 'pinia'
import { pbService } from '@/services/pocketbase'

export const useUserStore = defineStore('user', {
  persist: {
    storage: sessionStorage,
  },
  state: () => ({
    user: null,
  }),
  getters: {
    username() {
      return this.user?.username
    },
    userId() {
      return this.user?.id
    },
    gameId() {
      return this.user?.game_id
    },
    is_host() {
      return this.user?.is_host
    },
    position() {
      return this.user?.position
    },
  },
  actions: {
    generateGameCode() {
      let randInt = function (max) {
        return Math.floor(Math.random() * max);
      }
      // TODO: this is probs not the right way to do it :/
      let abc = 'abcdefghijklmnopqrstuvwxyz'
      let code = ""
      for (let i = 0; i < 5; i++) {
        code += abc.charAt(randInt(26))
      }
      console.log(code)
      return code;
    },
    async newGame(username, color, time) {
      let gameCode = this.generateGameCode()
      let resp = await pbService.games.createGame({
        "game_code": gameCode,
        "roundDuration": time,
      })
      if (resp.errMsg) {
        return resp
      }

      resp = await this.newUser(username, color, resp.data.id, true)
      resp["gameCode"] = gameCode
      return resp
    },
    async newUser(username, color, gameId, isHost) {
      let userResp = await pbService.users.createUser({
        "username": username,
        "color": color,
        "game_id": gameId,
        "is_host": isHost,
      })
      if (userResp.errMsg) {
        return userResp
      }

      this.user = userResp.data
      return userResp
    },
    // update(username, gameCode, isHost=false) {
    //   console.log("updata", username, gameCode, isHost)
    //   this.username = username || this.username
    //   this.gameCode = gameCode || this.gameCode
    //   this.isHost = isHost
    // },
  },
})
