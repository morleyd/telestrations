// firstTurn finished waiting playing
<template>
  <AppBar />
  <div v-if="userState == 'waiting'" style="justify-self: center;">
    <WaitingScreen ref="waiting" />
    <!-- <span>Waiting...</span> -->
  </div>
  <div v-else-if="userState == 'finished'" style="justify-self: center;">
    <span>Finished...</span>
  </div>
  <div v-else-if="['firstTurn', 'playing'].includes(userState)">
    <DrawingTurn v-if="isDraw" :prompt="curPrompt.prev_prompt" @snack="emitSnack" @drawing="saveResponse" />
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
    }
  },
  computed: {
    ...mapStores(useUserStore),
  },
  async mounted() {
    // Check if game code is valid and game is active
    this.gameId = await this.isValidGame()
    if (!this.gameId) {
      return
    }

    if (!this.userStore.username || !this.gameId) {
      this.showLoginDialog = true
      return
    }

    await this.getTurns()

    let that = this
    pb.collection('turns').subscribe('*', async function (e) {
      console.log("turns subscription event", e)
      that.getTurns()
    }, { filter: `game_id="${that.gameId}"` })
  },
  unmounted() {
    pb.collection('turns').unsubscribe();
  },
  methods: {
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

      let users = resp.data
      if (!users.filter(o => o.username == validation.username).length) {
        this.$emit("snack", "Not an active user in this game.", "error")
        return
      }

      this.userStore.user = await pbService.users.getUser(validation.username, this.gameId)
      this.showLoginDialog = false
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
      return numTurns.data >= numUsers.data
    },
    async getTurns() {
      // Determing which turn the user is on. 
      // 1. Check if they've started their own story, if not it's their first turn
      let userStory = await pbService.progress.getStory(this.userStore.userId, this.gameId)
      if (userStory.errMsg) {
        this.userState = "firstTurn"
        this.isDraw = false
        this.curPrompt = await pbService.progress.createStory(this.userStore.userId, this.gameId)
        if (this.curPrompt.errMsg) {
          this.$emit("snack", this.curPrompt.errMsg, "error")
        }
        return
      } else if (userStory.hasOwnProperty("id")) {
        // 1.5 Check that they actually took a turn with this story they started
        let turn = await pbService.progress.getTurn(this.userStore.userId, userStory.id)
        if (turn.errMsg) {
          console.warn("Missing first turn", turn.errMsg)
          this.userState = "firstTurn"
          this.isDraw = false
          this.curPrompt = userStory
          return
        }

        // 2. If they've started a story, now check what prompts are in their queue
        this.queryMorePrompts()
        return
      }
      console.error("It shouldn't be possible to get here?")
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
      console.log("saveResponse", {
        user_id: this.userStore.userId,
        story_id: this.curPrompt.story_id,
        drawing: this.isDraw ? data : "",
        prompt: this.isDraw ? "" : data,
        is_drawing: this.isDraw,
      })
      // Create a new entry with the single photo
      let formData = new FormData();
      formData.append("user_id", this.userStore.userId);
      formData.append("story_id", this.curPrompt.story_id || this.curPrompt.id);
      formData.append("game_id", this.gameId);
      formData.append("drawing", this.isDraw ? data : "");
      formData.append("prompt", this.isDraw ? "" : data);
      formData.append("is_drawing", this.isDraw);
      let resp = await pbService.progress.createTurn(formData)
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
        return
      }

      this.getNextTurn()
    },
  },
};
</script>
