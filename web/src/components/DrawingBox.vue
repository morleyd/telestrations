// Copyright (2025- ) David C. Morley

// DrawingBox provides a simple interface to draw & submit pictures
<template>
  <v-card class="py-4 overflow-y-auto elevation-0 justify-center"
    style="justify-items: center; justify-self: center;justify-content: center; display: grid;"
    max-height="calc(100vh - 124px)" width="100vw">
    <div class="flex-grow-1 d-flex justify-center align-center">
      <div class="canvas-wrapper">
        <vue-drawing-canvas ref="canvas" v-model:image="image" :width="canvasWidth" :height="canvasHeight"
          :stroke-type="strokeType" :line-cap="lineCap" :line-join="lineJoin" :eraser="eraser" :lineWidth="lineWidth"
          :color="color" :background-color="bgColor" :fill-shape="true" saveAs="png" :styles="{
            border: 'solid 1px #000',
          }" />
      </div>
    </div>
    <div class="actions-row">
      <div class="actions-inner pa-4 d-flex">
        <v-select v-model="strokeType" class="ms-4" :items="strokes" item-title="title" item-value="value"
          density="compact" hide-details label="Stroke">
        </v-select>
        <v-btn v-if="eraser" icon="mdi-eraser" color="tertiary" variant="elevated" size="small"
          @click.prevent="eraser = !eraser" />
        <v-btn v-else icon="mdi-pencil" color="tertiary" variant="elevated" size="small"
          @click.prevent="eraser = !eraser" />
        <div style="justify-items: center;">
          <p style="margin-bottom: 0">Color:</p>
          <ColorPicker @selected="onColorSelect" parent="line" :initialColor="color" />
        </div>
        <div style="display: flex; height: 53.5px;">
          <v-btn icon="mdi-minus" variant="tonal" size="x-small" color="black" style="align-self: center;"
            @click="decreaseLine" />
          <div class="mx-2" :style="lineWidthStyle">
            <v-icon :size="lineWidth + 'px'" :color="color">mdi-circle</v-icon>
          </div>
          <v-btn icon="mdi-plus" variant="tonal" size="x-small" color="black" style="align-self: center;"
            @click="increaseLine" />
        </div>
        <div style="justify-items: center; text-align: center;">
          <p style="margin-bottom: 0">Background:</p>
          <ColorPicker @selected="onColorSelect" parent="background" :initialColor="bgColor" />
        </div>
        <v-btn prepend-icon="mdi-undo" color="black" variant="tonal" @click="$refs.canvas.undo()">
          Undo
        </v-btn>
        <v-btn prepend-icon="mdi-redo" color="black" variant="tonal" @click="$refs.canvas.redo()">
          Redo
        </v-btn>
        <v-btn prepend-icon="mdi-refresh" color="black" variant="tonal" @click="$refs.canvas.reset()">
          Clear
        </v-btn>
      </div>
    </div>
    <div class="actions-row" :class="$vuetify.display.smAndDown ? 'safe-bottom': ''" style="display: flex; justify-content: center;">
      <v-btn prepend-icon="mdi-content-save" size="x-large" variant="elevated" color="primary" @click="onSaveClicked">
        Submit
      </v-btn>
    </div>
  </v-card>
</template>
<script>
import VueDrawingCanvas from "vue-drawing-canvas";
export default {
  name: "Draw",
  components: {
    VueDrawingCanvas,
  },
  data() {
    return {
      image: "",
      eraser: false,
      disabled: false,
      fillShape: false,
      lineWidth: 5,
      color: "#000000",
      strokeType: "dash",
      lineCap: "round", // options are round, square, butt
      lineJoin: "round", // options are round, miter, bevel
      bgColor: "#FFFFFF",
      strokes: [
        { value: "dash", title: "Draw" },
        { value: "line", title: "Straight Line" },
        { value: "circle", title: "Circle" },
        { value: "square", title: "Square" },
        { value: "triangle", title: "Triangle" },
        { value: "half_triangle", title: "Right Triangle" },
      ],
    };
  },
  computed: {
    lineWidthStyle() {
      return {
        "text-align": "center",
        "align-content": "center",
        "height": "53.5px",
        "width": "53.5px",
        "border": "solid 1px",
        "border-color": this.color,
        "background-color": this.bgColor,
      }
    },
    bestRatio() {
      // Subtract 32 for horizontal margins
      let wRatio = (this.$vuetify.display.width - 32) / 600
      // Subtract 332 for all the vertical components, but make sure it's atleast 160px
      let hRatio = (Math.max(this.$vuetify.display.height - 332, 160)) / 400
      return Math.min(wRatio, hRatio)
    },
    canvasWidth() {
      return 600 * this.bestRatio
    },
    canvasHeight() {
      return 400 * this.bestRatio
    },
    size() {
      let size = {
        smAndDown: this.$vuetify.display.smAndDown,
        xs: this.$vuetify.display.xs,
        sm: this.$vuetify.display.sm,
        md: this.$vuetify.display.md,
        lg: this.$vuetify.display.lg,
        xl: this.$vuetify.display.xl,
        xxl: this.$vuetify.display.xxl,
      }
      console.log("size", size)
      return size
    },
  },
  mounted() {
      let size = {
        smAndDown: this.$vuetify.display.smAndDown,
        xs: this.$vuetify.display.xs,
        sm: this.$vuetify.display.sm,
        md: this.$vuetify.display.md,
        lg: this.$vuetify.display.lg,
        xl: this.$vuetify.display.xl,
        xxl: this.$vuetify.display.xxl,
      }
      console.log("size", size)
  },
  methods: {
    /**
     * onColorSelect accepts an emitted color from ColorPicker
     * @param {string} hex - the hexcode color selected
     * @param {string} parent - the target for where the color attaches to
     */
    onColorSelect(hex, parent) {
      switch (parent) {
        case "line":
          this.color = hex
          break;
        case "background":
          this.bgColor = hex
          this.$nextTick(() => {
            this.$refs.canvas.redraw();
          })
          break;
        default:
          console.error("bad color target", parent)
          break;
      }
    },
    async getDrawing() {
      function base64ToBlob(base64, mimeType) {
        // Extract the base64 data part (remove "data:image/png;base64," prefix if present)
        const base64Data = base64.split(',')[1] || base64;
        const byteCharacters = atob(base64Data); // Decode base64 string
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
      }

      let strokes = this.$refs.canvas.getAllStrokes()
      if (!strokes.length) {
        return null
      } else {
        let raw = await this.$refs.canvas.save()
        return base64ToBlob(raw, "image/png");
      }
    },
    /**
     * onSaveClicked converts the drawing to an image and emits it to DrawingTurn
     */
    async onSaveClicked() {
      let blob = await this.getDrawing()
      this.$emit("drawing", blob)

      this.$refs.canvas.reset()
    },
    /**
     * decreaseLine is a helper function to change the line size
     */
    decreaseLine() {
      if (this.lineWidth > 1) {
        this.lineWidth -= 2
      }
    },
    /**
     * increaseLine is a helper function to change the line size
     */
    increaseLine() {
      if (this.lineWidth < 25) {
        this.lineWidth += 2
      }
    },
  },
};
</script>
<style scoped>
.v-card {
  width: 100vw;
  height: 100vh;
}

.canvas-wrapper {
  flex: 1;
  width: 90%;
  /* responsive width */
  max-height: 80%;
  /* don’t exceed 80% of card height */
  aspect-ratio: 16 / 9;
  /* lock ratio */
  display: flex;
  align-items: center;
  justify-content: center;
}

.actions-row {
  height: 85px;
  width: 840px;
  overflow-x: auto;
  overflow-y: clip;
  display: block;
  max-width: 100vw;
}

.actions-inner {
  min-width: 840px;
  gap: .5em;
}

.safe-bottom {
  margin-bottom: 64px;
}
</style>
