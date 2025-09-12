// Copyright (2025- ) David C. Morley

// The AppBar provides a simple toolbar the the top of a given page
<template>
  <v-app-bar app clipped-left color="primary" dark density="compact">
    <div class="d-flex cursor-pointer" style="width: 180px;" @click="$router.push({ name: 'Home' })">
      <v-img class="mx-2" max-height="40" max-width="40" src="@/assets/logo.svg" />
      <v-toolbar-title class="text-left align-content-center">Telestrations</v-toolbar-title>
    </div>
    <v-spacer />
    <span class="me-4 font-weight-bold">{{ userStore.username }}</span>
    <AvatarIcon :user="userStore.user" />
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
