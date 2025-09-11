// Copyright (2025- ) David C. Morley

// DrawingUpload provides a simple interface to upload & submit pictures
<template>
  <div class="container  overflow-y-auto" style="height: calc(100vh - 124px);" @dragover="onDragover"
    @dragleave="isDragging = false" @drop="onDrop">
    <div v-if="previewSrc" style="height: 70%; justify-items: center; ">
      <v-img :src="previewSrc" width="300" class="ma-4" />
      <v-btn @click="onClearClicked" class="ma-2" color="primary" variant="tonal">
        Clear
      </v-btn>
      <v-btn @click="onSaveClicked" class="ma-2" color="primary" variant="elevated">
        Submit
      </v-btn>
    </div>
    <div>
      <input ref="file" id="fileInput" type="file" accept="image/*" @change="onChange" style="display: none;" />
      <label v-if="previewSrc == ''" for="fileInput">
        <v-card-title v-if="isDragging">Release to upload.</v-card-title>
        <div v-else class="pa-4">
          <v-card-title>Drop your picture here!</v-card-title>
          <v-card-text>or</v-card-text>
          <v-btn @click="$refs.file.click()" color="primary">
            Upload a File
          </v-btn>
        </div>
      </label>
    </div>
  </div>
</template>
<script>
export default {
  name: "UploadPhoto",
  data() {
    return {
      isDragging: false,
      file: null,
      previewSrc: '',
    }
  },
  methods: {
    /**
     * onSaveClicked emits the image blob to DrawingTurn
     */
    onSaveClicked() {
      this.$emit("drawing", this.file)
    },
    /**
     * onChange sets the file after an image is dropped or inputted
     */
    onChange() {
      this.file = this.$refs.file.files[0]
      this.previewSrc = URL.createObjectURL(this.file)
    },
    /**
     * onClearClicked clears out the selected file
     */
    onClearClicked() {
      this.file = null;
      this.previewSrc = '';
    },
    /**
     * onDragover handles the dragover event
     * @param {event} e - the dragover event
     */
    onDragover(e) {
      e.preventDefault();
      this.isDragging = true
    },
    /**
     * onDrop handles the drop event
     * @param {event} e - the drop event
     */
    onDrop(e) {
      e.preventDefault();
      this.$refs.file.files = e.dataTransfer.files;
      this.onChange();
      this.isDragging = false;
    },
  },
}
</script>
<style>
.container {
  align-items: center;
  height: 400;
  justify-content: center;
  text-align: center;
}

.white-box {
  background-color: #FFFFFF;
  /* Sets the background to white */
  border: 1px solid rgb(0, 0, 0);
  width: 70vw;
  height: 200px;
  margin: 20px auto;
  /* Centers the box horizontally with margin */
  padding: 20px;
  /* Adds space between content and box edges */
}
</style>
