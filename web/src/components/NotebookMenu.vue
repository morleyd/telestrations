<template>
  <!-- The notebooks waiting on the player, from the app bar of the turn
       screen: pick one to do it now, or go and look at the table. -->
  <v-menu location="bottom end">
    <template #activator="{ props }">
      <v-btn v-bind="props" class="notebook-menu" prepend-icon="mdi-notebook-multiple" append-icon="mdi-menu-down"
        :disabled="disabled" aria-label="Your notebooks" title="Your notebooks">
        <span class="d-none d-sm-inline me-2">Notebooks</span>
        <span class="notebook-count">{{ notebooks.length }}</span>
      </v-btn>
    </template>
    <v-list class="notebook-list" density="compact">
      <v-list-subheader>Your notebooks</v-list-subheader>
      <v-list-item v-for="n in notebooks" :key="n.key" :data-notebook="n.name" :active="n.current"
        :prepend-icon="n.isDraw ? 'mdi-pencil' : 'mdi-fountain-pen-tip'" :title="n.name" :subtitle="subtitle(n)"
        @click="n.current || $emit('pick', n.key)" />
      <v-divider class="my-1" />
      <v-list-item prepend-icon="mdi-table-furniture" title="Look at the table" @click="$emit('browse')" />
    </v-list>
  </v-menu>
</template>
<script>
// notebooks: { key, name ("Sam's notebook"), isDraw, started, current }, in
// the order to offer them.
export default {
  props: {
    notebooks: { type: Array, required: true },
    disabled: { type: Boolean, default: false },
  },
  emits: ["pick", "browse"],
  methods: {
    subtitle(n) {
      const what = n.isDraw ? "Draw" : "Guess"
      if (n.current) return `${what} · on screen`
      return n.started ? `${what} · started` : what
    },
  },
}
</script>
<style scoped>
.notebook-count {
  min-width: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface));
  color: var(--ink);
  font-weight: 800;
}

.notebook-list {
  min-width: 240px;
}
</style>
