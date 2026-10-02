<template>
  <v-card class="overflow-y-auto pb-16 align-content-space-evenly" height="100vh" width="100vw" color="transparent"
    flat style="justify-items: center; display: grid;">
    <v-img class="my-4 home-logo" min-width="150" min-height="150" src="@/assets/logo.svg" />

    <div class="text-center">
      <div class="hand home-welcome">Welcome to</div>

      <h1 class="text-h2"><span class="highlight">Telestrations!</span></h1>
    </div>

    <v-card class="pa-4 ma-4 sketch-card" height="176px" width="900" max-width="calc(100vw - 32px)" :class="$vuetify.display.smAndDown ? 'safe-bottom': ''">
      <v-row class="justify-center align-center">
        <v-dialog max-width="500">
          <template v-slot:activator="{ props: activatorProps }">
            <v-btn v-bind="activatorProps" class="ma-4" size="x-large" color="primary">
              New Game
            </v-btn>
          </template>
          <template v-slot:default>
            <v-card class="pa-4 bg-white" width="500" max-width="100%">
              <v-card-title class="text-center text-h4">Let's Get Started!</v-card-title>
              <v-form ref="form" @submit.prevent="onBeginClicked">
                <SetUsername ref="username" @username="onBeginClicked" />
                <GameSettings v-model="settings" @submit="onBeginClicked" />
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
            <v-btn v-bind="activatorProps" class="ma-4" size="x-large" color="secondary">
              Join Game
            </v-btn>
          </template>
          <template v-slot:default>
            <v-card class="pa-4 bg-white" width="500" max-width="100%">
              <v-card-title class="text-center text-h4 wrap">Enter a Game Code</v-card-title>
              <v-form ref="form" @submit.prevent="onJoinClicked">
                <v-row class="pa-2">
                  <v-text-field v-model="gameCode" label="Game Code" @input="gameCode = gameCode.toLowerCase()"
                    @keyup.enter="onJoinClicked" :rules="[v => !!v?.trim() || 'Game Code cannot be empty!']" />
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
    <ConfirmRejoin ref="rejoin" />
  </v-card>
</template>
<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pbService } from '@/services/pocketbase'
import { defaultSettings, gameFields } from '@/services/settings'
export default {
  name: 'InfoSnackbar',
  data() {
    return {
      settings: defaultSettings(),
      gameCode: "",
      // One Enter runs either dialog's handler several times: SetUsername emits
      // @username on keydown and keyup, and its submit bubbles to the dialog's
      // own @submit form (see SetUsername's onSubmit). The other fields call the
      // handler from their own @keyup.enter too. This latches on the first
      // in-flight submit so the duplicates no-op instead of racing two creates for
      // the same player (and, for New Game, two games). See WaitingRoom for the
      // same guard.
      submitting: false,
    }
  },
  computed: {
    ...mapStores(useUserStore),
  },
  methods: {
    async onJoinClicked() {
      // Latch synchronously before the first await so a duplicate call (see
      // `submitting`) returns here instead of starting a second join.
      if (this.submitting) {
        return
      }
      this.submitting = true
      try {
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
        }

        let user = await pbService.users.getUser(validation.username, validGame.gameId)
        if (Object.prototype.hasOwnProperty.call(user, "id")) {
          // Name taken: rejoin only if they confirm it's them; otherwise leave the
          // join dialog open to pick another name.
          if (!(await this.$refs.rejoin.ask(user))) {
            return
          }
          this.userStore.user = user
          this.$emit("snack", `Welcome back, ${user.username}!`, "success")
          if (validGame.isStarted) {
            await this.$router.push({ name: "TakeTurn", params: { gameCode: this.gameCode } });
          } else {
            await this.$router.push({ path: this.gameCode });
          }
        } else if (validGame.isStarted) {
          this.$emit("snack", "Sorry, this game has already been started.", "error")
          return
        } else {
          let resp = await this.userStore.newUser(validation.username, validation.avatar, validation.color, validGame.gameId, false)
          if (resp.errMsg) {
            this.$emit("snack", resp.errMsg, "error")
            return
          }
          await this.$router.push({ path: this.gameCode });
        }
      } finally {
        // The pushes above are awaited so the latch holds until HomeScreen is
        // gone: navigation waits on a network check (router.beforeEach), and a
        // keyup landing in that window would otherwise re-enter and find the
        // player this call just created.
        this.submitting = false
      }
    },
    async onBeginClicked() {
      // Latch synchronously (see `submitting`) so a duplicate Enter can't create
      // a second game.
      if (this.submitting) {
        return
      }
      this.submitting = true
      try {
        let validation = await this.$refs.form.validate()
        if (!validation.valid) {
          return
        }
        validation = await this.$refs.username.validate()
        if (!validation.valid) {
          return
        }

        const { roundDuration, rounds, endless } = gameFields(this.settings)
        let resp = await this.userStore.newGame(validation.username, validation.avatar, validation.color,
          roundDuration, { rounds, endless })
        if (resp.errMsg) {
          this.$emit("snack", resp.errMsg, "error")
          return
        }

        await this.$router.push({ path: resp.gameCode })
      } finally {
        this.submitting = false
      }
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

.safe-bottom {
  margin-bottom: 64px;
}

.home-logo {
  transform: rotate(-4deg);
}

.home-welcome {
  font-size: 1.6rem;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-background), var(--v-medium-emphasis-opacity));
  transform: rotate(-3deg);
}

/* A highlighter swipe behind the name */
.highlight {
  padding: 0 0.12em;
  background: linear-gradient(transparent 56%, rgb(var(--v-theme-secondary)) 56%,
    rgb(var(--v-theme-secondary)) 92%, transparent 92%);
}
</style>
