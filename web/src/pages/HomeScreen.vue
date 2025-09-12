<template>
  <v-card class="overflow-y-auto pa-0 align-content-space-evenly" height="100vh" width="100vw" color="background"
    style="justify-items: center; display: grid;">
    <v-img class="my-4" min-width="150" min-height="150" src="@/assets/logo.svg" />

    <div class="text-center">
      <div class="text-body-2 font-weight-light mb-n1">Welcome to</div>

      <h1 class="text-h2 font-weight-bold">Telestrations!</h1>
    </div>

    <v-card class="pa-4 ma-4" height="176px" width="900" max-width="calc(100vw - 32px)">
      <v-row class="justify-center align-center">
        <v-dialog max-width="500">
          <template v-slot:activator="{ props: activatorProps }">
            <v-btn v-bind="activatorProps" class="ma-4" size="x-large" color="primary">
              New Game
            </v-btn>
          </template>
          <template v-slot:default="{ isActive }">
            <v-card class="pa-4 bg-white" width="500" max-width="100%">
              <v-card-title class="text-center text-h4">Let's Get Started!</v-card-title>
              <v-form ref="form" @submit.prevent="onBeginClicked">
                <SetUsername ref="username" @username="onBeginClicked" />
                <!-- TODO: Allow users to set round time limits
                  <v-row class="pa-2" style="justify-content: center;">
                    <v-switch v-model="setTimer" color="primary" label="Set Timed Rounds" hide-details />
                  </v-row>
                  <v-row v-if="setTimer" class="pa-2">
                    <v-text-field v-model="timeValue" :rules="[timeValueRule]" label="Time" class="me-2" />
                    <v-select v-model="timeUnit" label="Unit" :rules="[timeUnitRule]" @keyup.enter="onBeginClicked"
                      :items="['Seconds', 'Minutes', 'Hours']" />
                  </v-row> -->
                <v-row class="pa-2" style="justify-content: center;">
                  <v-btn size="x-large" color="primary" elevation="2" @click="onBeginClicked">Begin!</v-btn>
                </v-row>
              </v-form>
            </v-card>
          </template>
        </v-dialog>
      </v-row>
      <v-row class="justify-center align-center">
        <v-dialog max-width="500">
          <template v-slot:activator="{ props: activatorProps }">
            <v-btn v-bind="activatorProps" class="ma-4" size="x-large" color="tertiary" variant="tonal">
              Join Game
            </v-btn>
          </template>
          <template v-slot:default="{ isActive }">
            <v-card class="pa-4 bg-white" width="500" max-width="100%">
              <v-card-title class="text-center text-h4 wrap">Enter a Game Code</v-card-title>
              <v-form ref="form" @submit.prevent="onJoinClicked">
                <v-row class="pa-2">
                  <v-text-field v-model="gameCode" label="Game Code" @input="gameCode = gameCode.toLowerCase()"
                    @keyup.enter="onJoinClicked" :rules="[v => v && v.trim || 'Game Code cannot be empty!']" />
                </v-row>
                <SetUsername ref="username" @username="onJoinClicked" />
                <v-row class="pa-2" style="justify-content: center;">
                  <v-btn size="x-large" color="primary" elevation="2" @click="onJoinClicked">
                    Join!
                  </v-btn>
                </v-row>
              </v-form>
            </v-card>
          </template>
        </v-dialog>
      </v-row>
    </v-card>
  </v-card>
</template>
<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pbService } from '@/services/pocketbase'
export default {
  name: 'InfoSnackbar',
  data() {
    return {
      timeValue: 0,
      timeUnit: "",
      setTimer: false,
      gameCode: "",
    }
  },
  computed: {
    ...mapStores(useUserStore),
  },
  methods: {
    async onJoinClicked() {
      let validation = await this.$refs.form.validate()
      if (!validation.valid) {
        return
      }
      validation = await this.$refs.username.validate()
      if (!validation.valid) {
        return
      }

      let validGame = await pbService.games.checkGameStatus(this.gameCode)
      if (validGame.errMsg) {
        this.$emit("snack", validGame.errMsg, "error")
        return
      } else if (!validGame.gameId) {
        this.$emit("snack", "Invalid Game Code. Try again or create a new game.", "error")
        return
      } else if (validGame.isStarted) {
        this.$emit("snack", "Sorry, this game has already been started.", "error")
        return
      }

      let user = await pbService.users.getUser(validation.username, validGame.gameId)
      if (user.hasOwnProperty("id")) {
        this.userStore.user = user
        this.$emit("snack", "Username already exists. Assuming it's yours.", "warning")
      } else {
        let resp = await this.userStore.newUser(validation.username, validation.avatar, validation.color, validGame.gameId, false)
        if (resp.errMsg) {
          this.$emit("snack", error, "error")
          return
        }
      }
      this.$router.push({ path: this.gameCode });
    },
    async onBeginClicked() {
      let validation = await this.$refs.form.validate()
      if (!validation.valid) {
        return
      }
      validation = await this.$refs.username.validate()
      if (!validation.valid) {
        return
      }

      let time = this.setTimer ? this.computeTimeSeconds() : 0

      let resp = await this.userStore.newGame(validation.username, validation.avatar, validation.color, time)
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
        return
      }

      await this.$router.push({ path: resp.gameCode })
    },
    computeTimeSeconds() {
      switch (this.timeUnit) {
        case 'Seconds':
          return this.timeValue;
        case 'Minutes':
          return this.timeValue * 60;
        case 'Hours':
          return this.timeValue * 3600;
        default:
          return 0;
      }
    },
    timeValueRule() {
      if (this.setTimer) {
        if (this.timeValue <= 0) {
          return 'Invalid Time!'
        }
      }
      return true
    },
    timeUnitRule() {
      if (this.setTimer) {
        if (this.timeValue > 0 && this.timeUnit == "") {
          return 'Time Unit Must Be Set!'
        }
      }
      return true
    },
  },
}
</script>
<style scoped>
.wrap {
  text-align: center;
  white-space: break-spaces;
  word-break: break-word;
  word-wrap: break-word;
}
</style>
