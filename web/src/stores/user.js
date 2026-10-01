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
    avatar() {
      return this.user?.avatar
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

      return code;
    },
    // rounds: how many times each story goes round the group; endless: until
    // the host ends the game.
    async newGame(username, avatar, color, time, { rounds = 1, endless = false } = {}) {
      let gameCode = this.generateGameCode()
      let resp = await pbService.games.createGame({
        "game_code": gameCode,
        "roundDuration": time,
        "rounds": rounds,
        "endless": endless,
      })
      if (resp.errMsg) {
        return resp
      }

      resp = await this.newUser(username, avatar, color, resp.data.id, true)
      resp["gameCode"] = gameCode
      return resp
    },
    async newUser(username, avatar, color, gameId, isHost) {
      let userResp = await pbService.users.createUser({
        "username": username,
        "avatar": avatar,
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
  },
})
