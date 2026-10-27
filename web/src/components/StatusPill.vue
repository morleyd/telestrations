<template>
  <!-- What a player is up to, as an inked pill: what's in front of them
       (drawing, writing, waiting, done), and if they hold notebooks, whether
       they're on one (its icon keeps moving), haven't started (dashed, as if
       not filled in yet) or are away (faded, dozing). -->
  <span class="status-pill" :class="[`status-pill--${look}`, { 'status-pill--working': state === 'working' }]"
    :data-state="state || status">
    <v-icon class="status-pill-icon" :icon="icon" size="14" />
    <slot><span class="status-pill-text">{{ label }}</span></slot>
  </span>
</template>
<script>
const ICONS = {
  drawing: "mdi-pencil",
  writing: "mdi-fountain-pen-tip",
  waiting: "mdi-clock-outline",
  done: "mdi-check",
  notStarted: "mdi-pause",
  away: "mdi-sleep",
}

// What a state says, where its pill has nothing more to say
const LABELS = {
  drawing: "Drawing…",
  writing: "Writing…",
  waiting: "Waiting",
  done: "Done",
  notStarted: "Not started",
  away: "Away",
}

// status: seatPlayers' status; state: its state (working, notStarted, away),
// null with no notebooks. The default slot replaces the label.
export default {
  name: "StatusPill",
  props: {
    status: { type: String, default: "waiting" },
    state: { type: String, default: null },
  },
  computed: {
    // Working looks like what they're doing; the other two, like themselves
    look() {
      return this.state && this.state !== "working" ? this.state : this.status
    },
    icon() {
      return ICONS[this.look]
    },
    label() {
      return LABELS[this.look]
    },
  },
}
</script>
<style scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 10px 3px;
  border: 2px solid var(--ink);
  border-radius: 999px;
  box-shadow: 2px 2px 0 var(--ink);
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
  background: rgb(var(--v-theme-surface));
}

.status-pill > * {
  flex: none;
}

/* Cut short rather than overflow, keeping the icon */
.status-pill > .status-pill-text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-pill--drawing {
  background: rgb(var(--v-theme-secondary-lighten-3));
}

/* Tints over the paper color, so the shapes behind don't show through */
.status-pill--writing {
  background: linear-gradient(rgba(var(--v-theme-primary), 0.18), rgba(var(--v-theme-primary), 0.18)),
    rgb(var(--v-theme-surface));
}

.status-pill--waiting {
  background: rgb(var(--v-theme-surface-light));
}

.status-pill--done {
  background: linear-gradient(rgba(var(--v-theme-grass), 0.2), rgba(var(--v-theme-grass), 0.2)),
    rgb(var(--v-theme-surface));
}

.status-pill--done .status-pill-icon {
  color: rgb(var(--v-theme-grass));
}

/* On a turn: the pencil or pen keeps scribbling */
.status-pill--working .status-pill-icon {
  animation: scribble 0.9s ease-in-out infinite;
}

/* Holding notebooks, none open: an outline still to be filled in */
.status-pill--notStarted {
  border-style: dashed;
  box-shadow: none;
  background: rgb(var(--v-theme-surface));
}

/* Gone quiet: faded, and the Zzz drifts */
.status-pill--away {
  border-color: rgba(0, 0, 0, 0.45);
  box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
  color: rgba(0, 0, 0, 0.55);
  background: rgb(var(--v-theme-surface-light));
}

.status-pill--away .status-pill-icon {
  animation: doze 2.4s ease-in-out infinite;
}

@keyframes scribble {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  25% { transform: translate(1px, -1px) rotate(-14deg); }
  50% { transform: translate(-1px, 0) rotate(6deg); }
  75% { transform: translate(1px, 1px) rotate(-8deg); }
}

@keyframes doze {
  0%, 100% { transform: translateY(0); opacity: 1; }
  50% { transform: translateY(-2px); opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .status-pill--working .status-pill-icon,
  .status-pill--away .status-pill-icon {
    animation: none;
  }
}
</style>
