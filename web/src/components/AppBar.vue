// Copyright (2025- ) David C. Morley

// The AppBar provides a simple toolbar the the top of a given page
<template>
  <v-app-bar app clipped-left color="primary" flat density="compact" class="app-bar">
    <div class="d-flex align-center cursor-pointer" style="width: 200px;" @click="$router.push({ name: 'Home' })">
      <span class="app-bar-logo mx-2">
        <v-img width="26" height="34" src="@/assets/logo.svg" />
      </span>
      <v-toolbar-title class="app-bar-title">Telestrations</v-toolbar-title>
    </div>
    <v-spacer />
    <span class="me-4 hand app-bar-name">{{ userStore.username }}</span>
    <AvatarIcon :user="userStore.user" />
    <ManagePlayers />
    <v-btn icon="mdi-home" :to="{ name: 'Home' }" />
  </v-app-bar>
</template>
<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
export default {
  name: "AppBar",
  computed: {
    ...mapStores(useUserStore),
  },
};
</script>
<style scoped>
/* The ink rule under the bar: a shadow, so the bar stays 48px tall */
.app-bar {
  box-shadow: 0 3px 0 rgb(var(--v-theme-on-surface));
}

/* The logo's navy needs a paper backing on the blue */
.app-bar-logo {
  flex: none;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-surface));
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgb(var(--v-theme-on-surface));
}

.app-bar-title {
  font-weight: 800;
  font-size: 1.25rem;
  letter-spacing: -0.01em;
}

.app-bar-name {
  font-size: 1.3rem;
}
</style>
