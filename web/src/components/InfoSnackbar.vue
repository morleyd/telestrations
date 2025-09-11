// Copyright (2024) Cobalt Speech and Language Inc.

// InfoSnackbar displays a temporary "snackbar" to display messages to the user

<template>
  <v-snackbar v-model="visible" timer :text="text" :color="color" :timeout="timeout">
    <template v-slot:actions>
      <v-btn variant="text" @click="hide">
        Close
      </v-btn>
    </template>
  </v-snackbar>
</template>
<script>
export default {
  name: 'InfoSnackbar',
  data() {
    return {
      visible: false,
      text: "",
      color: "",
      timeout: 7500 // 7.5 seconds
    }
  },
  methods: {
    /**
     * Displays the a snackbar of information to the user
     *
     * @param {string} text - The text to display to the user
     * @param {string} color - The color of the snackbar
     */
    show(text, color = "primary") {
      // don't display snackbar if no text or from a pocketbase abort message
      if (!text || JSON.stringify(text).includes("signal is aborted without reason")) return
      console.log("InfoSnackbar", text)
      this.visible = true
      this.text = text
      this.color = color
    },

    /**
     * Hides the Info Snacbar and resets the text/color
     */
    hide() {
      this.visible = false
      this.text = ""
      this.color = ""
    },
  },
}
</script>
