<template>
  <div v-if="localAvatar" id="avatar" class="avatar-circle me-4 cursor-pointer elevation-2" @click="show"
    style="width: 54px; height: 54px;" :style="{ 'background-color': avatarColor }" v-html="localAvatar">
  </div>
  <v-avatar v-else class="cursor-pointer me-4 elevation-2" :color="avatarColor" size="54" @click="show">
    <span class="text-h4 font-weight-bold icon-text">
      {{ getInitials(username) }}
    </span>
  </v-avatar>
  <v-dialog v-model="visible" max-width="500">
    <v-item-group v-model="selectedIndex" mandatory>
      <v-card class="pa-4 overflow-auto" style="justify-self: center;" max-height="calc(100vh - 48px)">
        <v-row style="text-align: -webkit-center;">
          <v-col v-for="n in 16" :key="col" cols="12" md="3" class="pa-0">
            <v-item v-slot="{ isSelected, toggle }">
              <v-card class="elevation-0 bg-transparent py-4" style="justify-items: center; border-radius: 50%;"
                width="112" height="112" @click="toggle" :style="selectedStyle(isSelected)">
                <v-scroll-y-transition>
                  <v-avatar v-if="n == 1" size="80" :color="avatarColor" style="justify-self: anchor-center;">
                    <span class="text-h3 font-weight-bold icon-text">
                      {{ getInitials(username) }}
                    </span>
                  </v-avatar>
                  <div v-else :id="'avatar' + n" style="width: 80px; height: 80px;" class="avatar-circle"
                    @click="toggle" :style="{ 'background-color': avatarColor }">
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
    avatarColor() {
      // Generate a deterministic (but random) digit based on a string
      let generateHash = (str) => {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
          // use a bitwise shift (5 is important?)
          hash = str.charCodeAt(i) + ((hash << 5) - hash)
        }
        return Math.abs(hash)
      }
      // Use the random hash to make a value in a given range
      let normalize = (hash, min, max) => {
        return Math.floor((hash % (max - min)) + min)
      }

      // Set the allowable range for each number type
      const hRange = [0, 360];
      const sRange = [60, 100];
      const lRange = [50, 80];

      if (this.username != '') {
        let hash = generateHash(this.username)
        let hue = normalize(hash, hRange[0], hRange[1])
        let saturation = normalize(hash, sRange[0], sRange[1])
        let lightness = normalize(hash, lRange[0], lRange[1])
        this.color = `hsl(${hue}, ${saturation}%, ${lightness}%)`
      } else {
        this.color = "hsl(0, 0%, 0%)"
      }
      return this.color
    },
  },
  mounted() {
    if (this.localAvatar) {
      let foundIndex = Object.values(this.idxMap).indexOf(this.localAvatar)
      if (foundIndex >-1) {
        this.selectedIndex = foundIndex + 1
      }
    }
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
    getInitials(string) {
      return string.split(' ').map(name => name[0]).join('').toUpperCase();
    },
    show() {
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
.icon-text {
  font-family: Georgia, serif;
}

.avatar-circle {
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.safe-bottom {
  margin-bottom: 64px;
}
</style>
