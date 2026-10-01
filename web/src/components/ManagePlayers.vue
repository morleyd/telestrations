<!-- ManagePlayers gives the host mid-game control over the roster: skip a
     player's pending turns (someone stepped away), or drop them for the rest of
     the game. Lives in the AppBar, so it's reachable from the turn screens and
     the review page. The server does the work; see host.go. -->
<template>
  <template v-if="canManage">
    <v-btn icon="mdi-account-cog" aria-label="Manage players" title="Manage players" @click="open" />
    <v-dialog v-model="visible" max-width="520">
      <v-card class="pa-4 bg-white" max-width="100%">
        <v-card-title class="text-center text-h5">Manage players</v-card-title>
        <v-card-subtitle class="text-center wrap">
          Skip someone who's holding things up, or drop them from the rest of the game.
        </v-card-subtitle>
        <v-alert v-if="error" class="ma-2" type="error" density="compact" :text="error" />
        <v-list>
          <v-list-item v-for="p in players" :key="p.id" :data-player="p.username">
            <template #prepend>
              <AvatarIcon :user="p" />
            </template>
            <v-list-item-title>
              {{ p.username }}<span v-if="p.is_host"> (host)</span>
            </v-list-item-title>
            <v-list-item-subtitle>{{ statusText(p) }}</v-list-item-subtitle>
            <template #append>
              <v-btn v-if="!p.dropped" size="small" variant="tonal" :disabled="!p.owes || busy"
                @click="act(p, 'skip')">
                Skip
              </v-btn>
              <v-btn v-if="!p.dropped && !p.is_host" class="ms-2" size="small" color="error" variant="text"
                :disabled="busy" @click="act(p, 'drop')">
                Drop
              </v-btn>
            </template>
          </v-list-item>
        </v-list>
        <v-card-actions class="justify-center">
          <v-btn @click="visible = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>
</template>
<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pbService } from '@/services/pocketbase'
import { log } from '@/services/log'

const REFRESH_MS = 3000

export default {
  name: "ManagePlayers",
  data() {
    return {
      gameId: "",
      visible: false,
      players: [],
      busy: false,
      error: "",
      timer: null,
    }
  },
  computed: {
    ...mapStores(useUserStore),
    // Only the host of *this* game, once it's under way. The stored user can be
    // from an earlier game, so compare against the game in the URL.
    canManage() {
      return Boolean(this.gameId && this.userStore.is_host && this.userStore.gameId === this.gameId)
    },
  },
  async mounted() {
    const code = this.$route.params.gameCode
    if (!code || !['TakeTurn', 'Review'].includes(this.$route.name)) return
    const game = await pbService.games.checkGameStatus(code)
    if (game.isStarted) this.gameId = game.gameId
  },
  unmounted() {
    clearInterval(this.timer)
  },
  watch: {
    visible(open) {
      clearInterval(this.timer)
      if (open) this.timer = setInterval(() => this.refresh(), REFRESH_MS)
    },
  },
  methods: {
    async open() {
      this.error = ""
      this.visible = true
      await this.refresh()
    },
    async refresh() {
      const resp = await pbService.games.getPlayers(this.gameId)
      if (resp.errMsg) {
        this.error = resp.errMsg
        return
      }
      this.players = resp.data
    },
    statusText(p) {
      if (p.dropped) return "Dropped"
      if (p.finished) return "Done"
      if (p.owes) return `Up now: ${p.owes} ${p.owes == 1 ? "story is" : "stories are"} waiting on them`
      if (!p.has_story) return "Hasn't opened the game yet"
      return "Waiting on others"
    },
    async act(p, action) {
      const question = action == "drop"
        ? `Drop ${p.username} from the rest of the game? Every turn that reaches them will be skipped. This can't be undone.`
        : `Skip ${p.username}'s turn? The ${p.owes == 1 ? "story" : `${p.owes} stories`} waiting on them will move on without them.`
      if (!confirm(question)) return

      this.busy = true
      this.error = ""
      log.info("host.action", { action, target: p.username, targetId: p.id, owes: p.owes })
      const resp = await pbService.games.hostAction(this.gameId, p.id, action, this.userStore.userId)
      this.busy = false
      if (resp.errMsg) {
        log.warn("host.action.failed", { action, target: p.username, err: resp.errMsg })
        this.error = resp.errMsg
      }
      await this.refresh()
    },
  },
}
</script>
<style scoped>
.wrap {
  white-space: break-spaces;
  word-break: break-word;
}
</style>
