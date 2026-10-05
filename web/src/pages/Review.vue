<template>
  <AppBar />
  <v-slide-x-transition>
    <!-- Tucked into the corner: a slide's prompt and banner keep clear of it
         (see .slide-prompt). -->
    <v-btn v-if="!sidebarVisible" icon="mdi-menu" color="secondary" elevation="6" @click="sidebarVisible = true"
      class="ms-2 mt-14 position-absolute left-0 top-0" style="z-index: 1;" />
    <v-card v-else class="position-absolute left-0 bottom-0 review-sidebar" width="250" height="calc(100vh - 48px)">
      <v-toolbar color="secondary" density="compact" elevation="4" title="Users">
        <v-btn icon="mdi-close" v-tooltip:bottom="'close'" @click="sidebarVisible = false" />
      </v-toolbar>
      <v-container id="chat-scroll" class="overflow-y-auto" height="calc(100vh - 96px)">
        <!-- On a phone the list leaves the story a sliver of the screen, too
             narrow for what's going on; say it up here instead. -->
        <v-alert v-if="showIntro && introInSidebar" class="review-intro mb-2" color="secondary" variant="tonal"
          density="compact" :icon="intro.icon" :title="intro.title" :text="intro.text" />
        <!-- The review is open while the game is still going (the host has a
             button for it; anyone can use the link), so players can get back. -->
        <!-- Play again: the same players, straight into a new game. -->
        <v-btn v-if="canPlayAgain" block color="primary" class="mb-2" prepend-icon="mdi-replay" @click="openPlayAgain">
          Start new game
        </v-btn>
        <v-alert v-if="joinOffer" class="mb-2" type="info" density="compact" text="The host started a new game.">
          <v-btn class="mt-2" block color="primary" :loading="following" @click="followNextGame">
            Join the new game
          </v-btn>
        </v-alert>
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
            <div class="user-item-text">
              <span class="hand user-item-name">{{ userMap[item.starter_user_id]?.username }}</span>
              <span class="story-waiting text-caption text-medium-emphasis">{{ waitingOn(item, userMap, myId) }}</span>
            </div>
            <span>({{ storyProgress(item).label }})</span>
          </div>
        </v-row>
      </v-container>
    </v-card>
  </v-slide-x-transition>
  <div style="display: grid;">
    <v-carousel v-if="story" class="review-carousel" height="calc(100vh - 48px)" progress="primary"
      hide-delimiter-background style="justify-self: right;" :style="getWindowWidth">
      <v-carousel-item v-for="(turn, idx) in story" :key="idx">
        <!-- One column, top to bottom: banner, what the turn was made from, the
             turn itself, who made it. The turn takes whatever height is left,
             so a drawing can never grow over the name. Each slide is a card on
             a sheet of a different paper color. -->
        <div class="slide" :class="`slide--${idx % 5}`">
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
            <div v-if="turn.prev?.prompt" class="slide-prompt">
              <div class="slide-prompt-label">Prompt</div>
              <div class="hand slide-prompt-text">{{ turn.prev.prompt }}</div>
            </div>
            <div class="slide-main">
              <img v-if="!brokenDrawings[turn.drawing]" class="slide-drawing" :src="turn.drawing"
                :alt="`Drawing by ${userMap[turn.turn_user_id].username}`" @error="brokenDrawings[turn.drawing] = true">
              <div v-else class="slide-broken">(this drawing couldn't be loaded)</div>
            </div>
          </template>
          <template v-else>
            <div v-if="turn.prev?.drawing" class="slide-prompt">
              <div class="slide-prompt-label">Prompt</div>
              <img v-if="!brokenDrawings[turn.prev.drawing]" class="slide-thumb" :src="turn.prev.drawing"
                :alt="`Drawing by ${userMap[turn.prev.turn_user_id].username}`"
                @error="brokenDrawings[turn.prev.drawing] = true">
              <div v-else class="slide-broken slide-broken--thumb">(this drawing couldn't be loaded)</div>
            </div>
            <div class="slide-main">
              <div class="wrap hand slide-guess">{{ turn.prompt }}</div>
            </div>
          </template>
          <div class="slide-author">
            <AvatarIcon :user="userMap[turn.turn_user_id]" />
            <span class="hand text-h5">{{ userMap[turn.turn_user_id].username }}</span>
          </div>
        </div>
      </v-carousel-item>
      <!-- The end of the story: save it. Next still wraps round to the start.
           (Every story at once is at the top of the player list.) -->
      <v-carousel-item key="end">
        <div class="slide" :class="`slide--${story.length % 5}`">
          <div class="slide-main align-center ga-4">
            <v-card-title class="wrap text-h4">That's {{ starterName }}'s story!</v-card-title>
            <v-btn color="primary" size="x-large" prepend-icon="mdi-download" :loading="downloading == 'story'"
              :disabled="Boolean(downloading)" @click="downloadStory">
              Download this story
            </v-btn>
          </div>
        </div>
      </v-carousel-item>
    </v-carousel>
    <!-- Before a story is open: a player who has just been sent here took this
         blank space for a bug, so say what's going on. -->
    <div v-else-if="showIntro && !introInSidebar" class="intro-space" :style="getWindowWidth">
      <v-card class="review-intro pa-6 text-center sketch-card" max-width="520">
        <v-icon :icon="intro.icon" color="secondary" size="48" />
        <v-card-title class="wrap text-h5">{{ intro.title }}</v-card-title>
        <v-card-text class="text-body-1">{{ intro.text }}</v-card-text>
        <v-btn v-if="!sidebarVisible" color="secondary" prepend-icon="mdi-menu" @click="sidebarVisible = true">
          Show the stories
        </v-btn>
      </v-card>
    </div>
  </div>

  <v-dialog v-model="showPlayAgain" max-width="500">
    <v-card class="pa-4 bg-white" width="500" max-width="100%">
      <v-card-title class="text-center text-h4">Play again!</v-card-title>
      <v-card-subtitle class="text-center wrap">
        Same players, same seats. Everyone goes straight to their first turn.
      </v-card-subtitle>
      <v-form ref="playAgainForm" @submit.prevent="playAgain">
        <GameSettings v-model="playAgainSettings" @submit="playAgain" />
        <v-row class="pa-2" style="justify-content: center;">
          <v-btn size="x-large" color="primary" elevation="2" :loading="startingAgain" @click="playAgain">
            Start!
          </v-btn>
        </v-row>
      </v-form>
    </v-card>
  </v-dialog>
</template>

<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pb, pbService } from '@/services/pocketbase'
import { log } from '@/services/log'
import { storyProgress, waitingOn } from '@/services/progress'
import { reviewTurns, ranOutOfTime, turnBanner } from '@/services/story'
import { storyImage, zipFiles, fileSafe, saveFile } from '@/services/storyImage'
import { settingsOf, gameFields } from '@/services/settings'

// How often the review re-checks the game (see created).
const POLL_MS = 5000
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
      // This viewer's row from /players, if they're in this game, and everyone's.
      me: null,
      players: [],
      // The game, as checkGameStatus reads it (settings, nextGame).
      game: null,
      // Play again: the dialog, its settings, and the request in flight.
      showPlayAgain: false,
      playAgainSettings: null,
      startingAgain: false,
      // Moving this player to their seat in the next game: in flight, and
      // wanted (the host started it while this page was open, so keep trying
      // until it works).
      following: false,
      movingAcross: false,
      // Show "Join the new game": a next game started before this page opened
      // (we don't pull them away from the stories they came to look at), or
      // moving them across failed and they can try again.
      joinOffer: false,
      // Drawings that wouldn't load, by address: shown as a note instead, as
      // the browser's own stand-in (the alt text) is smeared by the drawing's
      // ink outline.
      brokenDrawings: {},
      pollTimer: null,
      // Set once the page has closed (see unmounted).
      tornDown: false,
      // Reads on their way: of the players' names, and of the progress (the
      // poll waits for these rather than cancel them). The progress is a
      // count: a newer read (a turn event's, or the one after the names)
      // cancels an older one, and the cancelled one finishing mustn't make
      // the poll think none is on its way.
      readingNames: false,
      progressReads: 0,
      // Whose story is open, and whether it's still on its way.
      starterId: "",
      storyLoading: false,
      // The stories' progress has been read at least once.
      progressLoaded: false,
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
    // This viewer is a player in this game (the stored user can be from an
    // earlier one).
    inThisGame() {
      return Boolean(this.gameId && this.userStore.gameId === this.gameId)
    },
    // The host, once everyone is done and nobody has started another game.
    canPlayAgain() {
      return Boolean(this.me?.is_host && this.players.length && this.players.every(p => p.finished) &&
        !this.game?.nextGame)
    },
    // A player in this game who still has turns to play.
    stillPlaying() {
      return Boolean(this.me && !this.me.finished && !this.me.dropped)
    },
    // Whoever is looking, for "Waiting on you": only a player in this game.
    myId() {
      return this.inThisGame ? this.userStore.userId : ""
    },
    // No story is waiting on anyone: they've all had their last turn, or the
    // game is over.
    allDone() {
      return this.users.length > 0 && this.users.every(row => !row.next_user_id)
    },
    // What the page says before a story is opened.
    intro() {
      if (this.allDone) {
        return {
          icon: "mdi-flag-checkered",
          title: "That's the game!",
          text: "The game is over. Pick a story from the list to see how it turned out.",
        }
      }
      if (this.me?.finished && !this.me.dropped) {
        return {
          icon: "mdi-check-circle",
          title: "You've finished all your turns!",
          text: "The others are still playing. While you wait, pick a story from the list to see how it's going. " +
            "Each one says who it's waiting on.",
        }
      }
      return {
        icon: "mdi-book-open-variant",
        title: "The stories so far",
        text: "Pick a story from the list to see how it's going. Each one says who it's waiting on.",
      }
    },
    // Once we know which intro it is (a player's own status comes separately
    // from the stories), and while no story is open or on its way.
    showIntro() {
      return !this.story && !this.storyLoading && this.progressLoaded && (!this.inThisGame || this.players.length > 0)
    },
    introInSidebar() {
      return this.$vuetify.display.xs && this.sidebarVisible
    },
  },
  async created() {
    const game = await pbService.games.checkGameStatus(this.$route.params.gameCode)
    // The page can close while these reads are on their way; past this point
    // nothing would clear the timer and subscriptions.
    if (this.tornDown) return
    if (game.errMsg) {
      this.$emit("snack", game.errMsg, "error")
    }
    this.game = game
    this.gameId = game.gameId
    this.getMe()
    if (game.nextGame && this.inThisGame) {
      this.joinOffer = !(await pbService.users.getNextSeat(this.userStore.userId)).notFound
      if (this.tornDown) return
    }
    // Realtime brings the host's End Game and Play again, but a phone that
    // slept through the event would never hear of them; and once End Game's
    // time is up everyone is finished with nothing written to say so. So also
    // check now and then.
    this.pollTimer = setInterval(() => this.poll(), POLL_MS)

    this.refresh()

    let that = this
    pb.collection('turns').subscribe('*', async function (e) {
      console.log("turns subscription event", e)
      that.refresh()
      that.getMe()
    }, { filter: `game_id.game_code="${that.$route.params.gameCode}"` })
    // The host ending the game finishes everyone; the host starting another
    // takes everyone across to it.
    if (this.gameId) {
      pb.collection('games').subscribe(this.gameId, (e) => {
        that.getMe()
        if (e.record?.next_game && !that.game?.nextGame) that.nextGameStarted(e.record.next_game)
      })
    }
  },
  unmounted() {
    // created()'s awaits may still be on their way; this stops them going on
    // to start the timer and subscriptions after they're cleared here.
    this.tornDown = true
    pb.collection('turns').unsubscribe();
    pb.collection('games').unsubscribe();
    clearInterval(this.pollTimer)
  },
  methods: {
    storyProgress,
    waitingOn,
    ranOutOfTime,
    turnBanner,
    // Where this viewer stands in the game, for "Back to game" and what the
    // page says before a story is open. The stored user can be from an
    // earlier game, so only one from this game counts.
    async getMe() {
      if (!this.inThisGame) return
      const resp = await pbService.games.getPlayers(this.gameId)
      if (resp.errMsg) return // keep what we had; the next turn retries
      this.players = resp.data
      this.me = resp.data.find(p => p.id === this.userStore.userId) || null
    },
    async poll() {
      // Re-read the progress for anyone looking, players or not: End Game's
      // deadline passes with nothing written, and a failed read needs a retry.
      // Not over a read still on its way: it's as new, and cancelling it for
      // one that takes as long would never let either land.
      if (!this.progressReads) this.refresh()
      if (!this.inThisGame || this.following) return
      if (this.movingAcross) {
        this.followNextGame() // the last try failed
        return
      }
      this.getMe()
      if (this.game?.nextGame) return
      const game = await pbService.games.checkGameStatus(this.$route.params.gameCode)
      if (game.nextGame && !this.game?.nextGame) this.nextGameStarted(game.nextGame)
    },
    // The host started the next game while this page was open: take the
    // player across.
    nextGameStarted(nextGame) {
      this.game = { ...this.game, nextGame }
      this.movingAcross = true
      this.followNextGame()
    },
    openPlayAgain() {
      this.playAgainSettings = settingsOf(this.game)
      this.showPlayAgain = true
    },
    async playAgain() {
      if (this.startingAgain) return // Enter fires the submit more than once
      this.startingAgain = true
      try {
        if (!(await this.$refs.playAgainForm.validate()).valid) return
        log.info("host.playAgain", gameFields(this.playAgainSettings))
        const resp = await pbService.games.rematch(this.gameId, this.userStore.userId, gameFields(this.playAgainSettings))
        if (resp.errMsg) {
          this.$emit("snack", resp.errMsg, "error")
          return
        }
        this.showPlayAgain = false
        this.nextGameStarted(resp.data.game_id)
      } finally {
        this.startingAgain = false
      }
    },
    // Moves this player to their seat in the game that followed this one, and
    // into it. Someone who wasn't playing (or was dropped) has no seat there.
    async followNextGame() {
      if (this.following || !this.inThisGame) return
      this.following = true
      const { seat, notFound, errMsg } = await pbService.users.getNextSeat(this.userStore.userId)
      if (!seat) {
        this.following = false
        // Not found: they weren't carried over (dropped). Otherwise they can
        // try again, and the poll will.
        this.joinOffer = !notFound
        if (notFound) this.movingAcross = false
        else log.warn("game.follow.failed", { err: errMsg })
        return
      }
      // They've left the page meanwhile: don't pull them back.
      if (this.tornDown) {
        this.following = false
        return
      }
      log.info("game.follow", { game: seat.expand?.game_id?.game_code, userId: seat.id })
      const { expand, ...user } = seat
      this.userStore.user = user
      this.$router.push({ name: "TakeTurn", params: { gameCode: expand.game_id.game_code } })
    },
    // Brings the list up to date. It shows the players' names, so until
    // they're in this reads them instead (and then the progress): a failed
    // read of the names is tried again too.
    refresh() {
      if (this.userMap) this.getProgress()
      else this.getNames()
    },
    async getNames() {
      if (this.readingNames) return // it can take longer than the poll
      this.readingNames = true
      const resp = await pbService.users.getUserMap(this.$route.params.gameCode)
      this.readingNames = false
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
      }
      if (!resp.userMap) return // the next refresh tries again
      this.userMap = resp.userMap
      this.getProgress()
    },
    async getProgress() {
      this.progressReads++
      let resp = await pbService.progress.getFullProgress(this.$route.params.gameCode)
      this.progressReads--
      if (resp.aborted) return // a newer refresh is on its way
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
        return // keep what we had; the poll retries
      }
      this.users = resp.data
      this.progressLoaded = true
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
      this.storyLoading = true
      // On a phone the list leaves the story a sliver of the screen; get it
      // out of the way once they've picked one.
      if (this.$vuetify.display.xs) this.sidebarVisible = false
      let resp = await pbService.progress.getUserStoryWithTurns(userId)
      if (this.starterId !== userId) return // another story was opened meanwhile
      this.storyLoading = false
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
.review-sidebar {
  border-right: 2.5px solid var(--ink);
  border-radius: 0;
}

.user-item {
  width: 100%;
  padding: 8px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 6px 4px 6px 0;
  background: rgb(var(--v-theme-surface));
  border: 2px solid var(--ink);
  border-radius: var(--wobble-small);
  box-shadow: 3px 3px 0 var(--ink);
  cursor: pointer;
  /* Prevent text selection during drag */
  user-select: none;
  -webkit-user-select: none;

  /* Better touch targets */
  min-height: 44px;
}

.user-item:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--ink);
}

.user-item-name {
  font-size: 1.35rem;
  line-height: 1.1;
}

/* The name, and under it who the story is waiting on. */
.user-item-text {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.25;
}

/* Where a story would be, before one is open. */
.intro-space {
  justify-self: right;
  height: calc(100vh - 48px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
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

/* The arrows sit in the bottom corners, level with the slide dots, which
   leaves the slide's sides to the card. */
.review-carousel :deep(.v-window__controls) {
  align-items: flex-end;
  padding: 0 20px 12px;
  /* Over the dots' strip, which spans the bottom: the arrows must take the
     clicks (the rest of this layer lets them through) */
  z-index: 2;
}

.review-carousel :deep(.v-carousel__controls) {
  height: 72px;
  color: var(--ink);
}

/* This slide's dot, in red */
.review-carousel :deep(.v-carousel__controls__item.v-btn--active) {
  color: rgb(var(--v-theme-tertiary));
}

.review-carousel :deep(.v-carousel__controls__item.v-btn--active .v-icon) {
  opacity: 1;
}

.review-carousel :deep(.v-carousel__controls__item.v-btn--active > .v-btn__overlay) {
  opacity: 0;
}

/* An inked card on a sheet of colored paper. The sheet and the card's paper
   are drawn behind the content, the sheet askew. */
.slide {
  --sheet: rgb(var(--v-theme-grass));
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: calc(100% - 40px);
  max-width: 1100px;
  /* The bottom margin clears the arrows and slide dots, the top the sheet's
     tilted corner. */
  height: calc(100% - 108px);
  margin: 24px auto 84px;
  padding: 16px 18px 14px;
}

.slide::before,
.slide::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: var(--wobble-card);
}

/* A little bigger than the card and firmly askew, so it shows as a sheet
   underneath at every screen size (a tilt alone shows far more of it on a
   narrow card than a wide one) */
.slide::before {
  inset: -6px;
  background: var(--sheet);
  box-shadow: 0 4px 0 rgba(43, 33, 24, 0.12);
  transform: rotate(-1.6deg);
}

.slide::after {
  background: rgb(var(--v-theme-surface));
  border: 2.5px solid var(--ink);
  box-shadow: 6px 6px 0 var(--ink);
}

.slide--1 {
  --sheet: rgb(var(--v-theme-primary));
}

.slide--2 {
  --sheet: rgb(var(--v-theme-tertiary));
}

.slide--3 {
  --sheet: rgb(var(--v-theme-plum));
}

.slide--4 {
  --sheet: rgb(var(--v-theme-secondary));
}

@media (max-width: 600px) {
  .slide::before {
    inset: -4px;
    transform: rotate(-2.6deg);
  }
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
}

/* Inked round the picture itself (not the letterbox round it), with the
   cards' hard shadow */
.slide-drawing {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(2px 0 0 var(--ink)) drop-shadow(-2px 0 0 var(--ink)) drop-shadow(0 2px 0 var(--ink))
    drop-shadow(0 -2px 0 var(--ink)) drop-shadow(4px 4px 0 var(--ink));
}

/* A drawing that wouldn't load (one in a type this browser can't draw). */
.slide-broken {
  align-self: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 1.25rem;
}

.slide-broken--thumb {
  font-size: 0.9rem;
}

.slide-guess {
  font-size: clamp(2rem, 1.2rem + 2.5vw, 3.25rem);
  line-height: 1.15;
}

/* Narrower than the card by the sidebar button's corner on each side. */
.slide-prompt,
.turn-banner {
  max-width: calc(100% - 96px);
}

/* What the turn was made from, a word or a drawing, on a scrap of paper
   pinned to the card. On the left, past the sidebar button's corner. */
.slide-prompt {
  position: relative;
  flex: none;
  align-self: flex-start;
  margin: 8px 0 4px 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 12px 14px 12px;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 3px 0 rgba(43, 33, 24, 0.1), 0 8px 16px rgba(43, 33, 24, 0.14);
  transform: rotate(-2deg);
  text-align: left;
  white-space: break-spaces;
  word-break: break-word;
}

.slide-prompt::before {
  content: "";
  position: absolute;
  top: -10px;
  left: 50%;
  width: 20px;
  height: 20px;
  margin-left: -10px;
  background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.6) 0 3px, transparent 3.5px),
    rgb(var(--v-theme-tertiary));
  border-radius: 50%;
  box-shadow: 0 2px 0 rgba(43, 33, 24, 0.25);
}

.slide-prompt-label {
  padding: 3px 12px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-grass-darken-1));
  background: rgba(var(--v-theme-grass), 0.16);
  border-radius: 999px;
}

.slide-prompt-text {
  font-size: 1.6rem;
  line-height: 1.2;
}

.slide-thumb {
  display: block;
  max-width: 100%;
  max-height: min(25vh, 200px);
  object-fit: contain;
}

.slide-author {
  flex: none;
  display: flex;
  align-items: center;
}

.turn-banner {
  flex: none;
  background: rgb(var(--v-theme-secondary-lighten-3));
  border: 2px solid var(--ink);
  border-radius: 999px;
  color: var(--ink);
  font-weight: 600;
}

.wrap {
  text-align: center;
  white-space: break-spaces;
  word-break: break-word;
  word-wrap: break-word;
}
</style>
