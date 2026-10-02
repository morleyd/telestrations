// Copyright (2025- ) David C. Morley

// PaintPalette shows the pen and background colors, the palette, recent custom
// colors, and a full color picker. A tapped color applies straight away.
<template>
  <div class="palette">
    <div class="palette-now">
      <button type="button" class="palette-sq palette-sq--bg" :style="{ background: bgColor }"
        :aria-pressed="String(target === 'bg')" aria-label="Background color"
        title="Background color: tap, then pick a color" @click="$emit('update:target', target === 'bg' ? 'pen' : 'bg')" />
      <button type="button" class="palette-sq palette-sq--pen" :style="{ background: color }"
        :aria-pressed="String(target === 'pen')" aria-label="Pen color" title="Pen color"
        @click="$emit('update:target', 'pen')" />
    </div>
    <div class="palette-scroll">
      <div class="palette-grid">
        <button v-for="c in palette" :key="c.hex" type="button" class="palette-sw" :style="{ '--c': c.hex }"
          :aria-pressed="String(c.hex === current)" :aria-label="c.name" :title="c.name"
          @click="$emit('pick', c.hex, target)" @contextmenu.prevent="$emit('pick', c.hex, 'bg')" />
      </div>
    </div>
    <!-- Four slots are always there, so the palette doesn't shift when the first custom color arrives. -->
    <div class="palette-grid palette-recents" role="group" aria-label="Recent colors">
      <template v-for="i in 4" :key="i">
        <button v-if="recents[i - 1]" type="button" class="palette-sw" :style="{ '--c': recents[i - 1] }"
          :aria-pressed="String(recents[i - 1] === current)" :aria-label="`Recent color ${recents[i - 1]}`"
          :title="recents[i - 1]" @click="$emit('pick', recents[i - 1], target)"
          @contextmenu.prevent="$emit('pick', recents[i - 1], 'bg')" />
        <span v-else class="palette-empty" aria-hidden="true" />
      </template>
    </div>
    <v-menu v-model="pickerOpen" :close-on-content-click="false" location="top">
      <template #activator="{ props: menu }">
        <button v-bind="menu" type="button" class="palette-more" aria-label="More colors" title="More colors">
          <span><v-icon icon="mdi-plus" size="18" /></span>
        </button>
      </template>
      <v-card class="pa-2">
        <v-color-picker v-model="pickerColor" mode="hex" :modes="['hex']" elevation="0" />
        <div class="d-flex justify-end px-2 pb-1">
          <v-btn color="primary" variant="tonal" @click="pickerOpen = false">Done</v-btn>
        </div>
      </v-card>
    </v-menu>
    <span class="palette-hint">Right-click a color to make it the background.</span>
  </div>
</template>
<script>
import { PALETTE, PALETTE_HEX } from "@/services/paint/palette";

const RECENTS_KEY = "telestrations.paint.recentColors"

function loadRecents() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]")
    return Array.isArray(saved) ? saved.filter((h) => /^#[0-9A-F]{6}$/.test(h)).slice(0, 4) : []
  } catch {
    return []
  }
}

export default {
  name: "PaintPalette",
  props: {
    color: { type: String, required: true },
    bgColor: { type: String, required: true },
    // Which color the palette sets: "pen" or "bg"
    target: { type: String, required: true },
  },
  // pick(hex, target): a color was chosen. preview(hex, target): the picker is
  // showing a color that isn't chosen yet.
  emits: ["pick", "preview", "update:target"],
  data() {
    return {
      palette: PALETTE,
      // Remembered on this device, so custom colors carry over between turns
      recents: loadRecents(),
      pickerOpen: false,
      pickerColor: "#000000",
      pickerTarget: "pen",
      pickerStart: "",
    }
  },
  computed: {
    current() {
      return this.target === "bg" ? this.bgColor : this.color
    },
  },
  watch: {
    // A color that isn't in the palette (from the eyedropper, say) becomes a recent one.
    color(hex) {
      if (!this.pickerOpen) this.addRecent(hex)
    },
    pickerOpen(open) {
      if (open) {
        this.pickerTarget = this.target
        this.pickerStart = this.current
        this.pickerColor = this.current
        return
      }
      const hex = this.pickerColor.toUpperCase()
      if (hex !== this.pickerStart) {
        this.$emit("pick", hex, this.pickerTarget)
        this.addRecent(hex)
      }
    },
    pickerColor(hex) {
      if (this.pickerOpen) this.$emit("preview", hex.toUpperCase(), this.pickerTarget)
    },
  },
  methods: {
    /**
     * addRecent puts a custom color first in the recent colors
     * @param {string} hex - the color
     */
    addRecent(hex) {
      if (PALETTE_HEX.has(hex) || this.recents[0] === hex) return
      this.recents = [hex, ...this.recents.filter((h) => h !== hex)].slice(0, 4)
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(this.recents))
      } catch {
        // Storage can be full or blocked; the colors just won't be remembered.
      }
    },
  },
};
</script>
<style scoped>
.palette {
  --sw: 24px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  background: rgb(var(--v-theme-secondary-lighten-4));
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  border-radius: 8px;
}

.palette button {
  padding: 0;
  cursor: pointer;
  touch-action: manipulation;
}

.palette button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-tertiary));
  outline-offset: 2px;
}

.palette-now {
  position: relative;
  flex: none;
  width: 50px;
  height: 50px;
}

.palette-sq {
  position: absolute;
  width: 32px;
  height: 32px;
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.7);
}

.palette-sq--pen {
  top: 0;
  left: 0;
  z-index: 2;
}

.palette-sq--bg {
  right: 0;
  bottom: 0;
  z-index: 1;
}

.palette-sq[aria-pressed="true"] {
  z-index: 3;
  outline: 3px solid rgb(var(--v-theme-tertiary));
  outline-offset: 1px;
}

.palette-scroll {
  max-width: 100%;
  padding: 3px;
  overflow-x: auto;
}

.palette-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(2, var(--sw));
  grid-auto-columns: var(--sw);
  gap: 3px;
}

.palette-sw {
  width: var(--sw);
  height: var(--sw);
  background: var(--c);
  border: 1px solid rgba(0, 0, 0, 0.45);
  border-radius: 3px;
  box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.45), inset -1px -1px 0 rgba(0, 0, 0, 0.14);
}

.palette-sw[aria-pressed="true"] {
  outline: 2px solid rgb(var(--v-theme-primary-darken-1));
  outline-offset: 2px;
}

.palette-empty {
  width: var(--sw);
  height: var(--sw);
  background: rgba(255, 255, 255, 0.35);
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
  border-radius: 3px;
}

.palette-more {
  flex: none;
  width: calc(var(--sw) * 2 + 3px);
  height: calc(var(--sw) * 2 + 3px);
  display: grid;
  place-items: center;
  background: conic-gradient(from 90deg, #ff3b3b, #ffd93b, #52e05a, #3be0e0, #3b6bff, #d93bff, #ff3b3b);
  border: 1px solid rgba(0, 0, 0, 0.45);
  border-radius: 6px;
}

.palette-more span {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  color: rgb(var(--v-theme-primary-darken-1));
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.palette-hint {
  flex: 1 1 140px;
  min-width: 0;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Phones: four rows, so each color family sits in one column */
@media (max-width: 760px) {
  .palette {
    --sw: 27px;
    justify-content: center;
  }

  .palette-scroll .palette-grid {
    grid-template-rows: repeat(4, var(--sw));
  }

  .palette-hint {
    display: none;
  }
}
</style>
