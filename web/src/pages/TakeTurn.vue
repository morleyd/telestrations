// firstTurn finished waiting playing browsing
<template>
  <AppBar>
    <NotebookMenu v-if="userState == 'playing' && !leaving" :notebooks="notebooks" :disabled="writing.has(turnKey)"
      @pick="pickTurn" @browse="browse" />
    <v-btn v-else-if="userState == 'browsing' && !leaving" class="me-2" prepend-icon="mdi-arrow-left" variant="flat"
      color="secondary" @click="backToTurn">
      <span class="d-none d-sm-inline">Back to my turn</span>
      <span class="d-sm-none">My turn</span>
    </v-btn>
  </AppBar>
  <v-alert v-if="endsAt && (onTurn || userState == 'browsing')" class="end-banner" type="warning" density="compact"
    elevation="6">
    The host is ending the game! Finish your turn: <strong>{{ endLeft }}</strong>
  </v-alert>
  <div v-if="userState == 'waiting' || userState == 'browsing'" style="justify-self: center;">
    <WaitingScreen ref="waiting" :game-id="gameId" :current="openTurns.at(-1)?.story_id"
      :title="userState == 'browsing' ? 'Around the table' : undefined" />
  </div>
  <div v-else-if="userState == 'finished'" style="justify-self: center;">
    <span>Finished...</span>
    <span v-if="reviewPath">Review results at: <a :href="reviewPath">{{ reviewPath }}</a></span>
  </div>
  <div v-else-if="userState == 'removed'" class="pa-4 text-center" style="justify-self: center;">
    <v-card-title class="wrap">The host removed you from this game.</v-card-title>
    <span v-if="reviewPath">You can still see the results at: <a :href="reviewPath">{{ reviewPath }}</a></span>
  </div>
  <div v-else-if="userState == 'loading'" class="pa-4 text-center" style="justify-self: center;">
    <v-progress-circular indeterminate color="primary" />
    <div class="mt-2">Loading...</div>
  </div>
  <div v-else-if="!onTurn" style="justify-self: center;">
    <span>Error...</span>
  </div>
  <!-- The turn on screen. Each open turn has a component of its own (see
       paneFor), kept alive while the player looks at the table or another
       notebook, so its drawing, upload, typed word and timer are as they left
       them; it goes once the turn is written. A new turn gets fresh ones: an
       empty prompt box, a blank canvas and a restarted timer. -->
  <KeepAlive :include="openPanes">
    <component :is="paneFor(turnKey)" v-if="onTurn" :key="turnKey" :prompt="curPrompt" :duration="duration"
      @ready="keepPane" @submit="saveResponse" @timeout="onTimerFinished" @snack="emitSnack" />
  </KeepAlive>

  <ConfirmRejoin ref="rejoin" />

  <v-dialog v-model="showLoginDialog" max-width="500" persistent>
    <v-card class="pa-4 bg-white" width="500" max-width="100%">
      <v-card-title class="text-center text-h4">Enter Your Username</v-card-title>
      <SetUsername ref="username" :pick-avatar="false" @username="onLoginClicked" />
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
import { pb, pbService, endsAt, endCountdown } from '@/services/pocketbase'
import { log } from '@/services/log'
import { sameName } from '@/services/player'
import TurnPane from '@/components/TurnPane.vue'

// One turn: a story and a place in it. With rounds, a story comes back to the
// same player at a later place.
const turnKeyOf = (storyId, index) => `${storyId}:${index ?? 0}`
// A turn as TakeTurn has it: a progress row, or for a first turn the story
// itself, at place 0. Its key, and whether it's a drawing (after a word) or a
// word (after a drawing, or the opening one).
const keyOf = (p) => turnKeyOf(p.story_id || p.id, p.turns_taken)
const isDrawOf = (p) => Boolean(p?.prev_prompt)
const isFirstOf = (p) => !p.story_id
// KeepAlive keeps components by name (see paneFor)
const paneName = (key) => `TurnPane-${key}`

const POLL_MS = 2500
const DROPPED_CHECK_TICKS = 4 // ~10s
const END_CHECK_TICKS = 2 // ~5s, the realtime game update's fallback
export default {
  name: "TakeTurn",
  data() {
    return {
      // "loading" until the first pass decides which turn we're on. Kept apart
      // from the Error screen (any unknown state): every player passes through
      // here when the host starts, and showing "Error..." while the first
      // turn loaded looked like the start had failed.
      userState: "loading",
      // The turns waiting on us that we haven't opened, ordered so the next
      // one to give us is last (see queryMorePrompts).
      nextPrompts: [],
      // The turns we've opened and not yet written, the one on screen (or
      // last on screen) last. Each keeps its work until it's written, timer
      // running, while we look at another or at the table.
      openTurns: [],
      // The turn on screen, one of openTurns; null off the turn screens.
      curPrompt: null,
      // The players, by id, for whose notebook is whose
      players: new Map(),
      showLoginDialog: false,
      // One Enter in the login dialog runs onLoginClicked twice (see
      // SetUsername's onSubmit). Latch on the first in-flight call so the
      // duplicate no-ops. Kept apart from `writing`, the turn-write locks, so
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
      // The turns (by turnKey) with a write in flight: one write per turn at
      // a time, so a double-click or the timer firing alongside a submit
      // can't write a turn twice. A timer running out on a turn set aside
      // may write it while we're on another.
      writing: new Set(),
      // The turns whose round timer ran out while a submit was in flight, so
      // a refused submit can still time out (the timer only fires once).
      expiredTurns: new Set(),
      // Turns we've already written, by turnKey. A lagging progress read must
      // never hand one of these back to us, or we'd write it twice. (With
      // rounds a story does come back to us, but at a later place.)
      submittedTurns: new Set(),
      // The host's End Game: when it runs out (a Date), and the seconds this
      // page's countdown has left. null while the game is on.
      endsAt: null,
      endLeft: 0,
      endTimer: null,
      // On our way to the review: nothing else may start a turn or navigate.
      leaving: false,
    }
  },
  computed: {
    ...mapStores(useUserStore),
    // The turn on screen: its story, and its place in the story (a first
    // turn's curPrompt is the story itself, at place 0).
    storyId() {
      return this.curPrompt?.story_id || this.curPrompt?.id || ""
    },
    turnIndex() {
      return this.curPrompt?.turns_taken ?? 0
    },
    turnKey() {
      return this.storyId && turnKeyOf(this.storyId, this.turnIndex)
    },
    onTurn() {
      return ['playing', 'firstTurn'].includes(this.userState)
    },
    // A turn after a word is a drawing; a turn after a drawing (prev_prompt
    // empty) is a guess. A first turn's curPrompt is the story itself, which
    // has no prev_prompt: a word.
    isDraw() {
      return isDrawOf(this.curPrompt)
    },
    // The open turns' components: KeepAlive keeps these and lets go of the
    // rest (see paneFor).
    openPanes() {
      return this.openTurns.map((p) => paneName(keyOf(p)))
    },
    // The notebooks waiting on us, for the menu: the open ones, last on screen
    // first, then the rest in the order we'd get them. While the host ends the
    // game nothing new starts, so only the open ones.
    notebooks() {
      const queued = this.endsAt ? [] : [...this.nextPrompts].reverse()
      return [...this.openTurns].reverse().concat(queued).map((p, i) => ({
        key: keyOf(p),
        name: this.whose(p, { start: true }),
        isDraw: isDrawOf(p),
        started: i < this.openTurns.length,
        current: this.onTurn && keyOf(p) === this.turnKey,
      }))
    },
  },
  watch: {
    userState(to, from) {
      log.info("state", { from, to, story: this.turnKey, isDraw: this.isDraw })
    },
  },
  created() {
    // Not reactive. Each open turn's component, by turnKey, so its work can be
    // read while it's set aside (see partialOf); and the component type each
    // turn is shown with (see paneFor).
    this.panes = new Map()
    this.paneTypes = new Map()
    // The queue last logged (see queryMorePrompts)
    this.loggedQueue = null
  },
  async mounted() {
    this.reviewPath = this.getReviewPath()
    // Check if game code is valid and game is active
    this.gameId = await this.isValidGame()
    if (!this.gameId) {
      if (!this.leaving) this.setScreen(null, "error")
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
    pb.collection('games').unsubscribe();
    clearInterval(this.pollTimer);
    this.pollTimer = null
    clearInterval(this.endTimer)
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
          that.onTurnSkipped(r.story_id, r.turn_index)
          return
        }
        that.getTurns()
      }, { filter: `game_id="${that.gameId}"` })
      // The host's End Game arrives as an update to the game.
      pb.collection('games').subscribe(that.gameId, function (e) {
        // Just set, so the full countdown is left, whatever this device's
        // clock says about the deadline.
        const at = endsAt(e.record)
        if (at) that.startEnding(at, endCountdown(e.record), { justSet: true })
      })

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
      // The table, while the player looks at it between turns, is refreshed
      // the same way.
      //
      // Every DROPPED_CHECK_TICKS polls it also checks whether the host dropped
      // us: a player idling on a turn screen gets no event for that. And it
      // refreshes the notebooks waiting on them, for the menu.
      //
      // Every END_CHECK_TICKS it also checks whether the host is ending the
      // game, in case the realtime update didn't arrive.
      let ticks = 0
      this.pollTimer = setInterval(async function () {
        ticks++
        if (!that.endsAt && ticks % END_CHECK_TICKS == 0) {
          const game = await pbService.games.checkGameStatus(that.$route.params.gameCode)
          if (game.endsAt) that.startEnding(game.endsAt, game.endCountdown)
        }
        if (["waiting", "loading", "browsing"].includes(that.userState)) {
          that.getTurns()
        } else if (ticks % DROPPED_CHECK_TICKS == 0 && that.onTurn) {
          that.getTurns()
          if ((await pbService.users.getUserById(that.userStore.userId)).dropped) that.setRemoved()
        }
      }, POLL_MS)
    },
    // The host skipped a turn we owed (at index in storyId), maybe the one on
    // screen or one set aside. Never write that turn, and move on if it's the
    // one we're on.
    onTurnSkipped(storyId, index) {
      const key = turnKeyOf(storyId, index)
      this.submittedTurns.add(key)
      if (storyId === this.ownStory?.id && index == 0) this.firstTurnTaken = true
      this.nextPrompts = this.nextPrompts.filter(p => keyOf(p) !== key)
      const open = this.openTurns.find(p => keyOf(p) === key)
      const onScreen = this.closeTurn(key)
      log.info("turn.skippedByHost", { story: storyId, index, onScreen, open: Boolean(open) })
      if (onScreen) {
        this.emitSnack("The host skipped your turn.", "info")
        this.getNextTurn()
        return
      }
      if (open) this.emitSnack(`The host skipped your turn on ${this.whose(open)}.`, "info")
      // The table and the menu show it gone
      if (!this.onTurn) this.getTurns()
    },
    setRemoved() {
      if (this.userState === "removed") return
      log.warn("player.removed", { story: this.turnKey })
      this.setScreen(null, "removed")
    },
    // The one place the turn on screen changes: to prompt, an open turn (state
    // "playing" or "firstTurn", see showTurn), or off the turn screens (prompt
    // null) to the table, the waiting screen or the like. Whatever wants to
    // know what the player has in front of them hooks in here.
    setScreen(prompt, state) {
      this.curPrompt = prompt
      this.userState = state
    },
    // Whose notebook a turn is in, for the menu and messages (start: to start
    // a sentence with)
    whose(p, { start = false } = {}) {
      const starter = p.starter_user_id || p.starter_id
      const mine = starter === this.userStore.userId
      const name = this.players.get(starter)?.username
      if (!mine && name) return `${name}'s notebook`
      const who = mine ? "your notebook" : "someone's notebook"
      return start ? who[0].toUpperCase() + who.slice(1) : who
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
        this.leaving = true
        this.$router.push({ name: "WaitingRoom", params: { gameCode: this.$route.params.gameCode } });
        return false
      } else if (validGame.endsAt) {
        // Ended (or ending): no new turns, so straight to the review.
        this.goToReview("This game is over.")
        return false
      }
      this.duration = validGame.duration
      return validGame.gameId
    },
    // The host ended the game. Whoever has a turn open (on screen, or set
    // aside while they look at the table or another notebook) gets the rest of
    // the server's `countdown` (seconds, see endCountdown) to finish, and then
    // each open turn is submitted as it stands; everyone else goes to the
    // review now.
    // Nobody starts another turn (see resolveTurns, showTurn). `justSet` (the
    // realtime update) leaves the whole countdown. Otherwise (found by the
    // poll, maybe late) what's left is estimated from the deadline by this
    // device's clock, never more than the countdown: the server takes turns
    // for a few seconds past it.
    startEnding(at, countdown, { justSet = false } = {}) {
      if (this.endsAt || this.leaving) return
      this.endsAt = at
      log.info("game.ending", {
        endsAt: at.toISOString(), state: this.userState, story: this.turnKey, countdown, justSet,
      })
      if (!this.openTurns.length) {
        this.goToReview("The host ended the game.")
        return
      }
      const byClock = Math.max(0, Math.round((at - Date.now()) / 1000))
      this.endLeft = countdown == null ? byClock : justSet ? countdown : Math.min(countdown, byClock)
      if (this.endLeft <= 0) {
        this.onEndTimerFinished()
        return
      }
      this.endTimer = setInterval(() => {
        if (--this.endLeft > 0) return
        clearInterval(this.endTimer)
        this.endTimer = null
        this.onEndTimerFinished()
      }, 1000)
    },
    // End Game's countdown ran out: submit what the player has in each open
    // turn (timed out, as the round timer does) and go to the review. With
    // nothing, write nothing: the story just ends a turn earlier. A submit
    // already in flight lands on its own.
    async onEndTimerFinished() {
      if (this.leaving) return
      // All read before any is sent: the first to land may move us on.
      const open = this.openTurns.filter(p => !this.writing.has(keyOf(p)))
      const partials = await Promise.all(open.map(p => this.partialOf(p)))
      if (this.leaving) return
      log.info("end.timer.finished", {
        turns: open.map(p => ({ story: keyOf(p), isDraw: isDrawOf(p) })), partial: partials.map(Boolean),
      })
      await Promise.all(open.map((p, i) => partials[i] && this.saveResponse(p, partials[i], { timedOut: true })))
      this.goToReview("Time's up! The game is over.")
    },
    goToReview(msg) {
      if (this.leaving) return
      this.leaving = true
      clearInterval(this.endTimer)
      if (msg) this.emitSnack(msg, "info")
      this.setScreen(null, "finished")
      this.$router.push({ name: "Review", params: { gameCode: this.$route.params.gameCode } });
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

        let user = resp.data.find(o => sameName(o.username, validation.username))
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
    // Also keeps the players' names, for whose notebook is whose.
    async checkStatus() {
      const resp = await pbService.games.getPlayers(this.gameId)
      if (resp.errMsg) {
        this.emitSnack(resp.errMsg, "error")
        return {}
      }
      this.players = new Map(resp.data.map(p => [p.id, p]))
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
      // submits. During End Game nothing new starts: whoever has a turn open
      // has the countdown to finish it (others finishing theirs mustn't cut it
      // short), and everyone else goes to the review. Once the time's up, End
      // Game's timer moves us on (onEndTimerFinished).
      if (this.endsAt) {
        if (!this.openTurns.length && this.endLeft > 0) this.goToReview()
        return
      }
      // The opening word comes before anything else: nothing to refresh.
      if (this.userState === "firstTurn") {
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
          if (created.errCode === "game_over") {
            this.goToReview("This game is over.")
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
          this.showTurn(created)
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
          this.showTurn(this.ownStory)
          return
        }
        this.firstTurnTaken = true
      }

      // 2. Our story is underway — see what prompts are waiting on us.
      // Awaited so the in-flight promise in getTurns() covers the whole pass.
      await this.queryMorePrompts()
    },
    async queryMorePrompts() {
      // 3. Check if the user has done a turn on every story. Not needed on a
      // turn: with one open we aren't finished, and the poll checks for a drop.
      if (!this.onTurn) {
        const me = await this.checkStatus()
        if (me.dropped) {
          this.setRemoved()
          return
        }
        if (me.finished && !this.openTurns.length) {
          this.goToReview()
          return
        }
      }

      let next = await pbService.progress.getNextPerUser(this.userStore.userId)
      if (next.errMsg) {
        this.emitSnack(next.errMsg, "error")
        next = []
      }
      const done = p => this.submittedTurns.has(keyOf(p))
      const stale = next.filter(done)
      if (stale.length) {
        log.warn("progress.staleStory", { turns: stale.map(keyOf) })
      }
      // Taken from the end: the story that has been round the fewest times
      // first, then by id. The waiting table orders a player's pile the same
      // way under the one they're on (see seatPlayers), so the next one it
      // shows is the next one they get. The open ones are kept as they are.
      this.nextPrompts = next.filter(p => !done(p) && !this.isOpen(keyOf(p)))
        .sort((a, b) => b.turns_taken - a.turns_taken || (a.story_id < b.story_id ? 1 : -1))
      // Logged when it changes: on a turn this runs on every turn anyone takes
      const queued = this.nextPrompts.map(keyOf).join()
      if (queued !== this.loggedQueue) {
        this.loggedQueue = queued
        log.info("progress.next", {
          queued: this.nextPrompts.map(p => ({ story: p.story_id, taken: p.turns_taken })),
          open: this.openTurns.map(keyOf),
        })
      }
      // On a turn, that's all: the turn on screen never changes under the
      // player (saveResponse would write it to the wrong story). They move on
      // by submitting it, or picking another from the menu. Looking at the
      // table with notebooks to go back to, they stay there.
      if (this.onTurn) {
        return
      }
      if (this.userState === "browsing" && (this.openTurns.length || this.nextPrompts.length)) {
        this.$refs.waiting?.getProgress()
        return
      }
      // 4. No prompts means their waiting for the player before them to finish
      if (!this.nextPrompts.length) {
        this.setScreen(null, "waiting")
        this.$nextTick(() => {
          this.$refs.waiting?.getProgress()
        })
        // 5. They have prompts, so they're still playing
      } else {
        this.showTurn(this.nextPrompts.at(-1))
      }
    },
    isOpen(key) {
      return this.openTurns.some(p => keyOf(p) === key)
    },
    // Opens a turn (a first turn, or one waiting on us), or goes back to one
    // already open, and puts it on screen. Everything that depends on the
    // story (draw vs. guess, the drawing to guess from) is derived from the
    // turn itself, in TurnPane or computeds, so it can never lag behind.
    showTurn(prompt) {
      const key = keyOf(prompt)
      const open = this.openTurns.find(p => keyOf(p) === key)
      if (this.endsAt && !open) {
        // Nothing new starts once the host is ending the game
        if (!this.openTurns.length) this.goToReview()
        return
      }
      const turn = open || prompt
      // Last in openTurns: the one to come back to
      this.openTurns = [...this.openTurns.filter(p => p !== turn), turn]
      this.nextPrompts = this.nextPrompts.filter(p => keyOf(p) !== key)
      this.setScreen(turn, isFirstOf(turn) ? "firstTurn" : "playing")
      log.info("turn.show", {
        story: key,
        taken: turn.turns_taken,
        isDraw: this.isDraw,
        prevTurn: turn.prev_turn_id,
        resumed: Boolean(open),
      })
    },
    // The player picked a notebook from the menu: an open turn to go back to,
    // or a new one to start. Not while the one on screen is being written.
    pickTurn(key) {
      if (this.writing.has(this.turnKey)) return
      const turn = this.openTurns.find(p => keyOf(p) === key) || this.nextPrompts.find(p => keyOf(p) === key)
      if (!turn) return
      log.info("turn.pick", { story: key, from: this.turnKey || this.userState })
      this.showTurn(turn)
    },
    // The player went to look at the table, leaving the turn on screen open.
    browse() {
      if (!this.onTurn || this.writing.has(this.turnKey)) return
      log.info("table.open", { from: this.turnKey })
      this.setScreen(null, "browsing")
      this.getTurns()
    },
    // Back from the table to the turn set aside there, as it was left. If
    // that's gone meanwhile (timed out, or skipped), the next one, as after a
    // submit. (With nothing at all left, the table has become the waiting
    // screen: see queryMorePrompts.)
    backToTurn() {
      const turn = this.openTurns.at(-1) || (!this.endsAt && this.nextPrompts.at(-1))
      if (!turn) return
      log.info("table.back", { story: keyOf(turn) })
      this.showTurn(turn)
    },
    // The turn on screen is over (written, skipped, or out of date): on to the
    // next. The open ones first, the one last on screen first (their timers
    // are running), then the one TakeTurn picks.
    getNextTurn() {
      if (this.endsAt) {
        // Only back to an open one while there's time. Once it's up, End
        // Game's timer submits the rest and moves us on (onEndTimerFinished).
        const open = this.endLeft > 0 && this.openTurns.at(-1)
        if (open) this.showTurn(open)
        else if (this.endLeft > 0) this.goToReview()
        return
      }
      const next = this.openTurns.at(-1) || this.nextPrompts.at(-1)
      if (next) {
        this.showTurn(next)
      } else {
        // Nothing queued: re-check through the serialized pass. Leave the turn
        // screen first, so it never renders without a story.
        this.setScreen(null, "waiting")
        this.getTurns()
      }
    },
    // The component each turn is shown with: its own, named for it, so
    // KeepAlive keeps it while the turn is open and lets it go once it's
    // closed (see openPanes). KeepAlive only tells components apart by name.
    paneFor(key) {
      if (!this.paneTypes.has(key)) this.paneTypes.set(key, { ...TurnPane, name: paneName(key) })
      return this.paneTypes.get(key)
    },
    keepPane(pane) {
      this.panes.set(keyOf(pane.prompt), pane)
    },
    // What the player has so far in an open turn, on screen or not
    partialOf(prompt) {
      return this.panes.get(keyOf(prompt))?.partial()
    },
    // An open turn is over: let go of it and its work. True if it was the one
    // on screen, which is left there for the caller to move on from.
    closeTurn(key) {
      this.openTurns = this.openTurns.filter(p => keyOf(p) !== key)
      this.panes.delete(key)
      this.expiredTurns.delete(key)
      return this.onTurn && this.turnKey === key
    },
    // prompt submits data (a drawing or a word) for its turn, on screen or not
    // (End Game's timer and the round timer write ones set aside). timedOut:
    // the round timer ran out and this is the player's partial work. Shown as
    // such in the review only.
    async saveResponse(prompt, data, { timedOut = false } = {}) {
      const key = keyOf(prompt)
      // One submit per turn: a double-click or the timer firing alongside a
      // manual submit must not write two turns.
      if (this.writing.has(key)) {
        log.warn("turn.submit.ignored", { story: key, reason: "in flight" })
        return
      }
      if (!this.isOpen(key)) {
        log.warn("turn.submit.ignored", { story: key, reason: "not open" })
        return
      }
      let isDrawing = typeof data == "object"
      let wasFirstTurn = isFirstOf(prompt)
      let storyId = prompt.story_id || prompt.id
      let index = prompt.turns_taken ?? 0

      if (isDrawing != isDrawOf(prompt) && !wasFirstTurn) {
        log.warn("turn.submit.typeMismatch", { story: storyId, isDraw: isDrawOf(prompt), isDrawing })
      }
      log.info("turn.submit", {
        story: storyId,
        taken: prompt.turns_taken,
        isDrawing,
        timedOut,
        onScreen: key === this.turnKey,
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
      // Which turn this is, so a page showing one we already took is refused.
      formData.append("turn_index", index);
      const resp = await this.writeTurn(prompt, () => pbService.progress.createTurn(formData))
      if (!resp) {
        // Refused and still open, but its time ran out meanwhile.
        if (this.expiredTurns.delete(key) && this.isOpen(key)) this.onTimerFinished(prompt)
        return
      }
      log.info("turn.submit.ok", { story: storyId, index, turn: resp.id })
      this.turnWritten(prompt)
    },
    // A turn's round timer ran out, on screen or set aside. Submit whatever
    // the player has so far, flagged as timed out. With nothing at all, the
    // server skips the turn instead, passing the previous word or drawing on
    // (or picking an opening word).
    async onTimerFinished(prompt) {
      const key = keyOf(prompt)
      if (this.writing.has(key)) {
        // They hit Submit just in time. Remember time's up in case that
        // submit is refused: see saveResponse.
        this.expiredTurns.add(key)
        return
      }
      if (!this.isOpen(key)) return
      const partial = await this.partialOf(prompt)
      if (this.leaving || !this.isOpen(key)) return
      const onScreen = this.onTurn && key === this.turnKey
      log.info("timer.finished", { story: key, isDraw: isDrawOf(prompt), partial: Boolean(partial), onScreen })
      // Set aside, it goes without the player seeing it: say so.
      if (!onScreen) this.emitSnack(`Time's up on ${this.whose(prompt)}.`, "info")
      if (partial) {
        await this.saveResponse(prompt, partial, { timedOut: true })
        return
      }

      const storyId = prompt.story_id || prompt.id
      const index = prompt.turns_taken ?? 0
      const resp = await this.writeTurn(prompt,
        () => pbService.progress.timeoutTurn(storyId, this.userStore.userId, index))
      if (!resp) return
      if (onScreen) this.emitSnack("Time's up!", "info")
      this.turnWritten(prompt)
    },
    // Sends one write of prompt's turn (a submit or a timeout), holding that
    // turn's lock. Returns the response, or null if it was refused.
    async writeTurn(prompt, send) {
      const key = keyOf(prompt)
      this.writing.add(key)
      let resp
      try {
        resp = await send()
      } finally {
        this.writing.delete(key)
      }
      return this.refused(resp, prompt) ? null : resp
    },
    // Handles the server refusing prompt's turn (codes from host.go). True if
    // refused. A refusal that means this turn is over moves on, so an
    // out-of-date screen never strands the player.
    refused(resp, prompt) {
      if (!resp.errMsg) return false
      const storyId = prompt.story_id || prompt.id
      const index = prompt.turns_taken ?? 0
      switch (resp.errCode) {
        case "turn_skipped":
          this.onTurnSkipped(storyId, index)
          break
        case "game_over":
          this.goToReview("The game is over.")
          break
        case "player_removed":
          this.setRemoved()
          break
        case "turn_taken":
          // Already written: from another tab, or by a retry of this request
          // whose first response got lost. Either way, it's done.
          log.warn("turn.submit.alreadyTaken", { story: storyId, index })
          this.turnWritten(prompt)
          break
        case "unsupported_picture":
          // The upload checks a picture's type before sending it, so only one
          // the server reads differently gets here. Stay on it to pick another.
          this.$emit("snack", "That kind of picture can't be used here. Try a JPEG or PNG.", "error")
          if (this.endsAt && this.endLeft <= 0) this.goToReview()
          break
        case "not_your_turn":
          // This turn is out of date; go find what's really waiting on us.
          log.warn("turn.submit.notYourTurn", { story: storyId })
          if (this.closeTurn(keyOf(prompt))) this.getNextTurn()
          else if (!this.onTurn) this.getTurns()
          break
        default:
          log.error("turn.submit.failed", { story: storyId, err: resp.errMsg })
          this.$emit("snack", resp.errMsg, "error")
          // If End Game's countdown has run out, this turn won't get another go.
          if (this.endsAt && this.endLeft <= 0) this.goToReview()
      }
      return true
    },
    // prompt's turn is saved (by us, or by the server on timeout): let go of
    // it, and move on if it was on screen.
    turnWritten(prompt) {
      const key = keyOf(prompt)
      this.submittedTurns.add(key)
      if (isFirstOf(prompt)) {
        this.firstTurnTaken = true
      }
      if (this.closeTurn(key)) this.getNextTurn()
      // At the table: it shows the notebook moving on, and with nothing left
      // to go back to, the waiting screen
      else if (!this.onTurn) this.getTurns()
    },
  },
};
</script>
<style scoped>
.end-banner {
  position: fixed;
  top: 56px;
  left: 0;
  right: 0;
  margin: 0 auto;
  width: fit-content;
  max-width: calc(100vw - 32px);
  z-index: 2;
}
</style>
