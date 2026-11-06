// Copyright (2025- ) David C. Morley

// The AppBar provides a simple toolbar at the top of a given page
<template>
  <v-app-bar color="primary" flat density="compact" class="app-bar">
    <!-- The name alone, until the game has a logo -->
    <div class="app-bar-brand d-flex align-center cursor-pointer ps-4" @click="$router.push({ name: 'Home' })">
      <v-toolbar-title class="app-bar-title">Doodle Drift</v-toolbar-title>
    </div>
    <v-spacer />
    <!-- What a page adds for its own controls (TakeTurn: the notebooks) -->
    <slot />
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
  computed: {
    ...mapStores(useUserStore),
  },
};
</script>
<style scoped>
.app-bar-brand {
  width: 200px;
}

/* On a phone, the name smaller, to leave room for a page's own controls */
@media (max-width: 599px) {
  .app-bar-brand {
    width: auto;
  }

  .app-bar-title {
    font-size: 1rem !important;
  }
}

/* The ink rule under the bar: a shadow, so the bar stays 48px tall */
.app-bar {
  box-shadow: 0 3px 0 var(--ink);
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
