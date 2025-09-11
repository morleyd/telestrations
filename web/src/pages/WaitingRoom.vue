<template>
  <AppBar />
  <v-card class="pa-4 overflow-y-auto" height="calc(100vh - 48px)" style="justify-items: center;">
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
    <div class="pa-4 waiting-box">
      <draggable :list="users" :animation="200" @change="handleChange" :disabled="!userStore.is_host">
        <div v-for="[index, item] of users.entries()" :key="item.id" class="d-flex align-center ga-4">
          <v-icon :icon="getIndexIcon(index)" size="x-large" />
          <div class="drag-item" :class="{ grab: userStore.is_host }">
            <span v-if="userStore.is_host" class="drag-handle">⋮⋮</span>
            <span class="item-content wrap">{{ item.username }}</span>
            <v-btn v-if="item.username == userStore.username" icon="mdi-pencil" size="small" variant="text"
              @click="onEditUserClick()" />
            <v-btn v-if="userStore.is_host" icon="mdi-trash-can-outline" size="small" variant="text"
              @click="deleteItem(item.id)" />
          </div>
        </div>
      </draggable>
    </div>
    <v-card-actions>
      <v-btn v-if="userStore.is_host" class="bg-primary" size="x-large" variant="elevated" @click="onBeginClicked">
        Begin!
      </v-btn>
      <v-btn v-else color="error" size="x-large" variant="elevated" @click="leaveParty">
        Leave Party
      </v-btn>
    </v-card-actions>
  </v-card>

  <v-dialog v-model="showEditUsernameDialog" max-width="500" persistent>
    <v-card class="pa-4 bg-white" width="500" max-width="100%">
      <v-card-title class="text-center text-h4">Enter your Username!</v-card-title>
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
    console.log("Waiting Room", gameCode)

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
      this.$emit("snack", "Sorry, this game has already been started.", "error")
      this.$router.push({ name: "TakeTurn", params: { gameCode: gameCode } });
      return
    }

    this.gameId = validGame.gameId

    console.log("waiting room begin data", this.userStore.username, this.userStore.game, this.userStore.is_host)
    if (!this.userStore.username) {
      this.showEditUsernameDialog = true
    } else {
      this.userStore.user = await pbService.users.getUser(this.userStore.username, validGame.gameId)
    }

    let resp = await pbService.users.getUsers(gameCode)
    if (resp.errMsg) {
      this.$emit("snack", resp.errMsg, "error")
      return;
    }
    this.users = resp.data

    let that = this
    // Subscribe to users
    resp = pb.collection('users').subscribe('*', async function (e) {
      console.log("users subscription event", e)
      let resp = await pbService.users.getUsers(gameCode)
      if (resp.errMsg) {
        that.$emit("snack", resp.errMsg, "error")
        return;
      }
      that.users = resp.data
    }, { filter: `game_id.game_code="${gameCode}"` })

    // Subscribe to the game to know when to redirect
    resp = pb.collection('games').subscribe('*', async function (e) {
      console.log("games subscription event", e)
      that.$router.push({ name: "TakeTurn", params: { gameCode: gameCode } });
    }, { filter: `game_code="${gameCode}"` })
  },
  unmounted() {
    pb.collection('users').unsubscribe();
  },
  methods: {
    onEditUserClick() {
      this.showEditUsernameDialog = true
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
      for (let idx = 0; idx < this.users.length; idx++) {
        let user = this.users[idx];
        let updateData = {
          "username": user.username,
          "game": user.game,
          "is_host": user.is_host,
          "position": idx,
        }
        let resp = await pbService.users.updateUser(user.id, updateData)
        if (resp.errMsg) {
          this.$emit("snack", resp.errMsg, "error")
          return;
        }
      }

      let resp = await pbService.games.updateGame(this.gameId, { isStarted: true })
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
        return
      }
    },
    leaveParty() {
      this.deleteItem(this.userStore.userId)
    },
    getIndexIcon(idx) {
      return `mdi-numeric-${idx + 1}-circle`
    },
    handleChange(event) {
      console.log('Changed:', event)
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
        await this.updateUser()
      } else {
        await this.createUser(validation.username, validation.color)
      }
    },
    async createUser(username, color) {
      let user = await pbService.users.getUser(username, this.gameId)

      if (user.hasOwnProperty("id")) {
        this.userStore.user = user
        this.$emit("snack", "Username already exists. Assuming it's yours.", "warning")
      } else {
        let error = await this.userStore.newUser(username, color, this.gameId, false)
        if (error.errMsg) {
          this.$emit("snack", error.errMsg, "error")
        } else {
          this.showEditUsernameDialog = false
        }
      }
    },
    async updateUser(username, color) {
      let user = await pbService.users.getUser(username, this.gameId)
      if (user.hasOwnProperty("id") && user.username != this.userStore.username) {
        this.$emit("snack", "Username already exists. Please enter a new one (or ignore if it's you).", "warning")
        return
      } else if (user.hasOwnProperty("id") && user.username == this.userStore.username) {
        // No change, just close the dialog
        this.showEditUsernameDialog = false
      } else {
        let updateData = {
          "username": username,
          "color": color,
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
</style>
