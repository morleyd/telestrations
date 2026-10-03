<template>
  <!-- A notebook page. Ruled for a word or a guess, blank for a drawing; on the
       one a player is working on, a pencil writes or draws, then starts over. -->
  <svg class="story-paper-svg" viewBox="0 0 60 76" :width="width" :height="height" aria-hidden="true">
    <path d="M3 5 Q3 2.5 5.5 2.5 L55 3 Q57.5 3 57.5 5.5 L57 71.5 Q57 74 54.5 74 L5.5 73.5 Q2.5 73.5 2.5 71 Z"
      class="page" />
    <circle v-for="x in [12, 24, 36, 48]" :key="x" :cx="x" cy="7" r="1.6" class="ring" />
    <g v-if="!isDraw">
      <line v-for="y in [22, 32, 42, 52, 62]" :key="y" x1="7" :y1="y" x2="53" :y2="y" class="rule" />
      <line x1="13" y1="13" x2="13" y2="70" class="margin" />
    </g>
    <template v-if="active">
      <!-- Each stroke inks in while the pencil goes along it: a path of its
           own, since a dash pattern starts again at every stroke of a path.
           Before it starts, the dash sits wholly before the stroke, so not
           even its round end shows. -->
      <path v-for="s in strokes" :key="s.d" :d="s.d" class="marks" :pathLength="still ? null : 1"
        :stroke-dasharray="still ? null : '1 1.1'" :stroke-dashoffset="still ? null : 1.05">
        <animate v-if="!still" attributeName="stroke-dashoffset" values="1.05;1.05;0;0" :keyTimes="s.keyTimes"
          :dur="dur" repeatCount="indefinite" />
      </path>
      <g :transform="still ? `translate(${rest})` : null">
        <animateMotion v-if="!still" :path="motion" calcMode="linear" keyPoints="0;1;1" :keyTimes="`0;${DRAWN};1`"
          :dur="dur" repeatCount="indefinite" />
        <!-- The pencil, its point at the origin, leaning back -->
        <g transform="rotate(35)" class="pencil">
          <rect x="-3" y="-35" width="6" height="4" rx="1.2" class="eraser" />
          <rect x="-3" y="-31.5" width="6" height="3" class="ferrule" />
          <rect x="-3" y="-28.5" width="6" height="20.5" class="body" />
          <path d="M-3 -8 L3 -8 L0 0 Z" class="wood" />
          <path d="M-1.1 -3 L1.1 -3 L0 0 Z" class="lead" />
        </g>
      </g>
    </template>
  </svg>
</template>
<script>
// What the pencil puts down, stroke by stroke, with each stroke's length (in
// any unit, the same for all). Handwriting along the first three lines (each
// hump of it the same length), and a house under the sun.
const WRITING = [12, 10, 6].map((humps, i) => ({
  d: `M15 ${21 + 10 * i} q1.5 -5 3 0` + " t3 0".repeat(humps - 1),
  length: humps,
}))
const DRAWING = [
  { d: "M16 60 L16 40 L30 27 L44 40 L44 60 Z", length: 20 + 20 + 28 + 2 * Math.hypot(14, 13) },
  { d: "M26 60 L26 49 L34 49 L34 60", length: 30 },
  { d: "M44 15 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0", length: 8 * Math.PI },
]

// The share of the loop the pencil spends drawing. Then it rests, and starts
// over.
const DRAWN = 0.8

// When each stroke inks in: while the pencil, going along them all at an even
// pace, is on it
function timed(strokes) {
  const total = strokes.reduce((sum, s) => sum + s.length, 0)
  let done = 0
  return strokes.map(({ d, length }) => {
    const from = (done / total) * DRAWN
    done += length
    const to = (done / total) * DRAWN
    return { d, keyTimes: `0;${from.toFixed(4)};${to.toFixed(4)};1` }
  })
}

const MARKS = { writing: timed(WRITING), drawing: timed(DRAWING) }
const MOTION = {
  writing: WRITING.map((s) => s.d).join(" "),
  drawing: DRAWING.map((s) => s.d).join(" "),
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

export default {
  name: "StoryPaper",
  props: {
    // The story, so each page keeps its own pace
    id: { type: String, required: true },
    isDraw: { type: Boolean, default: false },
    // Someone is working on it: the pencil moves
    active: { type: Boolean, default: false },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  setup() {
    return { DRAWN }
  },
  data() {
    return { still: reducedMotion() }
  },
  computed: {
    strokes() {
      return MARKS[this.isDraw ? "drawing" : "writing"]
    },
    // The pencil's way: every stroke, jumping from one to the next
    motion() {
      return MOTION[this.isDraw ? "drawing" : "writing"]
    },
    // Where the pencil rests when nothing moves: at the end of what it drew
    rest() {
      return this.isDraw ? "44 15" : "33 41"
    },
    // 3-4.4s, from the story's id, so the pencils round the table don't move
    // in step
    dur() {
      let h = 0
      for (const ch of this.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
      const ms = (this.isDraw ? 3600 : 3000) + (h % 800)
      return `${ms}ms`
    },
  },
}
</script>
<style scoped>
.story-paper-svg {
  display: block;
  overflow: visible;
}

.page {
  fill: rgb(var(--v-theme-surface-bright));
  stroke: var(--ink);
  stroke-width: 2.2;
  stroke-linejoin: round;
}

.ring {
  fill: rgb(var(--v-theme-background));
  stroke: var(--ink);
  stroke-width: 1;
}

.rule {
  stroke: rgba(var(--v-theme-primary), 0.35);
  stroke-width: 0.8;
}

.margin {
  stroke: rgba(var(--v-theme-tertiary), 0.4);
  stroke-width: 0.8;
}

.marks {
  fill: none;
  stroke: var(--ink);
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pencil * {
  stroke: var(--ink);
  stroke-width: 1.1;
  stroke-linejoin: round;
}

.eraser {
  fill: #F2A7B6;
}

.ferrule {
  fill: #C9C2B4;
}

.body {
  fill: rgb(var(--v-theme-secondary));
}

.wood {
  fill: #F2D3A6;
}

.pencil .lead {
  fill: var(--ink);
}
</style>
