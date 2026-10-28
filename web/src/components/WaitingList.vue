<template>
  <div class="list-by" role="group" aria-label="List the game by">
    <v-btn v-for="m in MODES" :key="m.value" size="small" density="comfortable" :prepend-icon="m.icon"
      :variant="mode === m.value ? 'tonal' : 'text'" :aria-pressed="String(mode === m.value)" @click="mode = m.value">
      {{ m.label }}
    </v-btn>
  </div>
  <!-- One grid for every row, so the avatars, names, bars and who each is
       waiting on line up from row to row at any width. -->
  <div v-if="mode === 'stories'" class="story-grid">
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
  <!-- A line for each player, in seat order, laid out as the stories are:
       the turns they took, then in another color the ones skipped for
       them, of all they'll get. -->
  <div v-else class="story-grid">
    <div v-for="{ player, turns } in playerRows" :key="player.id" class="story-row player-row"
      :class="{ 'story-row--unstarted': turns.unstarted }">
      <AvatarCircle v-bind="avatarOf(player)" :size="24" />
      <span class="hand story-name" :title="player.username">{{ player.username }}</span>
      <v-progress-linear class="sketch-bar" color="secondary" bg-color="surface" bg-opacity="1"
        buffer-color="tertiary-lighten-2" buffer-opacity="1" height="18" :model-value="turns.doneShare"
        :buffer-value="turns.doneShare + turns.skippedShare" striped>
        <template v-slot:default>
          <strong class="story-count">{{ turns.label }}</strong>
        </template>
      </v-progress-linear>
      <span class="story-waiting text-caption text-medium-emphasis">
        {{ turns.status }}<template v-if="turns.status && turns.skippedNote"> · </template>
        <span v-if="turns.skippedNote" class="skipped-note"><span class="skipped-key"></span>{{ turns.skippedNote }}</span>
      </span>
    </div>
  </div>
</template>
<script>
import { storyProgress, waitingOn, playerTurns } from '@/services/progress'

// Two ways to list the game: by story, or by player. Each player's pick is
// remembered on their device, like the Table/List switch.
const MODES = [
  { value: "stories", label: "Stories", icon: "mdi-book-open-variant" },
  { value: "players", label: "Players", icon: "mdi-account-multiple" },
]
const MODE_KEY = "waitingListBy"

function savedMode() {
  try {
    return localStorage.getItem(MODE_KEY) === "players" ? "players" : "stories"
  } catch {
    return "stories"
  }
}

// The waiting screen as a list. By story: a line for each, with its progress
// as a bar and who it's waiting on, then one for each player yet to start
// theirs. By player: a line for each, with the turns they've had as a bar.
// progress: the progress view's rows; players: the game's players, in seat
// order; notStarted: the players who haven't opened the game; userMap: the
// players by id; meId: whoever is looking.
export default {
  props: {
    progress: { type: Array, required: true },
    players: { type: Array, default: () => [] },
    notStarted: { type: Array, default: () => [] },
    userMap: { type: Object, required: true },
    meId: { type: String, default: "" },
  },
  setup() {
    return { MODES }
  },
  data() {
    return { mode: savedMode() }
  },
  computed: {
    playerRows() {
      const most = Math.max(0, ...this.players.map((p) => p.turns || 0))
      return this.players.map((player) => ({
        player,
        turns: playerTurns(player, most),
      }))
    },
  },
  watch: {
    mode(mode) {
      try {
        localStorage.setItem(MODE_KEY, mode)
      } catch {
        // Not remembered, then: this time only
      }
    },
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
/* Stories or Players, over the list */
.list-by {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-bottom: 4px;
}

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

/* The skipped turns' color, as a key beside how many */
.skipped-note {
  white-space: nowrap;
}

.skipped-key {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border: 1px solid var(--ink);
  border-radius: 2px;
  background: rgb(var(--v-theme-tertiary-lighten-2));
  vertical-align: -1px;
}
</style>
