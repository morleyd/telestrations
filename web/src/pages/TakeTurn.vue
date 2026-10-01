// firstTurn finished waiting playing
<template>
  <AppBar />
  <div v-if="userState == 'waiting'" style="justify-self: center;">
    <WaitingScreen ref="waiting" />
  </div>
  <div v-else-if="userState == 'finished'" style="justify-self: center;">
    <span>Finished...</span>
    <span v-if="reviewPath">Review results at: <a :href="reviewPath">{{ reviewPath }}</a></span>
  </div>
  <!-- Keyed on the story so each turn gets fresh child components: an empty
       prompt box, a blank canvas and a restarted timer. Without it, moving to a
       second queued story kept the previous turn's text/drawing on screen. -->
  <div v-else-if="['firstTurn', 'playing'].includes(userState)" :key="turnKey">
    <CountdownTimer :duration="duration" @finished="onTimerFinished" />

    <DrawingTurn v-if="isDraw" ref="draw" :prompt="curPrompt.prev_prompt" @snack="emitSnack" @drawing="saveResponse" />
    <PromptTurn v-else ref="prompt" :isFirst="userState == 'firstTurn'" @snack="emitSnack"
      @prompt="saveResponse" />
  </div>
  <div v-else-if="userState == 'removed'" class="pa-4 text-center" style="justify-self: center;">
    <v-card-title class="wrap">The host removed you from this game.</v-card-title>
    <span v-if="reviewPath">You can still see the results at: <a :href="reviewPath">{{ reviewPath }}</a></span>
  </div>
  <div v-else-if="userState == 'loading'" class="pa-4 text-center" style="justify-self: center;">
    <v-progress-circular indeterminate color="primary" />
    <div class="mt-2">Loading...</div>
  </div>
  <div v-else style="justify-self: center;">
    <span>Error...</span>
  </div>

  <ConfirmRejoin ref="rejoin" />

  <v-dialog v-model="showLoginDialog" max-width="500" persistent>
    <v-card class="pa-4 bg-white" width="500" max-width="100%">
      <v-card-title class="text-center text-h4">Enter Your Username</v-card-title>
      <SetUsername ref="username" @username="onLoginClicked" />
      <v-row class="pa-2" style="justify-content: center;">
        <v-btn size="x-large" color="primary" elevation="2" @click="onLoginClicked">
          Join!
        </v-btn>
      </v-row>
    </v-card>
  </v-dialog>
</template>

<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pb, pbService } from '@/services/pocketbase'
import { log } from '@/services/log'

const POLL_MS = 2500
const DROPPED_CHECK_TICKS = 4 // ~10s
export default {
  name: "TakeTurn",
  data() {
    return {
      // "loading" until the first pass decides which turn we're on. Kept apart
      // from the Error screen (any unknown state): every player passes through
      // here when the host starts, and showing "Error..." while the first
      // turn loaded looked like the start had failed.
      userState: "loading",
      nextPrompts: [],
      curPrompt: null,
      showLoginDialog: false,
      // One Enter in the login dialog runs onLoginClicked twice (see
      // SetUsername's onSubmit). Latch on the first in-flight call so the
      // duplicate no-ops. Kept apart from `submitting`, the turn-write lock, so
      // signing in can never hold or release a turn submit.
      loggingIn: false,
      username: "",
      gameId: "",
      duration: -1,
      reviewPath: "",
      pollTimer: null,
      ownStory: null,
      turnsInFlight: null,
      tornDown: false,
      firstTurnTaken: false,
      submitting: false,
      // The story whose round timer ran out while a submit was in flight, so a
      // refused submit can still time out (the timer only fires once).
      expiredStory: "",
      // Stories we've already submitted a turn to. A lagging progress read must
      // never hand one of these back to us, or we'd write a second turn to it.
      submittedStories: new Set(),
    }
  },
  computed: {
    ...mapStores(useUserStore),
    turnKey() {
      return this.curPrompt?.story_id || this.curPrompt?.id || ""
    },
    // A turn after a word is a drawing; a turn after a drawing (prev_prompt
    // empty) is a guess. A first turn's curPrompt is the story itself, which
    // has no prev_prompt: a word.
    isDraw() {
      return Boolean(this.curPrompt?.prev_prompt)
    },
  },
  watch: {
    userState(to, from) {
      log.info("state", { from, to, story: this.turnKey, isDraw: this.isDraw })
    },
  },
  async mounted() {
    this.reviewPath = this.getReviewPath()
    // Check if game code is valid and game is active
    this.gameId = await this.isValidGame()
    if (!this.gameId) {
      this.userState = "error"
      return
    }
    log.setContext({ game: this.$route.params.gameCode, gameId: this.gameId })
    log.info("takeTurn.mounted", { duration: this.duration })

    // A stored user from an earlier game (sessionStorage outlives the game) is
    // not a player here; make them identify themselves rather than playing
    // under another game's user id.
    if (this.userStore.gameId !== this.gameId) {
      log.info("takeTurn.login", { reason: this.userStore.userId ? "otherGame" : "none" })
      this.showLoginDialog = true
      return
    }
    await this.startPlaying()
  },
  unmounted() {
    // mounted()'s awaits may still be in flight; the flag stops their
    // continuations from arming the subscription/timer after this cleanup ran.
    this.tornDown = true
    pb.collection('turns').unsubscribe();
    clearInterval(this.pollTimer);
    this.pollTimer = null
  },
  methods: {
    // Once we know who the player is (stored user, or after the login dialog):
    // start watching for turns and load the current one.
    async startPlaying() {
      log.setContext({ username: this.userStore.username, userId: this.userStore.userId })
      this.startTurnSync()
      await this.getTurns()
    },
    // Arm the two things that re-check turn state: the realtime `turns`
    // subscription and a polling fallback. Called via startPlaying() from
    // mounted() for returning players and from onLoginClicked() for players who
    // land via the login dialog — that path previously got neither, so after
    // their first turn nothing ever re-checked and they (and everyone waiting
    // on them) stalled.
    startTurnSync() {
      // The component can unmount while mounted()'s awaits are still in flight;
      // if cleanup already ran (or the timer is somehow armed), don't register
      // a subscription and interval nothing will ever tear down.
      if (this.tornDown || this.pollTimer) {
        return
      }
      let that = this
      pb.collection('turns').subscribe('*', async function (e) {
        log.info("turns.event", {
          action: e.action, story: e.record?.story_id, by: e.record?.user_id, skipped: e.record?.skipped,
        })
        // A skip of our turn that isn't our own timeout (onTimerFinished handles
        // that one) means the host skipped us.
        const r = e.record
        if (e.action === "create" && r?.skipped && !r.timed_out && r.user_id === that.userStore.userId) {
          that.onTurnSkipped(r.story_id)
          return
        }
        that.getTurns()
      }, { filter: `game_id="${that.gameId}"` })

      // Polling fallback. Advancing a turn is driven by the realtime
      // subscription above, but a wake-up event can arrive while we're
      // mid-transition into "waiting" and be dropped, leaving the player
      // stranded even though their next prompt is already available — and once
      // everyone ahead of them has finished, no further turn events fire to
      // re-trigger it. Re-checking on a timer makes progress self-heal. The
      // "loading" state (e.g. a createStory attempt that failed at the start
      // burst) is retried too — at game start no turn events exist yet, so
      // without the poll that screen was a dead end until manual refresh.
      //
      // Every DROPPED_CHECK_TICKS polls it also checks whether the host dropped
      // us: a player idling on a turn screen gets no event for that.
      let ticks = 0
      this.pollTimer = setInterval(async function () {
        if (that.userState === "waiting" || that.userState === "loading") {
          that.getTurns()
        } else if (++ticks % DROPPED_CHECK_TICKS == 0 && ['playing', 'firstTurn'].includes(that.userState)) {
          if ((await pbService.users.getUserById(that.userStore.userId)).dropped) that.setRemoved()
        }
      }, POLL_MS)
    },
    // The host skipped a turn we owed, maybe the one on screen. Never write to
    // that story, and move on if it's the one we're looking at.
    onTurnSkipped(storyId) {
      this.submittedStories.add(storyId)
      if (storyId === this.ownStory?.id) this.firstTurnTaken = true
      this.nextPrompts = this.nextPrompts.filter(p => p.story_id !== storyId)
      const onScreen = ['playing', 'firstTurn'].includes(this.userState) && this.turnKey === storyId
      log.info("turn.skippedByHost", { story: storyId, onScreen })
      if (!onScreen) return
      this.emitSnack("The host skipped your turn.", "info")
      this.getNextTurn()
    },
    setRemoved() {
      if (this.userState === "removed") return
      log.warn("player.removed", { story: this.turnKey })
      this.curPrompt = null
      this.userState = "removed"
    },
    getReviewPath() {
      let curPath = window.location.href
      let parts = curPath?.split("/")
      if (parts?.at(-1) == "draw") {
        return parts.slice(0, -1).join("/") + "/review"
      }
      return ""
    },
    emitSnack(msg, color) {
      if (color == "error") log.warn("snack", { msg })
      this.$emit("snack", msg, color)
    },
    async isValidGame() {
      let validGame = await pbService.games.checkGameStatus(this.$route.params.gameCode)
      if (validGame.errMsg) {
        this.$emit("snack", validGame.errMsg, "error")
        return false
      } else if (!validGame.gameId) {
        this.$emit("snack", "Invalid Game Code. Please try again.", "error")
        return false
      } else if (!validGame.isStarted) {
        this.$emit("snack", "Sorry, this game has not been started yet.", "error")
        this.$router.push({ name: "WaitingRoom", params: { gameCode: this.$route.params.gameCode } });
        return false
      }
      this.duration = validGame.duration
      return validGame.gameId
    },
    async onLoginClicked() {
      // Latch synchronously before the first await (see `loggingIn`) so a
      // duplicate call returns here instead of racing a second sign-in.
      if (this.loggingIn) {
        return
      }
      this.loggingIn = true
      try {
        let validation = await this.$refs.username.validate()
        if (!validation.valid) {
          return
        }

        // Check user is in game
        let resp = await pbService.users.getUsers(this.$route.params.gameCode)
        if (resp.errMsg) {
          this.$emit("snack", resp.errMsg, "error")
          return;
        }
        if (!resp.data) {
          return;
        }

        let user = resp.data.find(o => o.username == validation.username)
        if (!user) {
          this.$emit("snack", "Not an active user in this game.", "error")
          return
        }
        // Signing in here always takes over an existing seat, so make sure it's theirs.
        if (!(await this.$refs.rejoin.ask(user))) {
          return
        }

        this.userStore.user = user
        this.showLoginDialog = false
        await this.startPlaying()
      } finally {
        this.loggingIn = false
      }
    },
    // Where we stand, from the server: `finished` once we've taken a turn on
    // every story (and every active player has one), `dropped` if the host
    // removed us. Computed server-side because dropped players change both the
    // number of stories and who takes turns on them (see gamePlayers in host.go).
    async checkStatus() {
      const resp = await pbService.games.getPlayers(this.gameId)
      if (resp.errMsg) {
        this.emitSnack(resp.errMsg, "error")
        return {}
      }
      return resp.data.find(p => p.id === this.userStore.userId) || {}
    },
    getTurns() {
      // The subscription and the polling fallback can both fire while a
      // previous pass is still awaiting its reads. Serialize the whole state
      // machine: late callers join the pass already in flight instead of
      // interleaving with it — two concurrent passes could each assign
      // curPrompt/userState after their awaits and the slower one would swap
      // the active story out from under the user mid-turn.
      if (!this.turnsInFlight) {
        this.turnsInFlight = this.resolveTurns().finally(() => {
          this.turnsInFlight = null
        })
      }
      return this.turnsInFlight
    },
    async resolveTurns() {
      // The game-wide `turns` subscription calls this on every turn any player
      // submits. If we're already showing a turn, don't re-fetch and re-pop
      // curPrompt out from under the user — that would swap the active story and
      // saveResponse would write their drawing/prompt to the wrong story_id.
      if (['playing', 'firstTurn'].includes(this.userState) && this.curPrompt) {
        return
      }
      // Determine which turn the user is on.
      // 1. Resolve our own story exactly once and cache it, so a later failed
      //    read can't bounce the player back to the first-turn screen mid-game.
      if (!this.ownStory) {
        let userStory = await pbService.progress.getStory(this.userStore.userId, this.gameId)
        if (userStory.errMsg && !userStory.notFound) {
          // Transient failure (network blip, 5xx) — NOT "no story yet".
          // Creating a story here would mint a duplicate; leave state alone
          // and let the poll re-enter this pass.
          console.warn("getStory failed, will retry", userStory.errMsg)
          return
        }
        if (userStory.errMsg) {
          // Genuinely no story yet (404 past the retries) — our first turn.
          // Create it and only reveal the prompt UI once curPrompt is
          // populated, so an early submit can't reference a missing story.
          let created = await pbService.progress.createStory(this.userStore.userId, this.gameId)
          if (created.errCode === "player_removed") {
            this.setRemoved()
            return
          }
          if (created.errMsg) {
            // userState stays "loading"; the poll retries that state, so a
            // transient create failure at the start burst self-heals instead
            // of dead-ending until a manual refresh.
            this.$emit("snack", created.errMsg, "error")
            return
          }
          this.ownStory = created
          this.curPrompt = created
          this.userState = "firstTurn"
          return
        }
        this.ownStory = userStory
      }

      // 1.5 Did we actually take the first turn on our own story? Latch this once
      // taken, so a later failed read (after we've already submitted) can't
      // drop us back onto the first-turn prompt and duplicate the turn.
      if (!this.firstTurnTaken) {
        let turn = await pbService.progress.getTurn(this.userStore.userId, this.ownStory.id)
        if (turn.errMsg && !turn.notFound) {
          // Transient failure — re-showing the first-turn UI on it would
          // invite a duplicate submission. Let the poll retry instead.
          console.warn("getTurn failed, will retry", turn.errMsg)
          return
        }
        if (turn.errMsg) {
          this.curPrompt = this.ownStory
          this.userState = "firstTurn"
          return
        }
        this.firstTurnTaken = true
      }

      // 2. Our story is underway — see what prompts are waiting on us.
      // Awaited so the in-flight promise in getTurns() covers the whole pass.
      await this.queryMorePrompts()
    },
    async queryMorePrompts() {
      // 3. Check if the user has done a turn on every story
      const me = await this.checkStatus()
      if (me.dropped) {
        this.setRemoved()
        return
      }
      if (me.finished) {
        this.userState = "finished"
        this.$router.push({ name: "Review", params: { gameCode: this.$route.params.gameCode } });
        return
      }

      let next = await pbService.progress.getNextPerUser(this.userStore.userId)
      if (next.errMsg) {
        this.emitSnack(next.errMsg, "error")
        next = []
      }
      const stale = next.filter(p => this.submittedStories.has(p.story_id))
      if (stale.length) {
        log.warn("progress.staleStory", { stories: stale.map(p => p.story_id) })
      }
      this.nextPrompts = next.filter(p => !this.submittedStories.has(p.story_id))
      log.info("progress.next", {
        queued: this.nextPrompts.map(p => ({ story: p.story_id, taken: p.turns_taken })),
      })
      // 4. No prompts means their waiting for the player before them to finish
      if (!this.nextPrompts.length) {
        this.userState = "waiting"
        this.$nextTick(() => {
          this.$refs.waiting?.getProgress()
        })
        // 5. They have prompts, so they're still playing
      } else {
        this.showTurn(this.nextPrompts.pop())
      }
    },
    // The single place a queued story becomes the active turn. Everything that
    // depends on the story (draw vs. guess, the drawing to guess from) is
    // derived from curPrompt here or in computeds, so it can never lag behind.
    showTurn(prompt) {
      this.curPrompt = prompt
      this.userState = "playing"
      log.info("turn.show", {
        story: prompt.story_id,
        taken: prompt.turns_taken,
        isDraw: this.isDraw,
        prevTurn: prompt.prev_turn_id,
      })
      if (!this.isDraw) {
        this.getDrawing(prompt)
      }
    },
    getNextTurn() {
      if (this.nextPrompts.length) {
        this.showTurn(this.nextPrompts.pop())
      } else {
        // Nothing queued: re-check through the serialized pass. Leave the turn
        // screen first, so it never renders without a story.
        this.curPrompt = null
        this.userState = "waiting"
        this.getTurns()
      }
    },
    async getDrawing(prompt) {
      const record = await pb.collection('turns').getOne(prompt.prev_turn_id);
      let drawing_url = await pb.files.getUrl(record, prompt.prev_drawing)
      // The turn UI is re-created per story (see turnKey), so wait for it, and
      // drop the result if the player has already moved on to another story.
      await this.$nextTick()
      if (this.curPrompt !== prompt) return
      this.$refs.prompt?.setDrawing(drawing_url)
    },
    // timedOut: the round timer ran out and this is the player's partial work.
    // Shown as such in the review only.
    async saveResponse(data, { timedOut = false } = {}) {
      // One submit per turn: a double-click or the timer firing alongside a
      // manual submit must not write two turns.
      if (this.submitting) {
        log.warn("turn.submit.ignored", { story: this.turnKey, reason: "in flight" })
        return
      }
      let isDrawing = typeof data == "object"
      let wasFirstTurn = this.userState == "firstTurn"
      let storyId = this.turnKey

      if (isDrawing != this.isDraw && !wasFirstTurn) {
        log.warn("turn.submit.typeMismatch", { story: storyId, isDraw: this.isDraw, isDrawing })
      }
      log.info("turn.submit", {
        story: storyId,
        taken: this.curPrompt.turns_taken,
        isDrawing,
        timedOut,
        drawing: isDrawing ? data : undefined,
        prompt: isDrawing ? undefined : data,
      })
      // Create a new entry with the single photo
      let formData = new FormData();
      formData.append("user_id", this.userStore.userId);
      formData.append("story_id", storyId);
      formData.append("game_id", this.gameId);
      formData.append("drawing", isDrawing ? data : "");
      formData.append("prompt", isDrawing ? "" : data);
      formData.append("is_drawing", isDrawing);
      formData.append("timed_out", timedOut);
      const resp = await this.writeTurn(storyId, wasFirstTurn, () => pbService.progress.createTurn(formData))
      if (!resp) {
        // Refused and still on this turn, but its time ran out meanwhile.
        if (this.expiredStory === storyId && this.turnKey === storyId) {
          this.expiredStory = ""
          this.onTimerFinished()
        }
        return
      }
      log.info("turn.submit.ok", { story: storyId, turn: resp.id })
      this.turnWritten(storyId, wasFirstTurn)
    },
    // The round timer ran out. Submit whatever the player has so far, flagged
    // as timed out. With nothing at all, the server skips the turn instead,
    // passing the previous word or drawing on (or picking an opening word).
    async onTimerFinished() {
      if (this.submitting) {
        // They hit Submit just in time. Remember time's up in case that
        // submit is refused: see saveResponse.
        this.expiredStory = this.turnKey
        return
      }
      let partial
      if (this.isDraw) {
        partial = await this.$refs.draw?.getDrawing()
      } else {
        partial = this.$refs.prompt?.prompt?.trim()
      }
      log.info("timer.finished", { story: this.turnKey, isDraw: this.isDraw, partial: Boolean(partial) })
      if (partial) {
        await this.saveResponse(partial, { timedOut: true })
        return
      }

      let wasFirstTurn = this.userState == "firstTurn"
      let storyId = this.turnKey
      const resp = await this.writeTurn(storyId, wasFirstTurn,
        () => pbService.progress.timeoutTurn(storyId, this.userStore.userId))
      if (!resp) return
      this.emitSnack("Time's up!", "info")
      this.turnWritten(storyId, wasFirstTurn)
    },
    // Sends one write of our turn on storyId (a submit or a timeout), holding
    // the one-at-a-time lock. Returns the response, or null if it was refused.
    async writeTurn(storyId, wasFirstTurn, send) {
      this.submitting = true
      let resp
      try {
        resp = await send()
      } finally {
        this.submitting = false
      }
      return this.refused(resp, storyId, wasFirstTurn) ? null : resp
    },
    // Handles the server refusing our turn on storyId (codes from host.go).
    // True if refused. A refusal that means this turn is over moves on, so an
    // out-of-date screen never strands the player.
    refused(resp, storyId, wasFirstTurn) {
      if (!resp.errMsg) return false
      switch (resp.errCode) {
        case "turn_skipped":
          this.onTurnSkipped(storyId)
          break
        case "player_removed":
          this.setRemoved()
          break
        case "turn_taken":
          // Already written: from another tab, or by a retry of this request
          // whose first response got lost. Either way, it's done.
          log.warn("turn.submit.alreadyTaken", { story: storyId })
          this.turnWritten(storyId, wasFirstTurn)
          break
        case "not_your_turn":
          // This screen is out of date; go find what's really waiting on us.
          log.warn("turn.submit.notYourTurn", { story: storyId })
          this.getNextTurn()
          break
        default:
          log.error("turn.submit.failed", { story: storyId, err: resp.errMsg })
          this.$emit("snack", resp.errMsg, "error")
      }
      return true
    },
    // Our turn on storyId is saved (by us, or by the server on timeout): move on.
    turnWritten(storyId, wasFirstTurn) {
      this.submittedStories.add(storyId)
      if (wasFirstTurn) {
        this.firstTurnTaken = true
      }
      this.getNextTurn()
    },
  },
};
</script>
