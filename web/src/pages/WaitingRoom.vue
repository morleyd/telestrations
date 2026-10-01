<template>
  <AppBar />
  <v-card class="pa-4 overflow-y-auto" height="calc(100vh - 48px)" style="justify-items: center; display: grid;">
    <div style="justify-items: center; display: grid; align-content: start;">
      <v-card-title v-if="userStore.username" class="wrap text-h3">
        Welcome {{ userStore.username }}!
      </v-card-title>
      <v-card-title class="wrap" v-if="userStore.is_host">
        Set the order of players and then hit <strong>Begin</strong> once everyone has arrived!
      </v-card-title class="wrap">
      <v-card-title v-else>
        Waiting for host to Start Game:
      </v-card-title>
      <v-card-title>
        <span class="text-primary text-uppercase text-high-emphasis wrap">
          Game Code: {{ $route.params.gameCode }}
        </span>
      </v-card-title>
    </div>
    <div class="mb-4 pa-4 waiting-box" style="min-height: 112px;">
      <draggable :list="users" :animation="200" :disabled="!userStore.is_host">
        <div v-for="[index, item] of users.entries()" :key="item.id" class="d-flex align-center ga-4">
           <v-avatar color="primary">
            <span class="text-h5 font-weight-bold">{{ index + 1 }}</span>
          </v-avatar>
          <div class="drag-item" :class="{ grab: userStore.is_host }">
            <span v-if="userStore.is_host" class="drag-handle">⋮⋮</span>
            <AvatarIcon :user="item" />
            <span class="item-content wrap">{{ item.username }}</span>
            <v-btn v-if="item.username == userStore.username" icon="mdi-pencil" size="small" variant="text"
              @click="onEditUserClick()" />
            <v-btn v-if="userStore.is_host" icon="mdi-trash-can-outline" size="small" variant="text"
              @click="deleteItem(item.id)" />
          </div>
        </div>
      </draggable>
    </div>
    <v-card-actions :class="$vuetify.display.smAndDown ? 'safe-bottom': ''">
      <v-btn v-if="userStore.is_host" class="bg-primary" size="x-large" variant="elevated" @click="onBeginClicked">
        Begin!
      </v-btn>
      <v-btn v-else color="error" size="x-large" variant="elevated" @click="leaveParty">
        Leave Party
      </v-btn>
    </v-card-actions>
  </v-card>

  <!-- Persistent while joining: dismissing it would leave the player in the
       waiting room without a seat and no way to get one. -->
  <ConfirmRejoin ref="rejoin" />

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
export default {
  name: "TakeTurn",
  data() {
    return {
      gameId: "",
      users: [],
      username: "",
      showEditUsernameDialog: false,
    }
  },
  components: {
    draggable: VueDraggableNext,
  },
  computed: {
    ...mapStores(useUserStore),
  },
  async created() {
    // Get gameCode from path
    let gameCode = this.$route.params.gameCode

    // Check game status
    let validGame = await pbService.games.checkGameStatus(gameCode)
    if (validGame.errMsg) {
      this.$emit("snack", validGame.errMsg, "error")
      this.$router.push({ name: "Home" });
      return
    } else if (!validGame.gameId) {
      this.$emit("snack", "Invalid Game Code. Try again or create a new game.", "error")
      this.$router.push({ name: "Home" });
      return
    } else if (validGame.isStarted) {
      this.$router.push({ name: "TakeTurn", params: { gameCode: gameCode } });
      return
    }

    this.gameId = validGame.gameId
    log.setContext({ game: gameCode, gameId: this.gameId })
    await this.resolveUser()

    let resp = await pbService.users.getUsers(gameCode)
    if (resp.errMsg) {
      this.$emit("snack", resp.errMsg, "error")
      return;
    }
    // resp.aborted means a newer roster fetch (a subscription event that fired
    // during mount) superseded this one — its handler will set the roster.
    if (resp.data) {
      this.users = resp.data
    }

    let that = this
    // Subscribe to users
    resp = pb.collection('users').subscribe('*', async function (e) {
      console.log("users subscription event", e)
      let resp = await pbService.users.getUsers(gameCode)
      if (resp.data) {
        that.users = resp.data
      }
      if (resp.errMsg) {
        console.error("users subscription err", resp.errMsg)
      }
    }, { filter: `game_id.game_code="${gameCode}"` })

    // Subscribe to the game to know when to redirect
    resp = pb.collection('games').subscribe(this.gameId, async function (e) {
      console.log("games subscription event", e)
      pb.collection('users').unsubscribe();
      that.$router.push({ name: "TakeTurn", params: { gameCode: gameCode } });
    })
  },
  unmounted() {
    pb.collection('users').unsubscribe();
    pb.collection('games').unsubscribe();
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
        if (fresh.id || !fresh.notFound) {
          if (fresh.id) this.userStore.user = fresh
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
    onEditUserClick() {
      this.showEditUsernameDialog = true
      this.$nextTick(() => {
        this.$refs.username.set(this.userStore.username, this.userStore.avatar)
      })
    },
    async deleteItem(id) {
      if (confirm("Are you sure you want to remove this user?")) {
        let resp = await pbService.users.deleteUser(id)
        if (resp.errMsg) {
          this.$emit("snack", resp.errMsg, "error")
        }
      }
    },
    async onBeginClicked() {
      // Assign positions and start the game in one server-side transaction over
      // the authoritative roster. We send the current display order (the host's
      // drag order) as a preference; the server seats those players first and
      // appends anyone our local snapshot missed, so a late joiner can no longer
      // corrupt the 0..N-1 ordering.
      let resp = await pbService.games.beginGame(this.gameId, this.users.map(u => u.id))
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
        return
      }
    },
    leaveParty() {
      this.deleteItem(this.userStore.userId)
    },
    async onUsernameSubmit() {
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
    },
    async createUser(username, avatar, color) {
      let user = await pbService.users.getUser(username, this.gameId)

      if (user.hasOwnProperty("id")) {
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
      // Check if user exists (they just need to re-login)
      let user = await pbService.users.getUser(username, this.gameId)
      if (user.hasOwnProperty("id") && user.username != this.userStore.username) {
        this.$emit("snack", "Username already exists. Please enter a new one (or ignore if it's you).", "warning")
        return
      } else {
        let updateData = {
          "username": username,
          "color": color,
          "avatar": avatar,
          "game": this.userStore.gameId,
          "is_host": this.userStore.is_host,
          "position": this.userStore.position,
        }
        let resp = await pbService.users.updateUser(this.userStore.userId, updateData)
        if (resp.errMsg) {
          this.$emit("snack", resp.errMsg, "error")
          return;
        }
        this.userStore.user = resp.data
        this.showEditUsernameDialog = false
      }
    },
  },
};
</script>
<style scoped>
.drag-item {
  display: flex;
  align-items: center;
  padding: 10px;
  margin: 5px 0;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 1px 2px 5px 1px rgba(0, 0, 0, 0.3);
  /* Prevent text selection during drag */
  user-select: none;
  -webkit-user-select: none;

  /* Better touch targets */
  min-height: 44px;

  /* Smooth feedback */
  transition: transform 0.2s ease;
}

.drag-item:active {
  transform: scale(1.02);
}

.grab {
  cursor: grab;
}

.grab:active {
  cursor: grabbing;
}

.drag-handle {
  margin-right: 10px;
  color: #999;
  user-select: none;
}

.item-content {
  flex: 1;
}

.wrap {
  text-align: center;
  white-space: break-spaces;
  word-break: break-word;
  word-wrap: break-word;
}

.waiting-box {
  max-height: calc(100vh - 320px);
  overflow-y: auto;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.safe-bottom {
  margin-bottom: 64px;
}
</style>
