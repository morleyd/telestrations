<template>
  <button type="button" class="avatar-picker" aria-label="Choose your avatar" @click="show">
    <span class="avatar-picker-face elevation-2">
      <AvatarCircle :avatar="avatar" :color="color" :name="username" :size="56" />
      <span class="avatar-picker-badge elevation-1">
        <v-icon icon="mdi-pencil" size="14" />
      </span>
    </span>
    <span class="text-caption text-primary font-weight-medium">Pick avatar</span>
  </button>
  <v-dialog v-model="visible" max-width="500">
    <v-item-group v-model="selectedIndex" mandatory>
      <v-card class="pa-4 overflow-auto" style="justify-self: center;" max-height="calc(100vh - 48px)">
        <v-card-title class="text-center text-h5 pb-4">Pick your avatar</v-card-title>
        <v-row style="text-align: -webkit-center;">
          <v-col v-for="n in 16" :key="n" cols="12" md="3" class="pa-0">
            <v-item v-slot="{ isSelected, toggle }">
              <v-card class="elevation-0 bg-transparent py-4" style="justify-items: center; border-radius: 50%;"
                width="112" height="112" @click="toggle" :style="selectedStyle(isSelected)">
                <v-scroll-y-transition>
                  <AvatarCircle v-if="n == 1" :color="color" :name="username" :size="80" style="justify-self: anchor-center;" />
                  <div v-else :id="'avatar' + n" style="width: 80px; height: 80px;" class="avatar-circle"
                    @click="toggle" :style="{ 'background-color': color }">
                  </div>
                </v-scroll-y-transition>
              </v-card>
            </v-item>
          </v-col>
        </v-row>
        <v-row class="justify-center" :class="$vuetify.display.smAndDown ? 'safe-bottom': ''">
          <v-btn size="large" color="primary" @click="onSubmit">
            Submit
          </v-btn>
        </v-row>
      </v-card>
    </v-item-group>
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
    selectedStyle(isSelected) {
      if (isSelected) {
        return {
          'border': '3px solid black',
          'border-radius': '50%',
          'padding-top': '14px !important',
        }
      }
      return {}
    },
    onSubmit() {
      this.localAvatar = this.idxMap[this.selectedIndex + 1]
      this.visible = false
    },
    show() {
      // Start on the avatar they have now. Not at mount: a name being edited
      // gets its avatar after this has mounted.
      let foundIndex = Object.values(this.idxMap).indexOf(this.localAvatar)
      this.selectedIndex = foundIndex > -1 ? foundIndex + 1 : 0
      this.visible = true
      this.$nextTick(() => {
        for (let idx = 1; idx <= 16; idx++) {
          // Save the first spot for the letter avatar
          if (idx == 1) {
            continue
          }

          let avatar = document.getElementById(`avatar${idx}`)
          avatar.innerHTML = this.idxMap[idx];
          // TODO It'll take editing all the SVGs, but consider editing stroke color
          // icon.querySelectorAll('[stroke]').forEach(el => {
          //   el.setAttribute('stroke', 'red')   // <-- dynamic stroke color
          // })
        }
      })
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
  border-radius: 50%;
  transition: box-shadow 0.2s;
}

.avatar-picker:hover .avatar-picker-face {
  box-shadow: 0 0 0 3px rgb(var(--v-theme-primary)) !important;
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
}

.safe-bottom {
  margin-bottom: 64px;
}
</style>
