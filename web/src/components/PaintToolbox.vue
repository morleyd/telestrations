// Copyright (2025- ) David C. Morley

// PaintToolbox holds the tool buttons, the Behind lines switch, and the tool
// options (size and shape style)
<template>
  <div class="toolbox">
    <div class="toolbox-tools">
      <button v-for="t in tools" :key="t.id" type="button" class="toolbox-tool" :aria-pressed="String(t.id === tool)"
        :aria-label="t.name" :title="t.key ? `${t.name} (${t.key.toUpperCase()})` : t.name"
        @click="$emit('update:tool', t.id)">
        <v-icon :icon="t.icon" size="22" />
      </button>
      <!-- Fills the grid's last row beside the right triangle -->
      <button type="button" class="toolbox-behind" :aria-pressed="String(behind)" title="Behind lines (H)"
        @click="$emit('update:behind', !behind)">
        <v-icon icon="mdi-flip-to-back" size="20" />
        <span>Behind lines</span>
      </button>
    </div>
    <!-- Always holds the sizes and the style, hiding what a tool doesn't use, so
         it stays the same size and nothing around it moves between tools. -->
    <div class="toolbox-options">
      <div class="toolbox-paint" :class="{ 'toolbox-off': hint }">
        <span class="toolbox-label">Size</span>
        <button v-for="(px, i) in sizes" :key="px" type="button" class="toolbox-size"
          :aria-pressed="String(i === size)" :aria-label="`Size ${i + 1}, ${px} pixels`" :title="`Size ${i + 1} (${i + 1})`"
          @click="$emit('update:size', i)">
          <span class="toolbox-dot" :style="{ width: dots[i] + 'px', height: dots[i] + 'px' }" />
        </button>
        <div class="toolbox-style" :class="{ 'toolbox-off': !fillable }">
          <span class="toolbox-label">Style</span>
          <div class="toolbox-styles">
            <button v-for="s in styles" :key="s.id" type="button" class="toolbox-style-btn"
              :aria-pressed="String(s.id === shapeStyle)" :aria-label="s.name" :title="s.name"
              @click="$emit('update:shapeStyle', s.id)">
              <v-icon :icon="s.icon" size="18" />
            </button>
          </div>
        </div>
      </div>
      <p v-if="hint" class="toolbox-hint">{{ hint }}</p>
    </div>
  </div>
</template>
<script>
import { SIZES } from "@/services/paint/engine";
import { FILLABLE_TOOLS, OPTION_HINTS, TOOLS } from "@/services/paint/tools";

export default {
  name: "PaintToolbox",
  props: {
    tool: { type: String, required: true },
    size: { type: Number, required: true },
    shapeStyle: { type: String, required: true },
    behind: { type: Boolean, required: true },
  },
  emits: ["update:tool", "update:size", "update:shapeStyle", "update:behind"],
  data() {
    return {
      tools: TOOLS,
      sizes: SIZES,
      // How big each size looks here
      dots: [4, 7, 11, 15, 20],
      styles: [
        { id: "outline", name: "Outline", icon: "mdi-square-outline" },
        { id: "fill", name: "Filled", icon: "mdi-square" },
      ],
    }
  },
  computed: {
    hint() {
      return OPTION_HINTS[this.tool] || ""
    },
    fillable() {
      return FILLABLE_TOOLS.has(this.tool)
    },
  },
};
</script>
<style scoped>
/* Three tools wide, so the toolbox is no taller than the canvas beside it and
   the colors below stay on screen. */
.toolbox {
  --tool: 40px;
  width: calc(var(--tool) * 3 + 10px + 18px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
  background: rgb(var(--v-theme-secondary-lighten-4));
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  border-radius: 8px;
}

.toolbox button {
  font-family: inherit;
  cursor: pointer;
  touch-action: manipulation;
}

.toolbox button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-tertiary));
  outline-offset: 2px;
}

.toolbox-tools {
  display: grid;
  grid-template-columns: repeat(3, var(--tool));
  gap: 5px;
}

.toolbox-tool {
  width: var(--tool);
  height: var(--tool);
  display: grid;
  place-items: center;
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 6px;
  box-shadow: inset 1px 1px 0 #fff, inset -1px -1px 0 rgba(var(--v-theme-primary), 0.16);
}

.toolbox-tool[aria-pressed="true"],
.toolbox-size[aria-pressed="true"],
.toolbox-style-btn[aria-pressed="true"] {
  color: #fff;
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary-darken-1));
  box-shadow: inset 2px 2px 0 rgba(0, 0, 0, 0.28);
}

.toolbox-options {
  position: relative;
  padding: 6px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 6px;
  box-shadow: inset 1px 1px 2px rgba(var(--v-theme-primary), 0.18);
}

/* Label, the five sizes in a row, then the style */
.toolbox-paint {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  align-items: center;
  gap: 3px;
}

.toolbox-paint > .toolbox-label,
.toolbox-style {
  grid-column: 1 / -1;
}

.toolbox-style {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* Hidden but still taking up its room */
.toolbox-off {
  visibility: hidden;
}

.toolbox-label {
  padding: 2px 2px 0;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.toolbox-hint {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 8px;
  font-size: 12px;
  line-height: 1.35;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.toolbox-size {
  height: 26px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
}

.toolbox-dot {
  display: block;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface));
}

.toolbox-size[aria-pressed="true"] .toolbox-dot {
  background: #fff;
}

.toolbox-styles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.toolbox-style-btn {
  height: 30px;
  display: grid;
  place-items: center;
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 4px;
}

.toolbox-behind {
  grid-column: span 2;
  height: var(--tool);
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.1;
  color: rgb(var(--v-theme-primary-darken-1));
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 6px;
  box-shadow: inset 1px 1px 0 #fff, inset -1px -1px 0 rgba(var(--v-theme-primary), 0.16);
}

.toolbox-behind .v-icon {
  color: rgb(var(--v-theme-tertiary-darken-1));
}

.toolbox-behind[aria-pressed="true"] {
  color: #fff;
  background: rgb(var(--v-theme-tertiary-darken-1));
  border-color: rgb(var(--v-theme-tertiary-darken-2));
  box-shadow: inset 2px 2px 0 rgba(0, 0, 0, 0.25);
}

.toolbox-behind[aria-pressed="true"] .v-icon {
  color: #fff;
}

/* Phones: the toolbox sits under the canvas as rows */
@media (max-width: 760px) {
  /* Everything centered, whether the options sit beside the tools or under them */
  .toolbox {
    --tool: 42px;
    width: auto;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }

  .toolbox-tools {
    grid-template-columns: repeat(5, var(--tool));
  }

  /* Beside the tools when there's room, under them when there isn't */
  .toolbox-options {
    flex: 1 1 200px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .toolbox-paint {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
  }

  .toolbox-paint > .toolbox-label {
    width: 100%;
    text-align: center;
  }

  .toolbox-hint {
    text-align: center;
  }

  .toolbox-size {
    width: 32px;
    height: 32px;
  }

  .toolbox-style {
    flex-direction: row;
    margin-left: 8px;
  }

  .toolbox-style .toolbox-label {
    display: none;
  }

  .toolbox-styles {
    grid-template-columns: 36px 36px;
  }

  .toolbox-style-btn {
    height: 32px;
  }

  .toolbox-behind {
    grid-column: 1 / -1;
    justify-content: center;
    font-size: 12px;
  }
}
</style>
