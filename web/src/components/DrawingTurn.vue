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
        <DrawingBox @drawing="saveDrawing" />
      </v-tabs-window-item>
      <v-tabs-window-item value="upload">
        <DrawingUpload @drawing="saveDrawing" />
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
      // prompt: "this is my very long prompt this is my very long prompt this is my very long prompt this is my very long prompt this is my very long prompt this is my very long prompt"
    }
  },
  methods: {
    async saveDrawing(blob) {
      console.log("saveDrawing", blob)
      this.$emit("drawing", blob)
    },
  },
};
</script>
