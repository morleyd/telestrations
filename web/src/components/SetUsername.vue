<template>
  <v-card class="bg-transparent elevation-0 w-100">
    <v-form ref="form" @submit.prevent="onSubmit">
      <v-row class="pa-2">
        <v-col cols="2">
          <AvatarSelector ref="avatar" v-if="username" :username="username" :avatar="avatar" @submit="onAvatarSelect" />
        </v-col>
        <v-col cols="10">
          <v-text-field v-model="username" label="Username" @keyup.enter="onSubmit"
            :rules="[v => !!v?.trim() || 'Name cannot be empty!']" @input="username = username.toLowerCase()" />
        </v-col>
      </v-row>
    </v-form>
  </v-card>
</template>
<script>
export default {
  name: "SetUsername",
  data() {
    return {
      avatar: null,
      username: "",
    }
  },
  computed: {
    color() {
      // Default to white
      return this.$refs?.avatar?.avatarColor || "hsl(0, 0%, 100%)"
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
