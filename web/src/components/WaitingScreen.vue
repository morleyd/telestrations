<template>
  <v-card class="overflow-y-auto" width="100vw" height="calc(100vh - 48px)" loading="secondary" color="transparent"
    flat>
    <v-card-title class="wrap">
      Waiting for other users to finish their prompts.
    </v-card-title>
    <!-- One grid for every story, so the avatars, names and bars line up from
         row to row at any width. -->
    <div class="story-grid">
      <div v-for="(user, index) in progress" class="story-row" :key="index">
        <AvatarIcon :user="userMap?.[user.starter_user_id]" />
        <span class="hand story-name">{{ userMap?.[user.starter_user_id]?.username }}</span>
        <v-progress-linear class="sketch-bar" color="secondary" bg-color="surface" bg-opacity="1" height="30"
          :model-value="storyProgress(user).percent" striped>
          <template v-slot:default>
            <strong>{{ storyProgress(user).label }}</strong>
          </template>
        </v-progress-linear>
        <!-- Written out rather than in a tooltip: nobody thought to hover. -->
        <div class="story-waiting text-caption text-medium-emphasis">
          {{ waitingOn(user, userMap, userStore.userId) }}
        </div>
      </div>
    </div>
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

/* Avatar, name and bar on a line, and under the bar who the story's waiting
   on. A long name wraps rather than squeeze the bar. */
.story-grid {
  display: grid;
  grid-template-columns: auto fit-content(40%) minmax(0, 1fr);
  align-items: center;
  column-gap: 12px;
  max-width: 760px;
  margin: 8px auto 0;
  padding: 0 16px 16px;
}

/* Its avatar, name, bar and caption go straight into the grid's columns. */
.story-row {
  display: contents;
}

.story-name {
  font-size: 1.5rem;
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.story-waiting {
  grid-column: 3;
  margin: 4px 0 18px;
}
</style>
