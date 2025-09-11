<template>
  <v-card class="pa-4 bg-white" width="500">
    <v-card-title class="text-center text-h4">New User</v-card-title>
    <v-form ref="form">
      <v-row class="pa-2">
        <v-col cols="2">
          <v-btn icon variant="outlined" elevation="2">
            <v-icon v-if="hasAvatar"></v-icon>
            <v-icon v-else-if="defaultAvatar" color="avatarColor" size="x-large">{{ defaultAvatar }}</v-icon>
          </v-btn>
        </v-col>
        <v-col cols="10">
          <v-text-field v-model="username" label="Name" :rules="[v => v && v.trim || 'Name cannot be empty!']" />
        </v-col>
      </v-row>
      <v-row class="pa-2" style="justify-content: center;">
        <v-btn size="x-large" color="primary" elevation="2" @click="storeUser">Save</v-btn>
      </v-row>
    </v-form>
  </v-card>
</template>

<script>
import { pbService } from '@/services/pocketbase'
export default {
  name: "TakeTurn",
  data() {
    return {
      hasAvatar: false,
      username: "",
    }
  },
  computed: {
    defaultAvatar() {
      if (this.username != '') {
        let initial = this.username.at(0).toLowerCase()
        return `mdi-alpha-${initial}-circle`
      }
      return ''
    },
    avatarColor() {
      let normalize = (hash, min, max) => {
        return Math.floor((hash % (max - min)) + min)
      }

      const hRange = [0, 360];
      const sRange = [0, 100];
      const lRange = [0, 100];

      if (this.username != '') {
        let hash = generateHash(this.username)
        let hue = normalize(hash, hRange[0], hRange[1])
        let saturation = normalize(hash, sRange[0], sRange[1])
        let lightness = normalize(hash, lRange[0], lRange[1])
        console.log("color", `hsl(${hue}, ${saturation}, ${lightness})`)
        return `hsl(${hue}, ${saturation}, ${lightness})`
      }
      return ''
    },
  },
  methods: {
    generateHash(str) {
      let hash = 0
      for (let i = 0; i < str.length; i++) {
        // use a bitwise shift (5 is important?)
        hash = str.charCodeAt(i) + ((hash << 5) - hash)
      }
      console.log('generateHash', Math.abs(hash))
      return Math.abs(hash)
    },
  },
};
</script>