<template>
  <v-card class="overflow-y-auto pb-16 align-content-space-evenly" height="100vh" width="100vw" color="transparent"
    flat style="justify-items: center; display: grid;">
    <v-img class="my-4 home-logo" min-width="150" min-height="150" src="@/assets/logo.svg" />

    <div class="text-center">
      <div class="hand home-welcome">Welcome to</div>

      <h1 class="text-h2"><span class="highlight">Telestrations!</span></h1>
    </div>

    <v-card class="pa-4 ma-4 sketch-card" height="176px" width="900" max-width="calc(100vw - 32px)">
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
                  <v-text-field v-model="gameCode" label="Game Code" @input="gameCode = gameCode.trim().toLowerCase()"
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
import { oneAtATime } from '@/services/oneAtATime'
export default {
  data() {
    return {
      settings: defaultSettings(),
      gameCode: "",
    }
  },
  computed: {
    ...mapStores(useUserStore),
  },
  methods: {
    // The navigation is awaited, so a duplicate call does nothing until this
    // page is gone: navigation waits on a network check (router.beforeEach),
    // and a keyup in that window would find the player this call created.
    onJoinClicked: oneAtATime(async function () {
      let validation = await this.$refs.form.validate()
      if (!validation.valid) {
        return
      }
      validation = await this.$refs.username.validate()
      if (!validation.valid) {
        return
      }

      const { data: game, errMsg, notFound } = await pbService.games.checkGameStatus(this.gameCode)
      if (errMsg) {
        this.$emit("snack", notFound ? "Invalid Game Code. Try again or create a new game." : errMsg, "error")
        return
      }

      // A failed read isn't a free name: joining on it would seat them twice.
      const found = await pbService.users.getUser(validation.username, game.gameId)
      if (found.errMsg) {
        this.$emit("snack", found.errMsg, "error")
        return
      }
      const user = found.data
      if (user) {
        // Name taken: rejoin only if they confirm it's them; otherwise leave the
        // join dialog open to pick another name.
        if (!(await this.$refs.rejoin.ask(user))) {
          return
        }
        this.userStore.user = user
        this.$emit("snack", `Welcome back, ${user.username}!`, "success")
        if (game.isStarted) {
          await this.$router.push({ name: "TakeTurn", params: { gameCode: this.gameCode } });
        } else {
          await this.$router.push({ path: this.gameCode });
        }
      } else if (game.isStarted) {
        this.$emit("snack", "Sorry, this game has already been started.", "error")
      } else {
        let resp = await this.userStore.newUser(validation.username, validation.avatar, validation.color, game.gameId, false)
        if (resp.errMsg) {
          this.$emit("snack", resp.errMsg, "error")
          return
        }
        await this.$router.push({ path: this.gameCode });
      }
    }),
    onBeginClicked: oneAtATime(async function () {
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
    }),
  },
}
</script>
<style scoped>
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
