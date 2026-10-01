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
        <!-- The review is open while the game is still going (the host has a
             button for it; anyone can use the link), so players can get back. -->
        <v-btn v-if="stillPlaying" block color="primary" class="mb-2" prepend-icon="mdi-arrow-left"
          :to="{ name: 'TakeTurn', params: { gameCode: $route.params.gameCode } }">
          Back to game
        </v-btn>
        <v-btn v-if="users.length" block variant="tonal" class="mb-2" prepend-icon="mdi-folder-download"
          :loading="downloading == 'all'" :disabled="Boolean(downloading)" @click="downloadAll">
          Download all stories
        </v-btn>
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
          <div v-if="ranOutOfTime(turn)" class="slide-main">
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
      <!-- The end of the story: save it. Next still wraps round to the start. -->
      <v-carousel-item key="end" gradient="#2c5ea3, #e3eefc">
        <div class="slide">
          <div class="slide-main align-center ga-4">
            <v-card-title class="wrap text-h4">That's {{ starterName }}'s story!</v-card-title>
            <v-btn color="primary" size="x-large" prepend-icon="mdi-download" :loading="downloading == 'story'"
              :disabled="Boolean(downloading)" @click="downloadStory">
              Download this story
            </v-btn>
            <v-btn variant="tonal" prepend-icon="mdi-folder-download" :loading="downloading == 'all'"
              :disabled="Boolean(downloading)" @click="downloadAll">
              Download all stories
            </v-btn>
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
import { reviewTurns, ranOutOfTime, turnBanner } from '@/services/story'
import { storyImage, zipFiles, fileSafe, saveFile } from '@/services/storyImage'
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
      // This viewer's row from /players, if they're in this game.
      me: null,
      // Whose story is open.
      starterId: "",
      // The download being made: "story", "all", or "".
      downloading: "",
    }
  },
  computed: {
    ...mapStores(useUserStore),
    getWindowWidth() {
      return { width: this.sidebarVisible ? "calc(100vw - 250px)" : "100vw" }
    },
    starterName() {
      return this.userMap?.[this.starterId]?.username || "Someone"
    },
    gameCode() {
      return String(this.$route.params.gameCode).toUpperCase()
    },
    // A player in this game who still has turns to play.
    stillPlaying() {
      return Boolean(this.me && !this.me.finished && !this.me.dropped)
    },
  },
  async created() {
    let resp = await pbService.games.getGameId(this.$route.params.gameCode)
    if (resp.errMsg) {
      this.$emit("snack", resp.errMsg, "error")
    }
    this.gameId = resp.data
    this.getMe()

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
      that.getMe()
    }, { filter: `game_id.game_code="${that.$route.params.gameCode}"` })
    // The host ending the game finishes everyone.
    if (this.gameId) {
      pb.collection('games').subscribe(this.gameId, () => that.getMe())
    }
  },
  unmounted() {
    pb.collection('turns').unsubscribe();
    pb.collection('games').unsubscribe();
  },
  methods: {
    storyProgress,
    ranOutOfTime,
    turnBanner,
    // Where this viewer stands in the game, for "Back to game". The stored
    // user can be from an earlier game, so only one from this game counts.
    async getMe() {
      if (!this.gameId || this.userStore.gameId !== this.gameId) return
      const resp = await pbService.games.getPlayers(this.gameId)
      if (resp.errMsg) return // keep what we had; the next turn retries
      this.me = resp.data.find(p => p.id === this.userStore.userId) || null
    },
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
      this.starterId = userId
      // On a phone the list leaves the story a sliver of the screen; get it
      // out of the way once they've picked one.
      if (this.$vuetify.display.xs) this.sidebarVisible = false
      let resp = await pbService.progress.getUserStoryWithTurns(userId)
      if (this.starterId !== userId) return // another story was opened meanwhile
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
      }
      const turns = resp.data || []
      if (!resp.errMsg && !turns.length) {
        // Mid-game, a story can be opened but not started yet.
        this.$emit("snack", "Nothing in this story yet.", "info")
      }
      this.story = turns.length ? reviewTurns(turns) : null
    },
    storyTitle(name) {
      return { title: `${name}'s story`, subtitle: `Telestrations · game ${this.gameCode}` }
    },
    async downloadStory() {
      // Taken now: another story can be opened while this one draws.
      const [turns, name] = [this.story, this.starterName]
      await this.download("story", async () => {
        const blob = await storyImage(turns, this.userMap, this.storyTitle(name))
        saveFile(blob, `telestrations-${fileSafe(this.gameCode)}-${fileSafe(name)}.png`)
      })
    },
    // Every story in the game, one image each, in a zip.
    async downloadAll() {
      await this.download("all", async () => {
        const files = []
        const taken = new Set()
        for (const row of this.users) {
          const resp = await pbService.progress.getUserStoryWithTurns(row.starter_user_id)
          if (resp.errMsg) throw new Error(resp.errMsg)
          if (!resp.data.length) continue // opened, not started
          const name = this.userMap?.[row.starter_user_id]?.username || "someone"
          let file = fileSafe(name)
          for (let k = 2; taken.has(file); k++) file = `${fileSafe(name)}-${k}`
          taken.add(file)
          files.push([`${file}.png`, await storyImage(reviewTurns(resp.data), this.userMap, this.storyTitle(name))])
        }
        if (!files.length) {
          this.$emit("snack", "There are no stories to download yet.", "info")
          return
        }
        saveFile(await zipFiles(files), `telestrations-${fileSafe(this.gameCode)}.zip`)
      })
    },
    async download(kind, make) {
      if (this.downloading) return
      this.downloading = kind
      try {
        await make()
      } catch (err) {
        console.error("download failed", err)
        this.$emit("snack", `Couldn't make the download: ${err?.message || err}`, "error")
      } finally {
        this.downloading = ""
      }
    },
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
