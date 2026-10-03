// Copyright (2025- ) David C. Morley

// DrawingTurn handles a users turn when drawing
<template>
  <v-card color="transparent" flat>
    <!-- What to draw, on a sticky note: the loudest thing on the screen -->
    <div class="drawing-prompt-row">
      <div class="drawing-prompt">
        <span class="drawing-prompt-label">Draw this</span>
        <span class="hand drawing-prompt-text">{{ prompt }}</span>
      </div>
    </div>
    <v-tabs v-model="tab" class="drawing-tabs" align-tabs="center" color="primary" height="44" hide-slider>
      <v-tab value="draw" prepend-icon="mdi-pencil">Draw Picture</v-tab>
      <v-tab value="upload" prepend-icon="mdi-upload-box-outline">Upload Photo</v-tab>
    </v-tabs>
    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="draw">
        <DrawingBox ref="box" @drawing="saveDrawing" />
      </v-tabs-window-item>
      <v-tabs-window-item value="upload">
        <DrawingUpload ref="upload" @drawing="saveDrawing" />
      </v-tabs-window-item>
    </v-tabs-window>
  </v-card>
</template>

<script>
export default {
  name: "TakeTurn",
  props: ["prompt"],
  data() {
    return {
      tab: 'draw',
    }
  },
  methods: {
    /**
     * saveDrawing accepts a drawing (uploaded or draw) and emits it to PromptTurn
     * @param {Blob} blob - the drawing to save in the database
     */
    saveDrawing(blob) {
      if (!blob) {
        console.log("here")
        this.$emit("snack", "No drawing to submit!", "error")
        return
      }

      this.$emit("drawing", blob)
    },
    async getDrawing() {
      if (this.tab == 'draw') {
        return await this.$refs.box.getDrawing()
      } else {
        return this.$refs.upload.file
      }
    },
  },
};
</script>
<style scoped>
/* Clear of the round timer in the top right corner (see CountdownTimer). The
   note and the tabs together stay as tall as the title and stacked tabs they
   replaced, so the canvas keeps its size. */
.drawing-prompt-row {
  display: flex;
  justify-content: center;
  padding: 10px 132px;
}

.drawing-prompt {
  max-width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  column-gap: 12px;
  padding: 4px 18px;
  color: var(--ink);
  background: rgb(var(--v-theme-secondary));
  border: 2.5px solid var(--ink);
  border-radius: 18px 8px 16px 10px / 10px 16px 8px 18px;
  box-shadow: 4px 4px 0 var(--ink);
  transform: rotate(-1deg);
}

.drawing-prompt-label {
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.drawing-prompt-text {
  font-size: 2rem;
  line-height: 1.25;
  text-align: center;
  white-space: break-spaces;
  overflow-wrap: break-word;
}

@media (max-width: 600px) {
  .drawing-prompt-row {
    justify-content: flex-start;
    padding: 10px 124px 10px 12px;
  }

  .drawing-prompt {
    justify-content: flex-start;
  }

  .drawing-prompt-text {
    font-size: 1.6rem;
    text-align: left;
  }
}

/* Notebook divider tabs on an inked line: the open one white and standing
   taller, the other paper colored. Quieter than the note above. */
.drawing-tabs {
  border-bottom: 2.5px solid var(--ink);
}

.drawing-tabs :deep(.v-slide-group__content) {
  align-items: flex-end;
  gap: 6px;
}

.drawing-tabs :deep(.v-tab.v-tab.v-btn) {
  height: 36px;
  color: var(--ink);
  background: rgb(var(--v-theme-secondary-lighten-3));
  border: 2px solid var(--ink);
  border-bottom: 0;
  border-radius: 14px 10px 0 0 / 12px 12px 0 0;
}

.drawing-tabs :deep(.v-tab.v-tab.v-btn.v-tab--selected) {
  height: 42px;
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-surface));
}
</style>
