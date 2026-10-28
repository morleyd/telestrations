<template>
  <button type="button" class="avatar-picker" aria-label="Choose your avatar" @click="show">
    <span class="avatar-picker-face">
      <AvatarCircle :avatar="avatar" :color="color" :name="username" :size="56" />
      <span class="avatar-picker-badge">
        <v-icon icon="mdi-pencil" size="14" />
      </span>
    </span>
    <span class="text-caption text-primary font-weight-medium">Pick avatar</span>
  </button>
  <v-dialog v-model="visible" max-width="500">
    <!-- A dialog card like the others: the faces scroll, Submit stays in view
         below them -->
    <v-card class="pa-4">
      <v-card-title class="text-center text-h5 pb-4">Pick your avatar</v-card-title>
      <v-item-group v-model="selectedIndex" class="avatar-options" mandatory>
        <v-item v-for="(choice, i) in CHOICES" :key="choice" v-slot="{ isSelected, toggle }">
          <v-card class="avatar-option" :class="{ 'avatar-option--selected': isSelected }" flat @click="toggle">
            <v-scroll-y-transition>
              <!-- The name too, so each face shows on this player's own scrap -->
              <AvatarCircle :id="'avatar' + (i + 1)" :avatar="choice" :color="color" :name="username" :size="72" />
            </v-scroll-y-transition>
          </v-card>
        </v-item>
      </v-item-group>
      <v-card-actions class="justify-center pt-4" :class="$vuetify.display.smAndDown ? 'safe-bottom': ''">
        <v-btn size="large" color="primary" variant="elevated" @click="onSubmit">
          Submit
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script>
import { FACES } from '@/services/faces'

// The letters first (""), then the faces
const CHOICES = ["", ...FACES.keys()]

export default {
  name: 'AvatarSelector',
  props: [
    "avatar",
    "color",
    "username",
  ],
  emits: ["submit"],
  setup() {
    return { CHOICES }
  },
  data() {
    return {
      selectedIndex: 0,
      visible: false,
    }
  },
  methods: {
    onSubmit() {
      // "" for the letters clears a face already saved, where undefined would
      // be left out of the update.
      this.$emit('submit', CHOICES[this.selectedIndex] ?? "")
      this.visible = false
    },
    show() {
      // Start on the avatar they have now. Not at mount: a name being edited
      // gets its avatar after this has mounted.
      this.selectedIndex = Math.max(0, CHOICES.indexOf(this.avatar))
      this.visible = true
    },
  },
}
</script>
<style>
.avatar-picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  padding: 2px 4px;
}

.avatar-picker:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}

.avatar-picker-face {
  position: relative;
  display: flex;
  transition: transform 0.2s;
}

/* Lifted, like a sticker about to be peeled off */
.avatar-picker:hover .avatar-picker-face {
  transform: rotate(-6deg) scale(1.06);
}

.avatar-picker-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 0 0 2px var(--ink);
}

/* Three faces a row on a phone, four on anything wider. Only the faces
   scroll, so Submit stays in view. */
.avatar-options {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  justify-items: center;
  gap: 6px 0;
  padding: 4px 6px 8px;
}

.avatar-option.v-card {
  width: 96px;
  height: 96px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 2.5px solid transparent;
  border-radius: var(--wobble-small);
}

/* The one picked, on a sticker of its own */
.avatar-option.v-card.avatar-option--selected {
  background: rgb(var(--v-theme-secondary-lighten-3));
  border-color: var(--ink);
  box-shadow: 3px 3px 0 var(--ink);
}

.safe-bottom {
  margin-bottom: 64px;
}
</style>
