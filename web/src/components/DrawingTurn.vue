// Copyright (2025- ) David C. Morley

// DrawingTurn handles a users turn when drawing
<template>
  <v-card>
    <v-card-title style="text-align: center; white-space: break-spaces; word-break: normal; word-wrap: break-word;">
      {{ prompt }}
    </v-card-title>
    <v-tabs v-model="tab" align-tabs="center" stacked bg-color="secondary">
      <v-tab value="draw"><v-icon icon="mdi-pencil" />Draw Picture</v-tab>
      <v-tab value="upload"><v-icon icon="mdi-upload-box-outline" />Upload Photo</v-tab>
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
