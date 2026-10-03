<template>
  <!-- Cut out of the player's color, with a scrap of its complement behind
       (see services/avatarPaper) -->
  <span class="avatar-paper">
    <svg class="avatar-scrap" :style="scrapStyle" viewBox="-1 -1 2 2" aria-hidden="true">
      <path :d="paper.scrap.path" :fill="scrapFill" />
    </svg>
    <div v-if="avatar" class="avatar-circle avatar-cut" v-html="avatar"
      :style="{ width: `${size}px`, height: `${size}px`, 'background-color': color, 'border-radius': paper.cut }">
    </div>
    <v-avatar v-else class="avatar-cut" :color="color" :size="size" :style="{ 'border-radius': paper.cut }">
      <span v-if="letters" class="avatar-initials" :style="{ 'font-size': `${fontSize}px` }">{{ letters }}</span>
      <v-icon v-else icon="mdi-account" :size="size * 0.6" />
    </v-avatar>
  </span>
</template>
<script>
import { initials } from '@/services/player'
import { avatarPaper, scrapColor } from '@/services/avatarPaper'

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
    // Two letters get smaller type so wide pairs like "MW" stay inside; one
    // letter fills the space. (The handwriting runs small for its size.)
    fontSize() {
      return Math.round(this.size * (this.letters.length > 1 ? 0.46 : 0.8))
    },
    // Before there's a name, the color stands in for it
    paper() {
      return avatarPaper(this.name || this.color)
    },
    scrapFill() {
      return scrapColor(this.color)
    },
    scrapStyle() {
      const { x, y, size, turn } = this.paper.scrap
      return {
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${size * 100}%`,
        height: `${size * 100}%`,
        transform: `rotate(${turn}deg)`,
      }
    },
  },
}
</script>
<style>
/* Handwritten, like the names. Patrick Hand has one weight, so a thin
   outline of its own color thickens the strokes. */
.avatar-initials {
  font-family: var(--hand);
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
  -webkit-text-stroke: 0.04em currentColor;
}

.avatar-circle {
  display: flex;
  justify-content: center;
  align-items: center;
}

/* Its own layer, so the scrap goes behind the avatar but no further */
.avatar-paper {
  position: relative;
  isolation: isolate;
  display: inline-flex;
  flex: none;
}

.avatar-scrap {
  position: absolute;
  z-index: -1;
  overflow: visible;
}

.avatar-paper .avatar-cut {
  box-shadow: 0 0 0 2px var(--ink);
}
</style>
