<template>
  <div class="me-2">
    <div v-if="user?.avatar" class="avatar-circle" v-html="user.avatar" :style="{ 'background-color': user.color }">
    </div>
    <v-avatar v-else class="" :color="user?.color" size="36">
      <span class="text-h5 font-weight-bold icon-text">
        {{ getInitials(user?.username || "") }}
      </span>
    </v-avatar>
  </div>
</template>
<script>
export default {
  name: 'AvatarIcon',
  props: ["user"],
  data() {
    return {}
  },
  computed: {},
  mounted() {
  },
  methods: {
    getInitials(string) {
      return string.split(' ').map(name => name[0]).join('').toUpperCase();
    },
  },
}
</script>
<style>
.icon-text {
  font-family: Georgia, serif;
}

.avatar-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
