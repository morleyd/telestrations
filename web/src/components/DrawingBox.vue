// Copyright (2025- ) David C. Morley

// DrawingBox is the drawing turn's paint program: tools on the left, the canvas,
// colors along the bottom, and Undo / Redo / Clear / Submit across the top
<template>
  <v-card class="paint py-3 px-4 overflow-y-auto" color="transparent" flat max-height="calc(100vh - 124px)" width="100vw"
    :style="{ '--paint-canvas': layout.canvas + 'px' }">
    <div class="paint-inner">
      <div class="paint-head">
        <div class="paint-edits">
          <v-btn v-for="b in edits" :key="b.label" :prepend-icon="compact ? undefined : b.icon"
            :icon="compact ? b.icon : undefined" :text="compact ? undefined : b.label" :aria-label="b.label"
            :title="b.title" :disabled="b.disabled" color="black" variant="tonal" @click="b.run" />
        </div>
        <v-btn prepend-icon="mdi-content-save" :size="compact ? 'default' : 'large'" variant="elevated" color="primary"
          @click="onSaveClicked">
          Submit
        </v-btn>
      </div>
      <div class="paint-studio" :class="{ 'paint-studio--help': layout.help }">
        <PaintToolbox v-model:tool="tool" v-model:size="size" v-model:shape-style="shapeStyle" v-model:behind="behind"
          class="paint-tools" />
        <div class="paint-stage">
          <div class="paint-frame" :class="{ 'paint-frame--behind': behind }">
            <PaintCanvas ref="canvas" :tool="tool" :color="color" :size="size" :shape-style="shapeStyle"
              :behind="behind" @change="onCanvasChange" @pick="onEyedropper" @coords="coords = $event" />
          </div>
          <div class="paint-status">
            <span class="paint-field paint-field--hint">{{ statusText }}</span>
            <span v-if="behind" class="paint-field paint-field--behind">Behind lines</span>
            <span class="paint-field paint-field--mono paint-coords">{{ coordsText }}</span>
            <span class="paint-field paint-field--mono paint-dims">1200 × 800 px</span>
          </div>
        </div>
        <PaintHelp v-if="layout.help" class="paint-help" />
        <PaintPalette v-model:target="target" class="paint-colors" :color="color" :bg-color="bgColor"
          @pick="onPick" @preview="onPreview" @preview-end="onPreviewEnd" />
      </div>
    </div>
  </v-card>
</template>
<script>
import { HEIGHT, SIZES, WIDTH } from "@/services/paint/engine";
import { SHAPE_TOOLS, TOOLS, TOOL_BY_ID } from "@/services/paint/tools";

// Layout sizes, in CSS pixels, that the canvas has to fit around
const PHONE = 760 // at or below this width, everything stacks under the canvas
const SIDE_PADDING = 32
const GAP = 12
const TOOLBOX = 148
const HELP = 260
// Everything above or below the canvas inside this box: padding, the buttons
// along the top, the status line and the colors
const ABOVE_AND_BELOW = 205
const MIN_CANVAS = 360

export default {
  name: "Draw",
  emits: ["drawing"],
  data() {
    return {
      tool: "brush",
      // The tool to go back to after the eyedropper
      prevTool: "brush",
      size: 1,
      shapeStyle: "outline",
      behind: false,
      color: "#000000",
      bgColor: "#FFFFFF",
      // Which color the palette sets: "pen" or "bg"
      target: "pen",
      canUndo: false,
      canRedo: false,
      coords: null,
      // Where this box starts on the page, and the window's size, which size the canvas to fit the screen
      top: 168,
      viewWidth: 1280,
      viewHeight: 720,
      phone: false,
    };
  },
  computed: {
    compact() {
      return this.$vuetify.display.xs
    },
    /**
     * layout sizes the canvas as big as fits, at the picture's 3:2, and shows
     * the tips beside it when the canvas is limited by height and leaves room
     */
    layout() {
      if (this.phone) return { canvas: this.viewWidth - SIDE_PADDING, help: false }
      const byHeight = Math.max(0, this.viewHeight - this.top - ABOVE_AND_BELOW) * 1.5
      const beside = this.viewWidth - SIDE_PADDING - TOOLBOX - GAP
      const help = beside - byHeight >= HELP + GAP
      const canvas = Math.min(byHeight, beside - (help ? HELP + GAP : 0))
      return { canvas: Math.floor(Math.max(MIN_CANVAS, canvas)), help }
    },
    edits() {
      return [
        { label: "Undo", icon: "mdi-undo", title: "Undo (Ctrl+Z)", disabled: !this.canUndo, run: () => this.$refs.canvas.undo() },
        { label: "Redo", icon: "mdi-redo", title: "Redo (Ctrl+Y or Ctrl+Shift+Z)", disabled: !this.canRedo, run: () => this.$refs.canvas.redo() },
        { label: "Clear", icon: "mdi-refresh", title: "Clear the drawing (Undo brings it back)", disabled: false, run: () => this.$refs.canvas.clear() },
      ]
    },
    statusText() {
      if (this.target === "bg") return "Pick a color for the background."
      if (this.tool === "eraser" && this.behind) return "Drag to erase color. The lines stay."
      const hint = TOOL_BY_ID[this.tool].hint
      return this.behind && this.tool !== "eyedropper" ? `${hint} It goes behind the lines.` : hint
    },
    coordsText() {
      if (!this.coords) return "–"
      const x = Math.round(Math.max(0, Math.min(WIDTH, this.coords.x)))
      const y = Math.round(Math.max(0, Math.min(HEIGHT, this.coords.y)))
      return `${x}, ${y} px`
    },
  },
  watch: {
    tool(next, prev) {
      if (next === "eyedropper" && prev !== "eyedropper") this.prevTool = prev
    },
  },
  mounted() {
    window.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("keyup", this.onKeyUp)
    window.addEventListener("resize", this.measure)
    this.measure()
    // The prompt above is in a web font: once it loads, the prompt can wrap
    // differently and move this box
    document.fonts?.ready.then(() => {
      if (this.$el?.isConnected) this.measure()
    })
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("keyup", this.onKeyUp)
    window.removeEventListener("resize", this.measure)
  },
  methods: {
    /**
     * measure finds where the box starts below the prompt and tabs (a long
     * prompt wraps) and how big the window is, so the canvas fits on screen
     */
    measure() {
      this.top = Math.round(this.$el.getBoundingClientRect().top + window.scrollY)
      // Without the scrollbar, which the window's own width includes
      this.viewWidth = document.documentElement.clientWidth
      this.viewHeight = window.innerHeight
      // The same test as the stylesheet's phone rules
      this.phone = window.matchMedia(`(max-width: ${PHONE}px)`).matches
    },
    /**
     * onPick applies a chosen color from the palette
     * @param {string} hex - the color
     * @param {string} target - "pen" or "bg"
     */
    onPick(hex, target) {
      if (target === "bg") {
        this.$refs.canvas.setBackground(hex)
        this.target = "pen"
        return
      }
      this.setPen(hex)
    },
    /**
     * onPreview shows a color the picker is on. A pen color applies at once; a
     * background is recorded when the picker closes (see onPreviewEnd).
     * @param {string} hex - the color
     * @param {string} target - "pen" or "bg"
     */
    onPreview(hex, target) {
      if (target === "bg") this.$refs.canvas.previewBackground(hex)
      else this.setPen(hex)
    },
    /**
     * onPreviewEnd keeps the background the picker was showing, as one step,
     * and hands the palette back to the pen
     * @param {string} target - "pen" or "bg"
     */
    onPreviewEnd(target) {
      if (target !== "bg") return
      this.$refs.canvas.endPreview()
      this.target = "pen"
    },
    setPen(hex) {
      this.color = hex
      // Picking a color means drawing with it
      if (this.tool === "eraser") this.tool = "brush"
      else if (this.tool === "eyedropper") this.tool = this.prevTool
    },
    onEyedropper(hex) {
      this.target = "pen"
      this.setPen(hex)
    },
    onCanvasChange({ canUndo, canRedo, bg }) {
      this.canUndo = canUndo
      this.canRedo = canRedo
      this.bgColor = bg
    },
    onKeyDown(e) {
      // Only while this drawing is on screen, and not while typing in a field
      if (!this.$el.offsetParent || e.target.closest?.("input, textarea, [contenteditable]")) return
      const key = e.key.toLowerCase()
      const mod = e.metaKey || e.ctrlKey
      if (mod && key === "z") {
        e.preventDefault()
        if (e.shiftKey) this.$refs.canvas.redo()
        else this.$refs.canvas.undo()
        return
      }
      if (mod && key === "y") {
        e.preventDefault()
        this.$refs.canvas.redo()
        return
      }
      if (e.key === "Shift") {
        this.$refs.canvas.setShift(true)
        return
      }
      if (mod || e.altKey) return
      const tool = TOOLS.find((t) => t.key && t.key === key)
      if (tool) this.tool = tool.id
      else if (key === "h") this.behind = !this.behind
      else if (key === "[" || key === "]") this.size = Math.max(0, Math.min(SIZES.length - 1, this.size + (key === "]" ? 1 : -1)))
      else if (/^[1-9]$/.test(key) && Number(key) <= SIZES.length) this.size = Number(key) - 1
    },
    onKeyUp(e) {
      if (e.key === "Shift" && SHAPE_TOOLS.has(this.tool)) this.$refs.canvas.setShift(false)
    },
    /**
     * getDrawing returns the picture as a PNG, or null when nothing is drawn.
     * A stroke still being drawn counts: the timer can run out mid-stroke.
     */
    async getDrawing() {
      this.$refs.canvas.finish()
      if (this.$refs.canvas.isBlank()) return null
      return await this.$refs.canvas.toBlob()
    },
    /**
     * onSaveClicked converts the drawing to an image and emits it to DrawingTurn
     */
    async onSaveClicked() {
      let blob = await this.getDrawing()
      this.$emit("drawing", blob)

      this.$refs.canvas.reset()
    },
  },
};
</script>
<style scoped>
/* Only as wide as the tools, canvas and tips, and centered, so the buttons
   along the top line up with their edges */
.paint-inner {
  width: fit-content;
  max-width: 100%;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.paint-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.paint-edits {
  display: flex;
  gap: 8px;
}

.paint-studio {
  display: grid;
  gap: 12px;
  grid-template-columns: auto auto;
  grid-template-areas: "tools stage" "colors colors";
}

.paint-studio--help {
  grid-template-columns: auto auto 260px;
  grid-template-areas: "tools stage help" "colors colors colors";
}

.paint-tools {
  grid-area: tools;
  align-self: start;
}

.paint-stage {
  grid-area: stage;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Sized in the script (see layout), to fit the screen at the picture's 3:2 */
.paint-frame,
.paint-status {
  width: var(--paint-canvas);
}

/* The tips and the colors fill the room they're given, and never widen or
   heighten the rows: the tips scroll if the canvas is short. */
.paint-help {
  grid-area: help;
  height: 0;
  min-height: 100%;
}

.paint-frame {
  aspect-ratio: 3 / 2;
  border: 1px solid #000;
}

.paint-frame--behind {
  outline: 3px dashed rgb(var(--v-theme-tertiary));
  outline-offset: 3px;
}

.paint-status {
  display: flex;
  gap: 6px;
  font-size: 12px;
}

.paint-field {
  padding: 2px 8px;
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgb(var(--v-theme-secondary-lighten-4));
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  border-radius: 4px;
}

.paint-field--hint {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgb(var(--v-theme-on-surface));
}

.paint-field--behind {
  font-weight: 500;
  color: rgb(var(--v-theme-tertiary-darken-1));
  background: rgb(var(--v-theme-tertiary-lighten-3));
  border-color: rgb(var(--v-theme-tertiary));
}

.paint-field--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.paint-colors {
  grid-area: colors;
  width: 0;
  min-width: 100%;
}

@media (pointer: coarse) {
  .paint-coords {
    display: none;
  }
}

/* Phones: canvas first, then the tools and colors under it */
@media (max-width: 760px) {
  .paint-inner {
    width: 100%;
  }

  .paint-studio {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "stage" "tools" "colors";
  }

  .paint-frame,
  .paint-status {
    width: 100%;
  }

  .paint-dims {
    display: none;
  }

  .paint-colors {
    margin-bottom: 64px;
  }
}
</style>
