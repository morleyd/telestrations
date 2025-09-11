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
        <div v-if="isDragging">Release to upload.</div>
        <div v-else class="pa-4">
          <v-card-title>Drop your picture here!</v-card-title>
          <!-- <v-textarea class="border-md" disabled hide-details bg-color="white" /> -->
          <!-- <div class="white-box"></div> -->
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
    onSaveClicked(){
      this.$emit("drawing", this.file)
    },
    onChange() {
      this.file = this.$refs.file.files[0]
      console.log("file",this.file)
      this.previewSrc = URL.createObjectURL(this.file)
    },
    onClearClicked() {
      this.file = null;
      this.previewSrc = '';
    },
    onDragover(e) {
      e.preventDefault();
      this.isDragging = true
    },
    onDrop(e) {
      e.preventDefault();
      console.log("onDrop", e.dataTransfer.files[0])
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
