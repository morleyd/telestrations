// Copyright (2025- ) David C. Morley

// PaintHelp is the tips and keyboard shortcuts beside the canvas, shown when
// the screen has room for them
<template>
  <aside class="help" aria-label="Drawing tips">
    <h2 class="help-title">Tips</h2>
    <ul class="help-tips">
      <li><strong>Fill:</strong> tap inside a closed shape. If color leaks out through a gap, press Undo.</li>
      <li><strong>Behind lines:</strong> color under your outlines without covering them.</li>
      <li><strong>Background:</strong> tap the back color square, then a color.</li>
      <li><strong>Eyedropper:</strong> picks up a color from your drawing.</li>
    </ul>
    <ul class="help-keys" aria-label="Keyboard shortcuts">
      <li v-for="k in keys" :key="k.keys"><kbd>{{ k.keys }}</kbd> {{ k.does }}</li>
    </ul>
  </aside>
</template>
<script>
import { SIZES } from "@/services/paint/engine";
import { TOOLS } from "@/services/paint/tools";

export default {
  name: "PaintHelp",
  data() {
    return {
      // From the tool list itself, so a new or renamed tool shows up here.
      keys: [
        ...TOOLS.filter((t) => t.key).map((t) => ({ keys: t.key.toUpperCase(), does: t.name })),
        { keys: "H", does: "Behind lines" },
        { keys: `[ ] 1–${SIZES.length}`, does: "Size" },
        { keys: "Shift", does: "Snap shape" },
        { keys: "Ctrl Z", does: "Undo" },
        { keys: "Ctrl Y", does: "Redo" },
      ],
    }
  },
};
</script>
<style scoped>
.help {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.4;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  border-radius: 8px;
}

.help-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: rgb(var(--v-theme-primary-darken-1));
}

.help-tips {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 6px;
}

.help-tips li::marker {
  color: rgb(var(--v-theme-tertiary));
}

/* Shortcuts wrap as a run of short items, to stay inside the canvas's height */
.help-keys {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
}

.help-keys li {
  white-space: nowrap;
}

kbd {
  padding: 0 5px;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: rgb(var(--v-theme-primary-darken-1));
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-bottom-width: 2px;
  border-radius: 4px;
}

/* No keyboard to speak of on a touch screen */
@media (hover: none) and (pointer: coarse) {
  .help-keys {
    display: none;
  }
}
</style>
