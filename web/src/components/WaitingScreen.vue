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
        <v-progress-linear color="secondary" height="30" :model-value="storyProgress(user).percent" striped>
          <template v-slot:default>
            <strong>{{ storyProgress(user).label }}</strong>
          </template>
        </v-progress-linear>
        <!-- Written out rather than in a tooltip: nobody thought to hover. -->
        <div class="story-waiting text-caption text-medium-emphasis mt-1">
          {{ waitingOn(user, userMap, userStore.userId) }}
        </div>
      </v-col>
    </v-row>
  </v-card>
</template>
<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pbService } from '@/services/pocketbase'
import { storyProgress, waitingOn } from '@/services/progress'
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
    if (resp.data) {
      this.userMap = Object.fromEntries(resp.data.map(obj => [obj.id, obj]))
    }

    await this.getProgress()
  },
  methods: {
    storyProgress,
    waitingOn,
    async getProgress() {
      let resp = await pbService.progress.getFullProgress(this.$route.params.gameCode)
      if (resp.aborted) return // a newer refresh is on its way
      if (resp.errMsg) {
        this.$emit("snack", resp.errMsg, "error")
        return // keep what we had; the next refresh retries
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
