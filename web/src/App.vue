<template>
  <v-app>
    <v-main>
      <router-view :key="$route.path" @snack="updateSnackbar" />
      <InfoSnackbar ref="info" />
    </v-main>
  </v-app>
</template>
<script>
export default {
  name: 'App',
  methods: {
    /**
     * Helper function to send a message to the InfoSnackbar.
     *
     * @param {string} text - The message to be displayed to the user.
     * @param {string} color - The type/color of the message (e.g., 'error', 'blue', etc).
     */
    updateSnackbar(text, color) {
      this.$refs.info.show(text, color)
    },
  }
}
</script>
<style>
/* This overrides the default fullpage scrollbar */
:root {
  overflow-y: hidden;
}
</style>
