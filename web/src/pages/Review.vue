<template>
  <AppBar />
  <v-slide-x-transition>
    <!-- Tucked into the corner: a slide's prompt and banner keep clear of it
         (see .slide-prompt). -->
    <v-btn v-if="!sidebarVisible" icon="mdi-menu" color="secondary" elevation="6" @click="sidebarVisible = true"
      class="ms-2 mt-14 position-absolute left-0 top-0" style="z-index: 1;" />
    <v-card v-else class="position-absolute left-0 bottom-0" width="250" height="calc(100vh - 48px)">
      <v-toolbar color="secondary" density="compact" elevation="4" title="Users">
        <v-btn icon="mdi-close" v-tooltip:bottom="'close'" @click="sidebarVisible = false" />
      </v-toolbar>
      <v-container id="chat-scroll" class="overflow-y-auto" height="calc(100vh - 96px)">
        <v-row v-for="(item, index) in users" no-gutters :key="index">
          <div class="user-item wrap" @click="onUserClick(item.starter_user_id)">
            <AvatarIcon :user="userMap[item.starter_user_id]" />
            <span>{{ userMap[item.starter_user_id]?.username }}</span>
            <span>({{ storyProgress(item).label }})</span>
          </div>
        </v-row>
      </v-container>
    </v-card>
  </v-slide-x-transition>
  <div style="display: grid;">
    <v-carousel v-if="story" height="calc(100vh - 48px)" progress="surface" style="justify-self: right;"
      :style="getWindowWidth">
      <v-carousel-item v-for="(turn, idx) in story" :key="idx" lazy-src="@/assets/logo.svg" gradient="#2c5ea3, #e3eefc">
        <!-- One column, top to bottom: banner, what the turn was made from, the
             turn itself, who made it. The turn takes whatever height is left,
             so a drawing can never grow over the name. -->
        <div class="slide">
          <div v-if="turnBanner(turn)" class="turn-banner px-4 py-1">
            {{ turnBanner(turn) }}
          </div>
          <!-- A skipped turn after the opening word just repeats the one before
               it; say what happened instead of showing it twice. -->
          <div v-if="turn.skipped && turn.turn_number > 0" class="slide-main">
            <v-card-title class="wrap text-h4">
              ⏱ {{ userMap[turn.turn_user_id].username }} ran out of time
            </v-card-title>
          </div>
          <template v-else-if="turn.drawing">
            <div v-if="turn.prev?.prompt" class="slide-prompt wrap">
              <div class="slide-prompt-label">Prompt</div>
              <div class="text-h6">{{ turn.prev.prompt }}</div>
            </div>
            <div class="slide-main">
              <img class="slide-drawing" :src="turn.drawing" :alt="`Drawing by ${userMap[turn.turn_user_id].username}`">
            </div>
          </template>
          <template v-else>
            <div v-if="turn.prev?.drawing" class="slide-prompt">
              <div class="slide-prompt-label">Prompt</div>
              <img class="slide-thumb" :src="turn.prev.drawing"
                :alt="`Drawing by ${userMap[turn.prev.turn_user_id].username}`">
            </div>
            <div class="slide-main">
              <v-card-title class="wrap text-h4">{{ turn.prompt }}</v-card-title>
            </div>
          </template>
          <div class="slide-author">
            <AvatarIcon :user="userMap[turn.turn_user_id]" />
            <span class="text-h6">{{ userMap[turn.turn_user_id].username }}</span>
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
import { storyProgress } from '@/services/progress'
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
    if (resp.data) {
      this.userMap = Object.fromEntries(resp.data.map(obj => [obj.id, obj]))
    }

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
    storyProgress,
    async getProgress() {
      let resp = await pbService.progress.getFullProgress(this.$route.params.gameCode)
      if (resp.aborted) return // a newer refresh is on its way
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
      // On a phone the list leaves the story a sliver of the screen; get it
      // out of the way once they've picked one.
      if (this.$vuetify.display.xs) this.sidebarVisible = false
      let resp = await pbService.progress.getUserStoryWithTurns(userId)
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
      }
      const turns = resp.data || []
      // Each turn was made from the one before it (a skip carries that one's
      // word or drawing forward unchanged), so pair them up here, before skips
      // are dropped: the slide shows what the player was given.
      //
      // Host skips just carry the previous turn forward; leave them out. Keep
      // timeouts (they get a "ran out of time" slide) and opening words (a story
      // needs its first word, even a randomly picked one).
      this.story = turns.length
        ? turns
          .map((turn, i) => ({ ...turn, prev: turns[i - 1] }))
          .filter(turn => !turn.skipped || turn.timed_out || turn.turn_number == 0)
        : null
    },
    // Banner over a turn's slide: how it came to be, when it wasn't simply
    // played. Only on the review; during the game these turns look normal.
    turnBanner(turn) {
      if (turn.skipped && turn.turn_number == 0) {
        return turn.timed_out
          ? "⏱ Ran out of time, so we picked a random word"
          : "Skipped by the host, so we picked a random word"
      }
      if (turn.timed_out && !turn.skipped) return "⏱ Ran out of time"
      return ""
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

.slide {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  /* The bottom padding clears the carousel's slide dots. */
  padding: 16px 16px 64px;
}

/* Takes the height the rest of the slide leaves. */
.slide-main {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  /* Keep text clear of the carousel's arrows. */
  padding: 0 56px;
}

.slide-drawing {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Narrower than the slide by the sidebar button's corner on each side. */
.slide-prompt,
.turn-banner {
  max-width: calc(100% - 96px);
}

.slide-prompt {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2px 12px 6px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 12px;
}

.slide-prompt .text-h6 {
  line-height: 1.3;
}

.slide-prompt-label {
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.slide-thumb {
  max-width: 100%;
  max-height: min(25vh, 200px);
  object-fit: contain;
  background: white;
  border-radius: 8px;
}

.slide-author {
  flex: none;
  display: flex;
  align-items: center;
}

.turn-banner {
  flex: none;
  background: rgba(255, 243, 205, 0.95);
  border: 1px solid #e0b252;
  border-radius: 16px;
  color: #6b4e00;
  font-weight: 500;
}

.wrap {
  text-align: center;
  white-space: break-spaces;
  word-break: break-word;
  word-wrap: break-word;
}
</style>
