// Copyright (2024) Cobalt Speech and Language Inc.

// PageNotFound provides default landing page if the user goes to an unsupported URL

<template>
  <AppBar />
  <v-card class="pa-10" style="text-align: center;" elevation="20">
    <v-card-title class="text-h2 ma-4">404 not found</v-card-title>
    <v-card-subtitle class="text-h6">The page you're looking for doesn't exist!</v-card-subtitle>
    <v-card-text class="text-body-1">Try checking the URL, navigating back, or return to the</v-card-text>
    <v-btn color="primary" variant="tonal" :to="{ name: 'Home' }">Home Page</v-btn>
  </v-card>
</template>

<script>
export default {
  name: "PageNotFound",
};
</script>
