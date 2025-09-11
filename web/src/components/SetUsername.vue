<template>
  <v-card class="bg-transparent elevation-0 w-100">
    <v-form ref="form" @submit.prevent="onSubmit">
      <v-row class="pa-2">
        <v-col cols="2">
          <!-- TODO Allow users to upload their own avatars -->
          <v-icon v-if="hasAvatar"></v-icon>
          <v-icon v-else-if="defaultAvatar" :color="avatarColor" style="font-size: 58px;">
            {{ defaultAvatar }}
          </v-icon>
        </v-col>
        <v-col cols="10">
          <v-text-field v-model="username" label="Username" @keyup.enter="onSubmit"
            :rules="[v => v && v.trim || 'Name cannot be empty!']" />
        </v-col>
      </v-row>
    </v-form>
  </v-card>
</template>
<script>
export default {
  name: "TakeTurn",
  data() {
    return {
      hasAvatar: false,
      username: "",
      color: "hsl(0, 0%, 0%)",
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
  methods: {
    async validate() {
      let validation = await this.$refs.form.validate()
      validation["username"] = this.username
      validation["color"] = this.color
      return validation
    },
    onSubmit() {
      this.$emit("username")
    },
  },
};
</script>
