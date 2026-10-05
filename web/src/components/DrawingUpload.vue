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
      <div v-if="converting" class="pa-4">
        <v-progress-circular indeterminate color="primary" />
        <v-card-text>Getting your picture ready…</v-card-text>
      </div>
      <label v-else-if="previewSrc == ''" for="fileInput">
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
import { prepareUpload, UnsupportedPicture } from "@/services/uploadImage"

export default {
  name: "UploadPhoto",
  data() {
    return {
      isDragging: false,
      file: null,
      previewSrc: '',
      converting: false,
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
    async onChange() {
      const picked = this.$refs.file.files[0]
      if (!picked) return
      this.converting = true
      try {
        // A HEIC photo becomes a JPEG here, so it shows on every browser.
        this.file = await prepareUpload(picked)
        this.previewSrc = URL.createObjectURL(this.file)
      } catch (e) {
        if (e instanceof UnsupportedPicture) {
          this.$emit("snack", "That kind of picture won't show for everyone. Try a JPEG or PNG", "error")
        } else {
          console.error("couldn't read the picture", e)
          this.$emit("snack", "Couldn't read that picture, try another one", "error")
        }
        this.onClearClicked()
      } finally {
        this.converting = false
      }
    },
    /**
     * onClearClicked clears out the selected file
     */
    onClearClicked() {
      this.file = null;
      this.previewSrc = '';
      // so picking the same file again still counts as a change
      this.$refs.file.value = '';
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
