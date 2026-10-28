<template>
  <AppBar />
  <v-card class="pa-4 overflow-y-auto" height="calc(100vh - 48px)" color="transparent" flat
    style="justify-items: center; display: grid;">
    <div style="justify-items: center; display: grid; align-content: start;">
      <v-card-title v-if="userStore.username" class="wrap text-h4 text-sm-h3 welcome-title">
        Welcome {{ userStore.username }}!
      </v-card-title>
      <v-card-title class="wrap" v-if="userStore.is_host">
        Set the order of players and then hit <strong>Begin</strong> once everyone has arrived!
      </v-card-title>
      <v-card-title v-else>
        Waiting for host to Start Game:
      </v-card-title>
      <!-- A paper tag, hole punched. Clicking it copies the code. -->
      <button type="button" class="code-tag my-3" :aria-label="`Copy the game code, ${shownCode}`"
        title="Copy the game code" @click="copyCode">
        <span class="code-tag-label">Game code <v-icon icon="mdi-content-copy" size="x-small" /></span>
        <span class="code-tag-value">{{ shownCode }}</span>
      </button>
    </div>
    <div class="mb-4 pa-4 waiting-box" style="min-height: 112px;">
      <draggable :list="users" :animation="200" :disabled="!userStore.is_host">
        <div v-for="[index, item] of users.entries()" :key="item.id" class="d-flex align-center ga-4 seat">
          <span class="seat-number">{{ index + 1 }}</span>
          <div class="drag-item" :class="{ grab: userStore.is_host }">
            <span v-if="userStore.is_host" class="drag-handle">⋮⋮</span>
            <AvatarIcon :user="item" />
            <span class="item-content wrap hand">{{ item.username }}</span>
            <v-btn v-if="item.id === userStore.userId" icon="mdi-pencil" size="small" variant="text"
              @click="onEditUserClick()" />
            <v-btn v-else-if="userStore.is_host" icon="mdi-trash-can-outline" size="small" variant="text"
              @click="removePlayer(item.id)" />
          </div>
        </div>
      </draggable>
    </div>
    <v-card-actions class="safe-bottom">
      <v-btn v-if="userStore.is_host" color="primary" size="x-large" variant="elevated" @click="onBeginClicked">
        Begin!
      </v-btn>
      <v-btn v-else color="error" size="x-large" variant="elevated" @click="leaveParty">
        Leave Party
      </v-btn>
    </v-card-actions>
  </v-card>

  <ConfirmRejoin ref="rejoin" />

  <!-- Persistent while joining: dismissing it would leave the player in the
       waiting room without a seat and no way to get one. -->
  <v-dialog v-model="showEditUsernameDialog" max-width="500" :persistent="!userStore.userId">
    <v-card class="pa-4 bg-white" width="500" max-width="100%">
      <v-card-title class="text-center text-h4">
        {{ userStore.userId ? "Edit your Username!" : "Join the Game!" }}
      </v-card-title>
      <v-form ref="form" @submit.prevent="onUsernameSubmit">
        <SetUsername ref="username" @username="onUsernameSubmit" />
        <v-row class="pa-2" style="justify-content: center;">
          <v-btn size="x-large" color="primary" elevation="2" @click="onUsernameSubmit">
            Submit
          </v-btn>
        </v-row>
      </v-form>
    </v-card>
  </v-dialog>
</template>

<script>
import { VueDraggableNext } from 'vue-draggable-next'
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pb, pbService } from '@/services/pocketbase'
import { log } from '@/services/log'
import { copyText } from '@/services/clipboard'
import { oneAtATime } from '@/services/oneAtATime'
export default {
  data() {
    return {
      gameId: "",
      // The roster, in the host's seating order (see refreshRoster)
      users: [],
      showEditUsernameDialog: false,
    }
  },
  components: {
    draggable: VueDraggableNext,
  },
  computed: {
    ...mapStores(useUserStore),
    gameCode() {
      return this.$route.params.gameCode
    },
    // The code as the tag shows it, in capitals.
    shownCode() {
      return String(this.gameCode).toUpperCase()
    },
  },
  async created() {
    const { data: game, errMsg } = await pbService.games.checkGameStatus(this.gameCode)
    if (errMsg) {
      this.$emit("snack", errMsg, "error")
      this.$router.push({ name: "Home" });
      return
    }
    if (game.isStarted) {
      this.toGame()
      return
    }
    this.gameId = game.gameId
    log.setContext({ game: this.gameCode, gameId: this.gameId })

    // Listening first, so nothing lands unheard while the page reads. The host
    // starting the game moves everyone to it.
    pb.collection('games').subscribe(this.gameId, (e) => {
      if (e.record.isStarted) this.toGame()
    })
    pb.collection('users').subscribe('*', (e) => this.onRosterEvent(e),
      { filter: pb.filter("game_id = {:gameId}", { gameId: this.gameId }) })
    // Realtime doesn't replay what it missed while the connection was down (a
    // phone asleep in the lobby): catch up each time it's back.
    pb.realtime.subscribe('PB_CONNECT', () => this.catchUp())

    await this.resolveUser()
    await this.refreshRoster()
  },
  unmounted() {
    pb.collection('users').unsubscribe();
    pb.collection('games').unsubscribe();
    pb.realtime.unsubscribe('PB_CONNECT');
  },
  methods: {
    // Work out who this tab is in *this* game. The stored user outlives a game
    // (sessionStorage), so following a new game's link from the last game's
    // review page arrives with a user that belongs to the old game. Only a user
    // from this game is kept; anyone else gets the join dialog, pre-filled with
    // their last name and avatar.
    async resolveUser() {
      const stored = this.userStore.user
      if (stored?.id && stored.game_id === this.gameId) {
        // Re-read it: the host may have removed us, or we renamed in another
        // tab. Only a 404 means we're gone; a failed read (network blip, busy
        // server) keeps the stored user rather than signing them out.
        const fresh = await pbService.users.getUserById(stored.id)
        if (!fresh.notFound) {
          if (fresh.data) this.userStore.user = fresh.data
          else log.warn("waitingRoom.user.refreshFailed", { err: fresh.errMsg })
          log.setContext({ username: this.userStore.username, userId: this.userStore.userId })
          log.info("waitingRoom.user", { outcome: "member" })
          return
        }
      }

      log.info("waitingRoom.user", {
        outcome: stored?.id ? "otherGame" : "none",
        storedGameId: stored?.game_id,
        storedUsername: stored?.username,
      })
      this.userStore.user = null
      this.showEditUsernameDialog = true
      if (stored?.username) {
        this.$nextTick(() => {
          this.$refs.username?.set(stored.username, stored.avatar)
        })
      }
    },
    toGame() {
      this.$router.push({ name: "TakeTurn", params: { gameCode: this.gameCode } });
    },
    // After a reconnect: on to the game if it started meanwhile, else the
    // roster as it is now.
    async catchUp() {
      const { data: game } = await pbService.games.checkGameStatus(this.gameCode)
      if (game?.isStarted) this.toGame()
      else this.refreshRoster()
    },
    // Someone joined, left, or changed their name or look. If it's this player
    // gone (the host removed them), they're a visitor again: the join dialog.
    onRosterEvent(e) {
      if (e.action === "delete" && e.record.id === this.userStore.userId) {
        this.userStore.user = null
        this.showEditUsernameDialog = true
      }
      this.refreshRoster()
    },
    // Reads the roster. The host's seating stays as they dragged it, which is
    // the order /begin seats: whoever was listed keeps their place, and
    // newcomers go at the end, in the order they joined.
    async refreshRoster() {
      const { data: players, errMsg } = await pbService.users.getUsers(this.gameCode)
      if (errMsg) {
        this.$emit("snack", errMsg, "error")
        return
      }
      if (!players) return // cancelled by a newer refresh, which has it
      const seated = this.users.map((u) => players.find((p) => p.id === u.id)).filter(Boolean)
      this.users = [...seated, ...players.filter((p) => !seated.includes(p))]
    },
    async copyCode() {
      const code = this.shownCode
      if (await copyText(code)) this.$emit("snack", `Copied the game code ${code}`, "success")
      else this.$emit("snack", `Couldn't copy it. The game code is ${code}`, "warning")
    },
    onEditUserClick() {
      this.showEditUsernameDialog = true
      this.$nextTick(() => {
        this.$refs.username.set(this.userStore.username, this.userStore.avatar)
      })
    },
    // True once the player is out of the game.
    async removePlayer(id) {
      if (!confirm("Are you sure you want to remove this user?")) return false
      const { errMsg } = await pbService.users.deleteUser(id)
      if (errMsg) {
        this.$emit("snack", errMsg, "error")
        return false
      }
      return true
    },
    async onBeginClicked() {
      // Assign positions and start the game in one server-side transaction over
      // the authoritative roster. We send the current display order (the host's
      // drag order) as a preference; the server seats those players first and
      // appends anyone our local snapshot missed, so a late joiner can no longer
      // corrupt the 0..N-1 ordering.
      const { errMsg } = await pbService.games.beginGame(this.gameId, this.users.map(u => u.id))
      if (errMsg) {
        this.$emit("snack", errMsg, "error")
        return
      }
      this.toGame()
    },
    async leaveParty() {
      if (await this.removePlayer(this.userStore.userId)) {
        this.userStore.user = null
        this.$router.push({ name: "Home" })
      }
    },
    onUsernameSubmit: oneAtATime(async function () {
      let validation = await this.$refs.form.validate()
      if (!validation.valid) {
        return
      }
      validation = await this.$refs.username.validate()
      if (!validation.valid) {
        return
      }

      if (this.userStore.username) {
        await this.updateUser(validation.username, validation.avatar, validation.color)
      } else {
        await this.createUser(validation.username, validation.avatar, validation.color)
      }
    }),
    async createUser(username, avatar, color) {
      // A failed read isn't a free name: joining on it would seat them twice.
      const found = await pbService.users.getUser(username, this.gameId)
      if (found.errMsg) {
        this.$emit("snack", found.errMsg, "error")
        return
      }
      const user = found.data
      if (user) {
        // Name taken: rejoin only if they confirm it's them; otherwise keep the
        // join dialog open to pick another name.
        if (!(await this.$refs.rejoin.ask(user))) {
          return
        }
        this.userStore.user = user
        this.showEditUsernameDialog = false
        this.$emit("snack", `Welcome back, ${user.username}!`, "success")
        log.info("waitingRoom.join", { outcome: "reattached", userId: user.id })
      } else {
        let resp = await this.userStore.newUser(username, avatar, color, this.gameId, false)
        if (resp.errMsg) {
          log.warn("waitingRoom.join", { outcome: "failed", err: resp.errMsg })
          this.$emit("snack", resp.errMsg, "error")
        } else {
          this.showEditUsernameDialog = false
          log.info("waitingRoom.join", { outcome: "created", userId: resp.data.id })
        }
      }
      log.setContext({ username: this.userStore.username, userId: this.userStore.userId })
    },
    async updateUser(username, avatar, color) {
      const found = await pbService.users.getUser(username, this.gameId)
      if (found.errMsg) {
        this.$emit("snack", found.errMsg, "error")
        return
      }
      if (found.data && found.data.id != this.userStore.userId) {
        this.$emit("snack", "Username already exists. Please enter a new one (or ignore if it's you).", "warning")
        return
      }
      // The rest of a player is the server's (see the users update guard)
      const resp = await pbService.users.updateUser(this.userStore.userId, { username, color, avatar })
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
        return
      }
      this.userStore.user = resp.data
      this.showEditUsernameDialog = false
    },
  },
};
</script>
<style scoped>
.seat {
  margin: 12px 0;
}

/* The seat numbers go round the paper colors */
.seat-number {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  font-size: 1.1rem;
  font-weight: 800;
  color: #fff;
  background: rgb(var(--v-theme-tertiary));
  border: 2.5px solid var(--ink);
  border-radius: 50%;
}

.seat:nth-child(5n + 2) .seat-number {
  background: rgb(var(--v-theme-primary));
}

.seat:nth-child(5n + 3) .seat-number {
  background: rgb(var(--v-theme-grass));
}

.seat:nth-child(5n + 4) .seat-number {
  background: rgb(var(--v-theme-plum));
}

.seat:nth-child(5n + 5) .seat-number {
  color: var(--ink);
  background: rgb(var(--v-theme-secondary));
}

/* A hand-drawn card, each one a little askew */
.drag-item {
  --tilt: -0.6deg;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 6px 6px 6px 10px;
  background: rgb(var(--v-theme-surface));
  border: 2px solid var(--ink);
  border-radius: var(--wobble-small);
  box-shadow: 3px 3px 0 var(--ink);
  transform: rotate(var(--tilt));
  /* Prevent text selection during drag */
  user-select: none;
  -webkit-user-select: none;

  /* Better touch targets */
  min-height: 52px;

  /* Smooth feedback */
  transition: transform 0.2s ease;
}

.seat:nth-child(even) .drag-item {
  --tilt: 0.5deg;
  border-radius: 8px 14px 6px 16px / 16px 6px 14px 8px;
}

.drag-item:active {
  transform: rotate(var(--tilt)) scale(1.02);
}

.grab {
  cursor: grab;
}

.grab:active {
  cursor: grabbing;
}

.drag-handle {
  margin-right: 10px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  user-select: none;
}

.drag-item .item-content {
  flex: 1;
  font-size: 1.5rem;
  line-height: 1.1;
  text-align: left;
}

/* A long name wraps tight, not at the title's usual line height */
.welcome-title {
  line-height: 1.1;
  padding-block: 12px;
}

.waiting-box {
  width: min(480px, 100%);
  max-height: calc(100vh - 320px);
  overflow-y: auto;
}

/* The game code on a paper tag, hole punched, that presses in when clicked */
.code-tag {
  position: relative;
  display: block;
  padding: 10px 24px 10px 42px;
  color: var(--ink);
  font: inherit;
  text-align: left;
  background: rgb(var(--v-theme-secondary));
  border: 0;
  border-radius: 14px 30px 30px 14px;
  box-shadow: 0 4px 0 rgb(var(--v-theme-secondary-darken-1));
  transform: rotate(-2deg);
  cursor: pointer;
}

.code-tag:active {
  box-shadow: 0 1px 0 rgb(var(--v-theme-secondary-darken-1));
  transform: rotate(-2deg) translateY(3px);
}

.code-tag:focus-visible {
  outline: 2.5px solid var(--ink);
  outline-offset: 3px;
}

.code-tag::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 14px;
  width: 14px;
  height: 14px;
  margin-top: -7px;
  background: rgb(var(--v-theme-background));
  border-radius: 50%;
  box-shadow: inset 0 2px 0 rgba(43, 33, 24, 0.2);
}

.code-tag-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.code-tag-value {
  display: block;
  font-size: 2.25rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
</style>
