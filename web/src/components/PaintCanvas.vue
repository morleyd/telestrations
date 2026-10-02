// Copyright (2025- ) David C. Morley

// PaintCanvas is the drawing surface: it turns pointer input into picture
// coordinates for the PaintEngine, which does the drawing and keeps the history
<template>
  <canvas ref="canvas" class="paint-canvas" :class="{ 'paint-canvas--ring': ringCursor }" role="img"
    aria-label="Drawing canvas" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp"
    @lostpointercapture="onUp" @pointerleave="onLeave" @contextmenu.prevent />
</template>
<script>
import PaintEngine, { HEIGHT, WIDTH } from "@/services/paint/engine";
import { RING_TOOLS } from "@/services/paint/tools";

export default {
  name: "PaintCanvas",
  props: {
    tool: { type: String, required: true },
    color: { type: String, required: true },
    size: { type: Number, required: true },
    shapeStyle: { type: String, required: true },
    behind: { type: Boolean, required: true },
  },
  emits: ["change", "pick", "coords"],
  data() {
    return {
      pointerId: null,
    }
  },
  computed: {
    ringCursor() {
      return RING_TOOLS.has(this.tool)
    },
  },
  watch: {
    tool() {
      this.engine.leave()
    },
  },
  mounted() {
    this.engine = new PaintEngine(this.$refs.canvas, {
      settings: () => this.$props,
      onChange: (state) => this.$emit("change", state),
    })
  },
  beforeUnmount() {
    this.engine.destroy()
  },
  methods: {
    /**
     * toPicture converts a pointer event's position into picture pixels
     * @param {PointerEvent} e - the event
     * @param {DOMRect} rect - the canvas's on-screen box
     */
    toPicture(e, rect) {
      return {
        x: (e.clientX - rect.left) * WIDTH / rect.width,
        y: (e.clientY - rect.top) * HEIGHT / rect.height,
      }
    },
    onDown(e) {
      if (this.pointerId !== null) return
      if (e.pointerType === "mouse" && e.button !== 0) return
      // No preventDefault: the click that follows is what closes an open color picker.
      this.rect = this.$refs.canvas.getBoundingClientRect()
      const p = this.toPicture(e, this.rect)
      if (this.tool === "eyedropper") {
        this.$emit("pick", this.engine.colorAt(p))
        return
      }
      if (this.tool === "bucket") {
        this.engine.fill(p)
        return
      }
      this.$refs.canvas.setPointerCapture(e.pointerId)
      this.pointerId = e.pointerId
      this.engine.start(p, e.shiftKey)
    },
    onMove(e) {
      if (this.pointerId === null) {
        const rect = this.$refs.canvas.getBoundingClientRect()
        const p = this.toPicture(e, rect)
        this.$emit("coords", p)
        if (e.pointerType !== "touch") this.engine.hover(p, WIDTH / rect.width)
        return
      }
      if (e.pointerId !== this.pointerId) return
      // Coalesced events carry the samples between frames, for smoother strokes.
      const samples = e.getCoalescedEvents?.() || []
      for (const sample of samples.length ? samples : [e]) this.engine.move(this.toPicture(sample, this.rect), sample.shiftKey)
      this.$emit("coords", this.toPicture(e, this.rect))
    },
    onUp(e) {
      if (this.pointerId === null || e.pointerId !== this.pointerId) return
      this.pointerId = null
      this.engine.end()
    },
    onLeave() {
      if (this.pointerId !== null) return
      this.engine.leave()
      this.$emit("coords", null)
    },
    undo() {
      this.engine.undo()
    },
    redo() {
      this.engine.redo()
    },
    clear() {
      this.engine.clear()
    },
    reset() {
      this.engine.reset()
    },
    setShift(shift) {
      this.engine.setShift(shift)
    },
    setBackground(hex, options) {
      this.engine.setBackground(hex, options)
    },
    previewBackground(hex) {
      this.engine.previewBackground(hex)
    },
    isBlank() {
      return this.engine.isBlank()
    },
    toBlob() {
      return this.engine.toBlob()
    },
  },
};
</script>
<style scoped>
.paint-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: crosshair;
}

@media (pointer: fine) {
  .paint-canvas--ring {
    cursor: none;
  }
}
</style>
