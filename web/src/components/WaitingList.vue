<template>
  <!-- One grid for every row, so the avatars, names, bars and who each is
       waiting on line up from row to row at any width. -->
  <div class="story-grid">
    <div v-for="story in progress" :key="story.story_id" class="story-row">
      <AvatarCircle v-bind="avatarOf(userMap[story.starter_user_id])" :size="24" />
      <span class="hand story-name" :title="userMap[story.starter_user_id]?.username">
        {{ userMap[story.starter_user_id]?.username }}
      </span>
      <v-progress-linear class="sketch-bar" color="secondary" bg-color="surface" bg-opacity="1" height="18"
        :model-value="storyProgress(story).percent" striped>
        <template v-slot:default>
          <strong class="story-count">{{ storyProgress(story).label }}</strong>
        </template>
      </v-progress-linear>
      <!-- Written out rather than in a tooltip: nobody thought to hover. -->
      <span class="story-waiting text-caption text-medium-emphasis" :title="waitingOn(story, userMap, meId)">
        {{ waitingOn(story, userMap, meId) }}
      </span>
    </div>
    <!-- A player who hasn't opened the game has no story yet. The table gives
         them a blank page; this, a row, so both count the same players. -->
    <div v-for="player in notStarted" :key="`first:${player.id}`" class="story-row story-row--unstarted">
      <AvatarCircle v-bind="avatarOf(player)" :size="24" />
      <span class="hand story-name" :title="player.username">{{ player.username }}</span>
      <v-progress-linear class="sketch-bar" color="secondary" bg-color="surface" bg-opacity="1" height="18"
        :model-value="0" />
      <span class="story-waiting text-caption text-medium-emphasis">Not started yet</span>
    </div>
  </div>
</template>
<script>
import { storyProgress, waitingOn } from '@/services/progress'

// The waiting screen as a list: a line for each story, with its progress as a
// bar and who it's waiting on, then one for each player yet to start theirs.
// progress: the progress view's rows; notStarted: the players who haven't
// opened the game; userMap: the players by id; meId: whoever is looking.
export default {
  props: {
    progress: { type: Array, required: true },
    notStarted: { type: Array, default: () => [] },
    userMap: { type: Object, required: true },
    meId: { type: String, default: "" },
  },
  methods: {
    storyProgress,
    waitingOn,
    avatarOf(user) {
      return { avatar: user?.avatar, color: user?.color, name: user?.username }
    },
  },
};
</script>
<style scoped>
/* A line of 32px a row, so a big game fits on a laptop without scrolling:
   avatar, name, bar and who it's waiting on. A long name is cut short; who
   it's waiting on can take a second line on a phone. (The waiting screen pads
   the sides.) */
.story-grid {
  display: grid;
  grid-template-columns: auto fit-content(30%) minmax(64px, 1fr) fit-content(34%);
  grid-auto-rows: 32px;
  align-items: center;
  column-gap: 8px;
  max-width: 760px;
  margin: 0 auto;
  padding-bottom: 16px;
}

/* Its avatar, name, bar and caption go straight into the grid's columns. */
.story-row {
  display: contents;
}

.story-name {
  font-size: 1.2rem;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.story-count {
  font-size: 0.75rem;
  line-height: 1;
}

.story-waiting {
  line-height: 14px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

/* Nothing to show yet but that they haven't started */
.story-row--unstarted .sketch-bar {
  opacity: 0.6;
}
</style>
