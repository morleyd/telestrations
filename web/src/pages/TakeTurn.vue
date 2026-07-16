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
  <div v-else-if="['firstTurn', 'playing'].includes(userState)">
    <CountdownTimer :duration="duration" @finished="onTimerFinished" />

    <DrawingTurn v-if="isDraw" ref="draw" :prompt="curPrompt.prev_prompt" @snack="emitSnack" @drawing="saveResponse" />
    <PromptTurn v-else ref="prompt" :isFirst="userState == 'firstTurn'" :drawing="prevDrawing" @snack="emitSnack"
      @prompt="saveResponse" />
  </div>
  <div v-else style="justify-self: center;">
    <span>Error...</span>
  </div>

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
export default {
  name: "TakeTurn",
  data() {
    return {
      userState: "",
      isDraw: true,
      nextPrompts: [],
      curPrompt: null,
      showLoginDialog: false,
      username: "",
      gameId: "",
      duration: -1,
      reviewPath: "",
      pollTimer: null,
      ownStory: null,
      turnsInFlight: null,
      tornDown: false,
      firstTurnTaken: false,
      totalPlayers: 0,
    }
  },
  computed: {
    ...mapStores(useUserStore),
  },
  async mounted() {
    this.reviewPath = this.getReviewPath()
    // Check if game code is valid and game is active
    this.gameId = await this.isValidGame()
    if (!this.gameId) {
      return
    }

    if (!this.userStore.username) {
      this.showLoginDialog = true
      return
    }

    this.startTurnSync()
    await this.getTurns()
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
    // Arm the two things that re-check turn state: the realtime `turns`
    // subscription and a polling fallback. Called from mounted() for returning
    // players and from onLoginClicked() for players who land via the login
    // dialog — that path previously got neither, so after their first turn
    // nothing ever re-checked and they (and everyone waiting on them) stalled.
    startTurnSync() {
      // The component can unmount while mounted()'s awaits are still in flight;
      // if cleanup already ran (or the timer is somehow armed), don't register
      // a subscription and interval nothing will ever tear down.
      if (this.tornDown || this.pollTimer) {
        return
      }
      let that = this
      pb.collection('turns').subscribe('*', async function (e) {
        console.log("turns subscription event", e)
        that.getTurns()
      }, { filter: `game_id="${that.gameId}"` })

      // Polling fallback. Advancing a turn is driven by the realtime
      // subscription above, but a wake-up event can arrive while we're
      // mid-transition into "waiting" and be dropped, leaving the player
      // stranded even though their next prompt is already available — and once
      // everyone ahead of them has finished, no further turn events fire to
      // re-trigger it. Re-checking on a timer makes progress self-heal. The ""
      // state (the Error screen, e.g. a createStory attempt that failed at the
      // start burst) is retried too — at game start no turn events exist yet,
      // so without the poll that screen was a dead end until manual refresh.
      this.pollTimer = setInterval(function () {
        if (that.userState === "waiting" || that.userState === "") that.getTurns()
      }, 2500)
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

      let users = resp.data
      if (!users.filter(o => o.username == validation.username).length) {
        this.$emit("snack", "Not an active user in this game.", "error")
        return
      }

      this.userStore.user = await pbService.users.getUser(validation.username, this.gameId)
      this.showLoginDialog = false
      this.startTurnSync()
      await this.getTurns()
    },
    async checkNumTurns() {
      const numTurns = await pbService.progress.getUserTurnCount(this.userStore.userId)
      if (numTurns.errMsg) {
        this.$emit("snack", numTurns.errMsg, "error")
      }
      const numUsers = await pbService.users.getTotalUsers(this.gameId)
      if (numUsers.errMsg) {
        this.$emit("snack", numUsers.errMsg, "error")
      }
      // The roster is frozen once the game starts (users can't be added or removed
      // mid-game — see the roster-lock rule in the migration), so the real player
      // count can only ever be *under*-reported by a stale read during the busy
      // start. Track the max we've seen; using a momentarily-low count here would
      // declare the game finished early and truncate everyone's story.
      this.totalPlayers = Math.max(this.totalPlayers, numUsers.data || 0)
      return this.totalPlayers > 0 && numTurns.data >= this.totalPlayers
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
          if (created.errMsg) {
            // userState stays "" (the Error screen); the poll retries that
            // state, so a transient create failure at the start burst
            // self-heals instead of dead-ending until a manual refresh.
            this.$emit("snack", created.errMsg, "error")
            return
          }
          this.ownStory = created
          this.curPrompt = created
          this.isDraw = false
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
          this.isDraw = false
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
      // 3. Check if the user has done a turn for each user
      let finishedAllStories = await this.checkNumTurns()
      if (finishedAllStories) {
        this.userState = "finished"
        this.$router.push({ name: "Review", params: { gameCode: this.$route.params.gameCode } });
        return
      }

      this.nextPrompts = await pbService.progress.getNextPerUser(this.userStore.userId)
      // 4. No prompts means their waiting for the player before them to finish
      if (!this.nextPrompts.length) {
        this.userState = "waiting"
        this.$nextTick(() => {
          this.$refs.waiting.getProgress()
        })
        // 5. They have prompts, so they're still playing
      } else {
        this.userState = "playing"
        this.curPrompt = this.nextPrompts.pop()
        this.isDraw = Boolean(this.curPrompt.prev_prompt)
        if (!this.isDraw) {
          this.getDrawing()
        }
      }
    },
    getNextTurn() {
      if (this.nextPrompts.length) {
        this.curPrompt = this.nextPrompts.pop()
      } else {
        this.userState = "waiting"
      }
    },
    async getDrawing() {
      const record = await pb.collection('turns').getOne(this.curPrompt.prev_turn_id);
      let drawing_url = await pb.files.getUrl(record, this.curPrompt.prev_drawing)
      this.$refs.prompt.setDrawing(drawing_url)
    },
    async saveResponse(data) {
      let isDrawing = typeof data == "object"
      let wasFirstTurn = this.userState == "firstTurn"

      console.log("saveResponse", {
        user_id: this.userStore.userId,
        story_id: this.curPrompt.story_id,
        drawing: isDrawing ? data : "",
        prompt: isDrawing ? "" : data,
        is_drawing: isDrawing,
      })
      // Create a new entry with the single photo
      let formData = new FormData();
      formData.append("user_id", this.userStore.userId);
      formData.append("story_id", this.curPrompt.story_id || this.curPrompt.id);
      formData.append("game_id", this.gameId);
      formData.append("drawing", isDrawing ? data : "");
      formData.append("prompt", isDrawing ? "" : data);
      formData.append("is_drawing", isDrawing);
      let resp = await pbService.progress.createTurn(formData)
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
        return
      }
      if (wasFirstTurn) {
        this.firstTurnTaken = true
      }

      this.getNextTurn()
    },
    async onTimerFinished() {
      let data
      if (this.isDraw) {
        data = await this.$refs.draw.getDrawing()
        if (!data) {
          data = this.curPrompt.prev_prompt
        }
      } else {
        if (this.$refs.prompt.prompt.trim() || this.userState == "firstTurn") {
          if (!this.$refs.prompt.prompt.trim()) {
            data = this.userStore.username
          } else {
            data = this.$refs.prompt.prompt
          }
        } else {
          data = this.$refs.prompt.prevDrawing
        }
      }

      this.saveResponse(data)
    },
  },
};
</script>
