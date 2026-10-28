<template>
  <v-card class="text-center overflow-y-auto pa-4" style="height: calc(100vh - 28px); min-height: 300px;"
    color="transparent" flat>
    <v-card-title v-if="isFirst">
      Enter your starting prompt:
    </v-card-title>
    <div v-else class="mb-4 d-flex" style="height: 248px;">
      <v-img :src="drawing || sadCow" width="100%" style="justify-self: center;" />
    </div>
    <v-textarea v-model="prompt" class="prompt-field" bg-color="white" label="Your Prompt Here..." hide-details />
    <v-btn class="ma-4" color="primary" variant="elevated" size="x-large" @click="onSaveClicked">
      Submit
    </v-btn>
  </v-card>
</template>
<script>
import sadCow from "@/assets/sad_cow_icon.svg"

// A word turn: the opening word, or a guess at `drawing` (its address)
export default {
  props: ["isFirst", "drawing"],
  data() {
    return {
      prompt: "",
      sadCow,
    }
  },
  methods: {
    onSaveClicked() {
      const prompt = this.prompt.trim()
      if (!prompt) {
        this.$emit("snack", "You must enter a prompt!", "error")
        return
      }
      this.$emit("prompt", prompt)
    },
  }
}
</script>
<style>
/* What a player writes looks written */
.prompt-field textarea {
  font-family: var(--hand);
  font-size: 1.6rem;
  line-height: 1.3;
}
</style>
