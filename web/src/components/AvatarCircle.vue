<template>
  <div v-if="avatar" class="avatar-circle" v-html="avatar" :style="{ width: `${size}px`, height: `${size}px`, 'background-color': color }">
  </div>
  <v-avatar v-else :color="color" :size="size">
    <span v-if="letters" class="avatar-initials" :style="{ 'font-size': `${fontSize}px` }">{{ letters }}</span>
    <v-icon v-else icon="mdi-account" :size="size * 0.6" />
  </v-avatar>
</template>
<script>
import { initials } from '@/services/player'

// A player's avatar: the face they picked, or else their initials.
export default {
  name: 'AvatarCircle',
  props: {
    avatar: { type: String, default: "" },
    color: { type: String, default: "" },
    name: { type: String, default: "" },
    size: { type: Number, default: 36 },
  },
  computed: {
    letters() {
      return initials(this.name)
    },
    // Two letters get smaller type so wide pairs like "MW" stay inside.
    fontSize() {
      return Math.round(this.size * (this.letters.length > 1 ? 0.4 : 0.6))
    },
  },
}
</script>
<style>
.avatar-initials {
  font-family: Georgia, serif;
  font-weight: bold;
  line-height: 1;
  white-space: nowrap;
}

.avatar-circle {
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
