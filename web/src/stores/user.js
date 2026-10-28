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
    // rounds: how many times each story goes round the group; endless: until
    // the host ends the game. The server picks the game's code.
    async newGame(username, avatar, color, time, { rounds = 1, endless = false } = {}) {
      const game = await pbService.games.createGame({ roundDuration: time, rounds, endless })
      if (game.errMsg) {
        return game
      }
      const resp = await this.newUser(username, avatar, color, game.data.id, true)
      return { ...resp, gameCode: game.data.game_code }
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
