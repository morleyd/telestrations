<template>
  <v-card class="bg-transparent elevation-0 w-100">
    <v-form ref="form" @submit.prevent="onSubmit">
      <v-row class="pa-2">
        <v-col v-if="pickAvatar" cols="auto">
          <AvatarSelector :username="username" :avatar="avatar" :color="color" @submit="onAvatarSelect" />
        </v-col>
        <v-col>
          <v-text-field v-model="username" label="Username" @keyup.enter="onSubmit"
            :rules="[v => !!v?.trim() || 'Name cannot be empty!']" />
        </v-col>
      </v-row>
    </v-form>
  </v-card>
</template>
<script>
import { avatarColor } from '@/services/player'

export default {
  name: "SetUsername",
  props: {
    // Off where the name signs in to a seat that already has its avatar.
    pickAvatar: { type: Boolean, default: true },
  },
  data() {
    return {
      avatar: null,
      username: "",
    }
  },
  computed: {
    color() {
      return avatarColor(this.username)
    },
  },
  methods: {
    set(username, avatar) {
      this.username = username
      this.avatar = avatar
    },
    async validate() {
      let validation = await this.$refs.form.validate()
      validation["username"] = this.username
      validation["color"] = this.color
      validation["avatar"] = this.avatar
      return validation
    },
    onAvatarSelect(avatar) {
      this.avatar = avatar
    },
    // One Enter in the field lands here twice: the form's implicit submit on
    // keydown, then @keyup.enter on keyup. That submit also bubbles to a parent
    // page's own @submit form. So a page handler on @username runs twice per
    // Enter, more if it also handles its form's @submit, and each page latches
    // it on the first in-flight call.
    onSubmit() {
      this.$emit("username")
    },
  },
};
</script>
