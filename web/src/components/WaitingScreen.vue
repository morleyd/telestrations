<template>
  <!-- Scrolls itself (the page doesn't), for a long table of many players -->
  <div class="waiting-screen">
    <div ref="room" class="waiting-room">
      <div class="waiting-head">
        <h1 class="waiting-title hand">Waiting for a notebook to come your way</h1>
        <div class="waiting-view" role="group" aria-label="Show the game as">
          <v-btn v-for="v in VIEWS" :key="v.value" size="small" :prepend-icon="v.icon"
            :variant="view === v.value ? 'flat' : 'outlined'" :color="view === v.value ? 'secondary' : undefined"
            :aria-pressed="String(view === v.value)" @click="view = v.value">
            {{ v.label }}
          </v-btn>
        </div>
      </div>
      <WaitingList v-if="view === 'list'" :progress="rows" :user-map="userMap" :me-id="userStore.userId" />
      <WaitingTable v-else-if="layout" :seats="seats" :layout="layout" />
    </div>
  </div>
</template>
<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pbService } from '@/services/pocketbase'
import { seatPlayers, roundTable, sidesTable, longTable } from '@/services/table'

// Above the table: the app bar and the title
const ABOVE = 48 + 96

// The two ways to see the game: round a table, or the list of stories it
// replaced. Each player's pick is remembered on their device.
const VIEWS = [
  { value: "table", label: "Table", icon: "mdi-table-furniture" },
  { value: "list", label: "List", icon: "mdi-format-list-bulleted" },
]
const VIEW_KEY = "waitingView"

function savedView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "table"
  } catch {
    return "table"
  }
}

// Who's doing what. TakeTurn calls getProgress whenever it finds the player
// still waiting.
export default {
  name: "WaitingScreen",
  props: {
    gameId: { type: String, required: true },
  },
  setup() {
    return { VIEWS }
  },
  data() {
    return {
      view: savedView(),
      // The progress view's rows and the players, as last read
      rows: [],
      players: [],
      seats: [],
      width: 0,
    }
  },
  computed: {
    ...mapStores(useUserStore),
    userMap() {
      return Object.fromEntries(this.players.map((p) => [p.id, p]))
    },
    // On a wide screen the round table, or for more players than fit round
    // it, the one with players down both sides. On a phone, the long one.
    layout() {
      const count = this.seats.length
      if (!count || !this.width) return null
      const display = this.$vuetify.display
      if (!display.mdAndUp) return longTable({ width: this.width, count })
      const meIndex = Math.max(0, this.seats.findIndex((s) => s.isMe))
      return roundTable({ width: this.width, height: display.height - ABOVE, count, meIndex }) ??
        sidesTable({ width: this.width, count, meIndex })
    },
  },
  watch: {
    view(view) {
      try {
        localStorage.setItem(VIEW_KEY, view)
      } catch {
        // Not remembered, then: this time only
      }
    },
  },
  created() {
    // Not reactive. The notebook each player was on last time, which stays on
    // top of their pile (see seatPlayers); and the refreshes started, and the
    // latest of them shown.
    this.onTop = new Map()
    this.started = 0
    this.shown = 0
  },
  mounted() {
    this.resized = new ResizeObserver(([entry]) => {
      this.width = Math.floor(entry.contentRect.width)
    })
    this.resized.observe(this.$refs.room)
    this.getProgress()
  },
  unmounted() {
    this.resized.disconnect()
  },
  methods: {
    // The players come with their names, so a refresh that lands has both. One
    // that lands after a newer one is dropped: the notebooks would slide back.
    async getProgress() {
      const mine = ++this.started
      const [rows, players] = await Promise.all([
        pbService.progress.getFullProgress(this.$route.params.gameCode),
        pbService.games.getPlayers(this.gameId),
      ])
      // Cancelled by a newer refresh, or a newer one has already landed
      if (rows.aborted || mine < this.shown) return
      const errMsg = rows.errMsg || players.errMsg
      if (errMsg) {
        this.$emit("snack", errMsg, "error")
        return // keep what we had; the next refresh retries
      }
      this.shown = mine
      this.rows = rows.data
      this.players = players.data
      this.seats = seatPlayers(players.data, rows.data, this.userStore.userId, this.onTop)
      this.onTop = new Map(this.seats.filter((s) => s.papers.length).map((s) => [s.player.id, s.papers[0].id]))
    },
  },
};
</script>
<style scoped>
.waiting-screen {
  width: 100vw;
  height: calc(100vh - 48px);
  height: calc(100dvh - 48px);
  overflow-y: auto;
}

.waiting-room {
  max-width: 1180px;
  margin: 0 auto;
  padding: 8px 16px 24px;
}

/* The title in the middle, the switch at the right */
.waiting-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px 12px;
  margin: 8px 0 16px;
}

.waiting-title {
  grid-column: 2;
  margin: 0;
  text-align: center;
  font-size: 2rem;
  line-height: 1.15;
}

.waiting-view {
  grid-column: 3;
  justify-self: end;
  display: flex;
  gap: 8px;
}

/* No room beside the title: the switch goes above it, still at the right */
@media (max-width: 899px) {
  .waiting-head {
    grid-template-columns: minmax(0, 1fr);
  }

  .waiting-title {
    grid-column: 1;
  }

  .waiting-view {
    grid-column: 1;
    grid-row: 1;
  }
}
</style>
