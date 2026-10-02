<!-- ConfirmRejoin asks whether a name that's already in the game is really the
     person typing it. Rejoining under an existing name takes over that player's
     seat and turns, which is exactly right for someone switching browsers or
     recovering from a crash, and exactly wrong for someone who happened to pick
     the same name. Usage: `if (await this.$refs.rejoin.ask(user)) { ... }` -->
<template>
  <v-dialog v-model="visible" max-width="440" persistent>
    <v-card class="pa-4 bg-white" max-width="100%">
      <v-card-title class="text-center text-h5 wrap">
        "{{ user?.username }}" is already in this game
      </v-card-title>
      <div class="d-flex justify-center align-center ma-2">
        <AvatarIcon :user="user" />
        <span class="text-h5 hand">{{ user?.username }}</span>
      </div>
      <v-card-text class="text-center">
        Is this you? Rejoin if you've switched devices or browsers, or lost your
        connection. You'll pick up where you left off. If it's someone else,
        pick a different name.
      </v-card-text>
      <v-card-actions class="justify-center flex-wrap ga-2">
        <v-btn size="large" variant="tonal" @click="answer(false)">
          Pick another name
        </v-btn>
        <v-btn size="large" color="primary" variant="elevated" @click="answer(true)">
          That's me, rejoin
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script>
import { log } from '@/services/log'

export default {
  name: "ConfirmRejoin",
  data() {
    return {
      visible: false,
      user: null,
      resolve: null,
    }
  },
  methods: {
    // Resolves true to rejoin as `user`, false to choose another name.
    ask(user) {
      this.resolve?.(false) // a second ask supersedes an unanswered one
      this.user = user
      this.visible = true
      return new Promise((resolve) => {
        this.resolve = resolve
      })
    },
    answer(rejoin) {
      log.info("rejoin.answer", { rejoin, username: this.user?.username, userId: this.user?.id })
      this.visible = false
      this.resolve?.(rejoin)
      this.resolve = null
    },
  },
}
</script>
<style scoped>
.wrap {
  white-space: break-spaces;
  word-break: break-word;
}
</style>
