<template>
  <AppBar />
  <v-slide-x-transition>
    <v-btn v-if="!sidebarVisible" color="secondary" elevation="6" size="large" @click="sidebarVisible = true"
      class="mx-8 mt-16 position-absolute left-0 top-0" style="z-index: 1;">
      <v-icon icon="mdi-menu" size="x-large" />
    </v-btn>
    <v-card v-else class="position-absolute left-0 bottom-0" width="250" height="calc(100vh - 48px)">
      <v-toolbar color="secondary" density="compact" elevation="4" title="Users">
        <v-btn icon="mdi-close" v-tooltip:bottom="'close'" @click="sidebarVisible = false" />
      </v-toolbar>
      <v-container id="chat-scroll" class="overflow-y-auto" height="calc(100vh - 96px)">
        <v-row v-for="(item, index) in users" no-gutters :key="index">
          <div class="user-item wrap" @click="onUserClick(item.starter_user_id)">
            <AvatarIcon :user="userMap[item.starter_user_id]" />
            <span>{{ userMap[item.starter_user_id]?.username }}</span>
            <span>({{ item.turns_taken }} / {{ item.total_players }})</span>
          </div>
        </v-row>
      </v-container>
    </v-card>
  </v-slide-x-transition>
  <div style="display: grid;">
    <v-carousel v-if="story" height="calc(100vh - 48px)" progress="surface" style="justify-self: right;"
      :style="getWindowWidth">
      <v-carousel-item v-for="(turn, idx) in story" :key="idx" lazy-src="@/assets/logo.svg" gradient="#2c5ea3, #e3eefc">
        <div class="d-flex fill-height justify-center align-center">
          <v-card-title class="position-absolute right-0 bottom-0 mb-12">
            {{ userMap[turn.turn_user_id].username }}
          </v-card-title>
          <div v-if="turn.drawing" class="pa-4" :style="getWindowWidth">
            <v-img :src="turn.drawing" width="100%" max-height="calc(100vh - 130px)" />
          </div>
          <div v-else class="fill-height align-content-center">
            <v-card-title class="wrap text-h4">{{ turn.prompt }}</v-card-title>
          </div>
        </div>
      </v-carousel-item>
    </v-carousel>
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pb, pbService } from '@/services/pocketbase'
export default {
  name: "TakeTurn",
  data() {
    return {
      userMap: null,
      users: [],
      username: "",
      showEditUsernameDialog: false,
      sidebarVisible: true,
      story: null,
      gameId: "",
    }
  },
  computed: {
    ...mapStores(useUserStore),
    getWindowWidth() {
      return { width: this.sidebarVisible ? "calc(100vw - 250px)" : "100vw" }
    },
  },
  async created() {
    let resp = pbService.games.getGameId(this.$route.params.gameCode)
    if (resp.errMsg) {
      this.$emit("snack", resp.errMsg, "error")
    }
    this.gameId = resp.data

    resp = await pbService.users.getUsers(this.$route.params.gameCode)
    if (resp.errMsg) {
      this.$emit("snack", resp.errMsg, "error")
    }
    this.userMap = Object.fromEntries(resp.data.map(obj => [obj.id, obj]))

    this.getProgress()

    let that = this
    pb.collection('turns').subscribe('*', async function (e) {
      console.log("turns subscription event", e)
      that.getProgress()
    }, { filter: `game_id.game_code="${that.$route.params.gameCode}"` })
  },
  unmounted() {
    pb.collection('turns').unsubscribe();
  },
  methods: {
    async getProgress() {
      let resp = await pbService.progress.getFullProgress(this.$route.params.gameCode)
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
      }
      this.users = resp.data
    },
    async getUsername(userId) {
      let resp = await pbService.users.getUsername(userId)
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
      }
      return resp.data || ""
    },
    async onUserClick(userId) {
      this.story = null // Reset the story while waiting so index resets
      let resp = await pbService.progress.getUserStoryWithTurns(userId)
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
      }
      this.story = resp.data
    }
  },
};
</script>
<style scoped>
.user-item {
  width: 100%;
  padding: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 5px 0;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 1px 2px 5px 1px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  /* Prevent text selection during drag */
  user-select: none;
  -webkit-user-select: none;

  /* Better touch targets */
  min-height: 44px;
}

.user-item:active {
  transform: scale(1.02);
}

.back-image {
  background-size: auto;
  width: calc(100% - 150px);
  height: calc(100vh - 130px);
  justify-items: center;
  top: 16px;
  position: absolute;
  background-repeat: no-repeat;
  background-position: center center;
}

.wrap {
  text-align: center;
  white-space: break-spaces;
  word-break: break-word;
  word-wrap: break-word;
}
</style>
