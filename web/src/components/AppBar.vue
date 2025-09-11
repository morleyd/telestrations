<template>
  <v-app-bar app clipped-left color="primary" dark density="compact">
    <v-img class="ms-4" max-height="40" max-width="40" src="@/assets/logo.svg" />
    <v-toolbar-title class="text-left">Telestrations</v-toolbar-title>
    <v-spacer />
    <v-btn icon="mdi-home" :to="{ name: 'Home' }" />
    
  </v-app-bar>
</template>

<script>
export default {
  name: "AppBar",
};
</script>
