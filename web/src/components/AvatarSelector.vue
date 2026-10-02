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
        <v-item v-for="n in 16" :key="n" v-slot="{ isSelected, toggle }">
          <v-card class="avatar-option" :class="{ 'avatar-option--selected': isSelected }" flat @click="toggle">
            <v-scroll-y-transition>
              <AvatarCircle v-if="n == 1" id="avatar1" :color="color" :name="username" :size="72" />
              <!-- The name too, so each face shows on this player's own scrap -->
              <AvatarCircle v-else :id="'avatar' + n" :avatar="idxMap[n]" :color="color" :name="username"
                :size="72" />
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
import glee from '@/assets/avatars/glee.svg?raw'
import goofy from '@/assets/avatars/goofy.svg?raw'
import grin from '@/assets/avatars/grin.svg?raw'
import grumpy from '@/assets/avatars/grumpy.svg?raw'
import happy from '@/assets/avatars/happy.svg?raw'
import hey from '@/assets/avatars/hey.svg?raw'
import joy from '@/assets/avatars/joy.svg?raw'
import lick from '@/assets/avatars/lick.svg?raw'
import raspberry from '@/assets/avatars/raspberry.svg?raw'
import smile from '@/assets/avatars/smile.svg?raw'
import smileLick from '@/assets/avatars/smileLick.svg?raw'
import snarky from '@/assets/avatars/snarky.svg?raw'
import uneyed from '@/assets/avatars/uneyed.svg?raw'
import wildLick from '@/assets/avatars/wildLick.svg?raw'
import winkyLick from '@/assets/avatars/winkyLick.svg?raw'
export default {
  name: 'AvatarSelector',
  props: [
    "avatar",
    "color",
    "username",
  ],
  data() {
    return {
      selectedIndex: 0,
      visible: false,
      // Spot 1 is the letters. TODO It'll take editing all the SVGs, but
      // consider editing their stroke color.
      idxMap: {
        2: glee,
        3: goofy,
        4: grin,
        5: grumpy,
        6: happy,
        7: hey,
        8: joy,
        9: lick,
        10: raspberry,
        11: smile,
        12: smileLick,
        13: snarky,
        14: wildLick,
        15: winkyLick,
        16: uneyed,
      },
    }
  },
  computed: {
    localAvatar: {
      get() {
        return this.avatar;
      },
      set(newValue) {
        this.$emit('submit', newValue);
      }
    },
  },
  methods: {
    onSubmit() {
      // Spot 1, the letters, has no face: "" clears a face already saved,
      // where undefined would be left out of the update.
      this.localAvatar = this.idxMap[this.selectedIndex + 1] ?? ""
      this.visible = false
    },
    show() {
      // Start on the avatar they have now. Not at mount: a name being edited
      // gets its avatar after this has mounted.
      let foundIndex = Object.values(this.idxMap).indexOf(this.localAvatar)
      this.selectedIndex = foundIndex > -1 ? foundIndex + 1 : 0
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
  box-shadow: 0 0 0 2px rgb(var(--v-theme-on-surface));
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
  border-color: rgb(var(--v-theme-on-surface));
  box-shadow: 3px 3px 0 rgb(var(--v-theme-on-surface));
}

.safe-bottom {
  margin-bottom: 64px;
}
</style>
