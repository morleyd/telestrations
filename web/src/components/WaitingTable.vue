<template>
  <div class="waiting-table" :class="`waiting-table--${layout.kind}`"
    :style="{ width: `${layout.width}px`, height: `${layout.height}px` }">
    <div class="table-top" :style="box(layout.table)"></div>

    <!-- The notebooks, each where its story is: in front of whoever it's
         waiting on. When it moves on, it slides over (see placed). -->
    <TransitionGroup name="paper" tag="div" class="papers" aria-hidden="true">
      <div v-for="p in placed" :key="p.id" :ref="(el) => keep(p.id, el)" class="story-paper" :data-story="p.id"
        :data-holder="p.holder" :style="paperStyle(p)">
        <StoryPaper :id="p.id" :is-draw="p.isDraw" :active="p.k === 0" :width="layout.paper.w"
          :height="layout.paper.h" />
      </div>
    </TransitionGroup>

    <div v-for="(seat, i) in seats" :key="seat.player.id" class="seat" :data-player="seat.player.username">
      <div class="seat-avatar" :style="avatarStyle(i)">
        <AvatarCircle :avatar="seat.player.avatar" :color="seat.player.color" :name="seat.player.username"
          :size="layout.avatar" />
      </div>
      <div class="seat-label" :style="labelStyle(i)">
        <!-- A long name is cut short, but never the "(you)" -->
        <div class="seat-name hand">
          <span class="seat-name-text">{{ seat.player.username }}</span>
          <span v-if="seat.isMe" class="seat-you">&nbsp;(you)</span>
        </div>
        <span class="seat-status" :class="`seat-status--${seat.status}`">
          <v-icon :icon="ICONS[seat.status]" size="14" />
          <span class="seat-status-text">{{ statusText(seat) }}</span>
          <span v-if="seat.papers.length > 1" class="seat-pile">+{{ seat.papers.length - 1 }}</span>
        </span>
      </div>
    </div>
  </div>
</template>
<script>
import { pileSpot, travel } from '@/services/table'

const ICONS = {
  drawing: "mdi-pencil",
  writing: "mdi-fountain-pen-tip",
  waiting: "mdi-clock-outline",
  done: "mdi-check",
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

// The table on the waiting screen: the players round it (or down one side of
// a long one), each with the notebooks waiting on them. seats: seatPlayers;
// layout: roundTable or longTable, with a spot for each seat.
export default {
  name: "WaitingTable",
  props: {
    seats: { type: Array, required: true },
    layout: { type: Object, required: true },
  },
  setup() {
    return { ICONS }
  },
  computed: {
    // Every notebook and where it lies. A move only slides within one layout:
    // when the screen resizes or a player leaves, everything is just redrawn.
    placed() {
      const { kind, width, height, seats } = this.layout
      const key = `${kind}:${width}:${height}:${seats.length}`
      return this.seats.flatMap((seat, i) => seat.papers.map((paper, k) => ({
        ...paper, k, seat: i, key,
        holder: seat.player.username,
        spot: pileSpot(seats[i], k),
      })))
    },
  },
  watch: {
    // After the redraw, before the browser paints it: each notebook that moved
    // goes back to where it was and slides to where it is now.
    placed: {
      handler(now, before) {
        if (!before || reducedMotion()) return
        const was = new Map(before.map((p) => [p.id, p]))
        for (const p of now) {
          const old = was.get(p.id)
          const el = this.els.get(p.id)
          // Just arrived, or redrawn for a new layout: nothing to slide from
          const fresh = !old || !el || old.key !== p.key
          const moved = !fresh && (old.seat !== p.seat || old.k !== p.k)
          if (!moved) continue
          this.slides.get(p.id)?.cancel()
          this.slides.set(p.id, this.slide(el, travel(old.spot, p.spot, this.layout, old.seat, p.seat)))
        }
      },
      flush: "post",
    },
  },
  created() {
    // Not reactive: only the slides use them. The notebooks' elements, and the
    // slide each is on, by story.
    this.els = new Map()
    this.slides = new Map()
  },
  methods: {
    keep(id, el) {
      if (el) this.els.set(id, el)
      else this.els.delete(id)
    },
    slide(el, stops) {
      const legs = stops.slice(1).map((s, i) => Math.hypot(s.x - stops[i].x, s.y - stops[i].y))
      const length = legs.reduce((a, b) => a + b, 0)
      let gone = 0
      const frames = stops.map((s, i) => {
        if (i > 0) gone += legs[i - 1]
        return { transform: this.transform(s), offset: length ? gone / length : i / (stops.length - 1) }
      })
      return el.animate(frames, {
        duration: Math.min(1800, Math.max(600, 500 + length * 1.2)),
        easing: "ease-in-out",
      })
    },
    transform({ x, y, rot }) {
      const { w, h } = this.layout.paper
      return `translate(${x - w / 2}px, ${y - h / 2}px) rotate(${rot}deg)`
    },
    paperStyle(p) {
      return {
        width: `${this.layout.paper.w}px`,
        height: `${this.layout.paper.h}px`,
        transform: this.transform(p.spot),
        zIndex: 10 - Math.min(p.k, 9),
      }
    },
    avatarStyle(i) {
      const { x, y } = this.layout.seats[i]
      const half = this.layout.avatar / 2
      return { left: `${x - half}px`, top: `${y - half}px` }
    },
    labelStyle(i) {
      const { x, y, shift, align, max } = this.layout.seats[i].label
      return {
        left: `${x}px`,
        top: `${y}px`,
        transform: `translate(${shift.x}%, ${shift.y}%)`,
        textAlign: align,
        alignItems: { left: "flex-start", right: "flex-end", center: "center" }[align],
        maxWidth: `${max}px`,
      }
    },
    box({ x, y, w, h }) {
      return { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }
    },
    statusText(seat) {
      switch (seat.status) {
        case "drawing": return "Drawing…"
        case "writing": return "Writing…"
        case "done": return "Done"
        default: return seat.waitingOn ? `Waiting on ${seat.waitingOn.username}` : "Waiting"
      }
    },
  },
}
</script>
<style scoped>
.waiting-table {
  position: relative;
  margin: 0 auto;
}

/* Wood, with its rings, in ink like everything else */
.table-top {
  position: absolute;
  border: 3px solid var(--ink);
  box-shadow: 5px 5px 0 var(--ink);
  background-color: #EADFC8;
  background-image: repeating-radial-gradient(ellipse at center, #EADFC8 0 13px, #E2D4B6 13px 15px);
}

.waiting-table--round .table-top {
  border-radius: 50%;
}

.waiting-table--long .table-top,
.waiting-table--sides .table-top {
  border-radius: var(--wobble-card);
  background-image: repeating-radial-gradient(ellipse at center, #EADFC8 0 9px, #E2D4B6 9px 11px);
}

/* One shadow for every notebook, so the light comes from the same side
   however each one is turned */
.papers {
  position: absolute;
  inset: 0;
  filter: drop-shadow(2px 2px 0 var(--ink));
}

.story-paper {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 50% 50%;
}

.paper-enter-active,
.paper-leave-active {
  transition: opacity 0.4s;
}

.paper-enter-from,
.paper-leave-to {
  opacity: 0;
}

.seat-avatar {
  position: absolute;
  z-index: 20;
  line-height: 0;
}

.seat-label {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: max-content;
}

.seat-name {
  display: flex;
  align-items: baseline;
  max-width: 100%;
  font-size: 1.25rem;
  line-height: 1.1;
  white-space: nowrap;
}

.seat-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.seat-you {
  flex: none;
  font-size: 0.85em;
  opacity: 0.6;
}

.seat-status {
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

.seat-status > * {
  flex: none;
}

/* Cut short with an ellipsis, keeping the icon and the pile count */
.seat-status > .seat-status-text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.seat-status--drawing {
  background: rgb(var(--v-theme-secondary-lighten-3));
}

/* Tints over the paper color, so the shapes behind don't show through */
.seat-status--writing {
  background: linear-gradient(rgba(var(--v-theme-primary), 0.18), rgba(var(--v-theme-primary), 0.18)),
    rgb(var(--v-theme-surface));
}

.seat-status--waiting {
  background: rgb(var(--v-theme-surface-light));
}

.seat-status--done {
  background: linear-gradient(rgba(var(--v-theme-grass), 0.2), rgba(var(--v-theme-grass), 0.2)),
    rgb(var(--v-theme-surface));
}

.seat-status--done .v-icon {
  color: rgb(var(--v-theme-grass));
}

.seat-pile {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ink);
  color: rgb(var(--v-theme-surface));
  font-size: 0.7rem;
}
</style>
