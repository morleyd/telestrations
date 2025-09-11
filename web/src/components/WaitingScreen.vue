// firstTurn finished waiting playing
<template>
  <v-card class="justify-center overflow-y-auto" width="100vw" height="calc(100vh - 48px)" loading="secondary">
    <v-card-title class="wrap">
      Waiting for other users to finish their prompts.
    </v-card-title>
    <!-- <div v-for="(user, index) in progress" :key="index" class="d-flex align-center ga-4">
      <v-progress-linear color="light-blue" height="10" model-value="10" striped />
    </div> -->
    <v-row v-for="(user, index) in progress" class="pa-4 d-flex" no-gutters :key="index">
      <v-card-title>{{ userMap[user.starter_user_id] }}</v-card-title>
      <v-tooltip text="Tooltip" location="bottom" open-on-click open-delay="250">
        <template v-slot:activator="{ props }">
          <v-progress-linear v-bind="props" color="secondary" height="30" :model-value="progressPercent(user)" striped>
            <template v-slot:default>
              <strong>{{ user.turns_taken }} / {{ user.total_players }}</strong>
            </template>
          </v-progress-linear>
        </template>
        <span>Waiting on {{ userMap[user.next_user_id] }}</span>
      </v-tooltip>
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
    this.userMap = Object.fromEntries(resp.data.map(obj => [obj.id, obj.username]))

    await this.getProgress()

    // let that = this
    // pb.collection('turns').subscribe('*', async function (e) {
    //   console.log("subscription event", e)
    //   that.getProgress()
    // }, { filter: `game_id.game_code="${that.$route.params.gameCode}"` })
  },
  // unmounted() {
  //   pb.collection('turns').unsubscribe();
  // },
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
      console.log("this.progress", this.progress)
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
