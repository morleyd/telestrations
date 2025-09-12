<template>
  <v-card class="justify-center overflow-y-auto" width="100vw" height="calc(100vh - 48px)" loading="secondary">
    <v-card-title class="wrap">
      Waiting for other users to finish their prompts.
    </v-card-title>
    <v-row v-for="(user, index) in progress" class="pa-4 d-flex" no-gutters :key="index">
      <v-col md="1" style="justify-items: right;">
        <AvatarIcon :user="userMap[user.starter_user_id]" />
      </v-col>
      <v-col md="1" style="justify-items: center;">
        <v-card-title class="wrap">{{ userMap[user.starter_user_id]?.username }}</v-card-title>
      </v-col>
      <v-col md="10">
        <v-tooltip text="Tooltip" location="bottom" open-on-click open-delay="250">
          <template v-slot:activator="{ props }">
            <v-progress-linear v-bind="props" color="secondary" height="30" :model-value="progressPercent(user)"
              striped>
              <template v-slot:default>
                <strong>{{ user.turns_taken }} / {{ user.total_players }}</strong>
              </template>
            </v-progress-linear>
          </template>
          <span>Waiting on {{ userMap[user.next_user_id]?.username }}</span>
        </v-tooltip>
      </v-col>
    </v-row>
  </v-card>
</template>
<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pb, pbService } from '@/services/pocketbase'
export default {
  name: "TakeTurn",
  data() {
    return {
      progress: [],
      userMap: {},
    }
  },
  computed: {
    ...mapStores(useUserStore),
  },
  async mounted() {
    let resp = await pbService.users.getUsers(this.$route.params.gameCode)
    if (resp.errMsg) {
      this.$emit("snack", resp.errMsg, "error")
    }
    this.userMap = Object.fromEntries(resp.data.map(obj => [obj.id, obj]))

    await this.getProgress()
  },
  methods: {
    progressPercent(user) {
      return (user.turns_taken / user.total_players) * 100
    },
    async getProgress() {
      let resp = await pbService.progress.getFullProgress(this.$route.params.gameCode)
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
      }
      this.progress = resp.data
    },
  },
};
</script>
<style scoped>
.wrap {
  text-align: center;
  white-space: break-spaces;
  word-break: break-word;
  word-wrap: break-word;
}
</style>
