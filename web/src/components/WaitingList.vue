<template>
  <!-- One grid for every story, so the avatars, names and bars line up from
       row to row at any width. -->
  <div class="story-grid">
    <div v-for="story in progress" :key="story.story_id" class="story-row">
      <AvatarIcon :user="userMap[story.starter_user_id]" />
      <span class="hand story-name">{{ userMap[story.starter_user_id]?.username }}</span>
      <v-progress-linear class="sketch-bar" color="secondary" bg-color="surface" bg-opacity="1" height="30"
        :model-value="storyProgress(story).percent" striped>
        <template v-slot:default>
          <strong>{{ storyProgress(story).label }}</strong>
        </template>
      </v-progress-linear>
      <!-- Written out rather than in a tooltip: nobody thought to hover. -->
      <div class="story-waiting text-caption text-medium-emphasis">
        {{ waitingOn(story, userMap, meId) }}
      </div>
    </div>
  </div>
</template>
<script>
import { storyProgress, waitingOn } from '@/services/progress'

// The waiting screen as a list: each story's progress as a bar, and who it's
// waiting on. progress: the progress view's rows; userMap: the players by id;
// meId: whoever is looking.
export default {
  name: "WaitingList",
  props: {
    progress: { type: Array, required: true },
    userMap: { type: Object, required: true },
    meId: { type: String, default: "" },
  },
  methods: {
    storyProgress,
    waitingOn,
  },
};
</script>
<style scoped>
/* Avatar, name and bar on a line, and under the bar who the story's waiting
   on. A long name wraps rather than squeeze the bar. (The waiting screen pads
   the sides.) */
.story-grid {
  display: grid;
  grid-template-columns: auto fit-content(40%) minmax(0, 1fr);
  align-items: center;
  column-gap: 12px;
  max-width: 760px;
  margin: 8px auto 0;
  padding-bottom: 16px;
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

/* A story's fourth item. Placed automatically it would start a new grid
   row in the first column; column 3 puts it under the bar instead. */
.story-waiting {
  grid-column: 3;
  margin: 4px 0 18px;
}
</style>
