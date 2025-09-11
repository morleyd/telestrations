<template>
  <v-card class="container overflow-y-auto pa-4" style="height: calc(100vh - 28px); min-height: 300px; ">
    <v-card-title v-if="isFirst">
      Enter your starting prompt:
    </v-card-title>
    <div v-else class="mb-4 d-flex" style="height: 248px;">
      <!-- <span>{{prevUser}}'s' image:</span> -->
      <v-img :src="prevDrawing" width="100%" style="justify-self: center;" />
    </div>
    <v-textarea v-model="prompt" bg-color="white" label="Your Prompt Here..." hide-details />
    <v-btn class="ma-4" color="primary" variant="elevated" size="x-large" @click="onSaveClicked">
      Submit
    </v-btn>
  </v-card>
</template>
<script>
export default {
  name: "UploadPhoto",
  props: ["isFirst"],
  data() {
    return {
      prompt: "",
      prevDrawing: "",
    }
  },
  methods: {
    setDrawing(url) {
      this.prevDrawing = url
    },
    onSaveClicked() {
      if (!this.prompt) {
        this.$emit("snack", "You must enter a prompt!", "error")
        return
      }
      this.$emit("prompt", this.prompt)
    },
  }
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
