<template>
  <!-- One turn: its round timer, and the drawing or the word. TakeTurn keeps
       each turn it opens alive until it's written, so a player can set one
       aside for another and come back to it as they left it, timer still
       running. Everything it emits says which turn it's from: one set aside
       can still time out. -->
  <div>
    <CountdownTimer :duration="duration" @finished="$emit('timeout', prompt)" />
    <DrawingTurn v-if="isDraw" ref="draw" :prompt="prompt.prev_prompt" @snack="(...a) => $emit('snack', ...a)"
      @drawing="(d) => $emit('submit', prompt, d)" />
    <PromptTurn v-else ref="prompt" :isFirst="isFirst" @snack="(...a) => $emit('snack', ...a)"
      @prompt="(t) => $emit('submit', prompt, t)" />
  </div>
</template>
<script>
import { pb } from '@/services/pocketbase'
import { log } from '@/services/log'

// prompt: the turn, as TakeTurn has it (a progress row, or for a first turn
// the story itself); duration: the round's seconds, or -1 for no timer.
export default {
  name: "TurnPane",
  props: {
    prompt: { type: Object, required: true },
    duration: { type: Number, default: -1 },
  },
  emits: ["ready", "submit", "timeout", "snack"],
  computed: {
    // A turn after a word is a drawing; a turn after a drawing (prev_prompt
    // empty) is a guess. A first turn's prompt is the story itself, which has
    // no prev_prompt: a word.
    isDraw() {
      return Boolean(this.prompt.prev_prompt)
    },
    isFirst() {
      return !this.prompt.story_id
    },
  },
  created() {
    // So TakeTurn can read this turn's work while it's set aside (see partial)
    this.$emit("ready", this)
  },
  mounted() {
    if (!this.isDraw && !this.isFirst) this.getDrawing()
  },
  methods: {
    // What the player has so far: the drawing (null when blank), or the word.
    async partial() {
      if (this.isDraw) return await this.$refs.draw?.getDrawing()
      return this.$refs.prompt?.prompt?.trim()
    },
    // The drawing to guess from
    async getDrawing() {
      try {
        const record = await pb.collection('turns').getOne(this.prompt.prev_turn_id, { requestKey: null })
        this.$refs.prompt?.setDrawing(pb.files.getUrl(record, this.prompt.prev_drawing))
      } catch (err) {
        log.warn("turn.drawing.failed", { story: this.prompt.story_id, err: String(err?.message || err) })
      }
    },
  },
}
</script>
