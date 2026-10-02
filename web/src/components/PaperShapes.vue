// Copyright (2025- ) David C. Morley

// PaperShapes lays cut-paper shapes on the sketchbook page, peeking in from the
// corners behind everything else (see .v-application in styles/sketchbook.css)
<template>
  <div class="paper-shapes" aria-hidden="true">
    <div class="shape shape--sun" />
    <div class="shape shape--sky" />
    <div class="shape shape--grass" />
    <div class="shape shape--dot" />
  </div>
</template>
<script>
export default {
  name: "PaperShapes",
};
</script>
<style scoped>
.paper-shapes {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.shape {
  position: absolute;
  box-shadow: 0 5px 0 rgba(43, 33, 24, 0.12);
}

.shape--sun {
  top: -70px;
  left: -90px;
  width: clamp(240px, 26vmax, 420px);
  aspect-ratio: 27 / 23;
  background: rgb(var(--v-theme-secondary));
  border-radius: 63% 37% 54% 46% / 55% 48% 52% 45%;
}

.shape--sky {
  bottom: -80px;
  right: -100px;
  width: clamp(280px, 30vmax, 480px);
  aspect-ratio: 32 / 27;
  background: rgb(var(--v-theme-primary));
  border-radius: 42% 58% 38% 62% / 52% 40% 60% 48%;
  box-shadow: 0 -5px 0 rgba(43, 33, 24, 0.12);
}

.shape--grass {
  bottom: 18vh;
  left: -46px;
  width: clamp(110px, 11vmax, 180px);
  aspect-ratio: 12 / 11;
  background: rgb(var(--v-theme-grass));
  border-radius: 55% 45% 62% 38% / 46% 58% 42% 54%;
}

/* Below the page titles */
.shape--dot {
  top: 32%;
  right: 24px;
  width: clamp(40px, 4vmax, 64px);
  aspect-ratio: 1;
  background: rgb(var(--v-theme-tertiary));
  border-radius: 50%;
  box-shadow: 0 4px 0 rgba(43, 33, 24, 0.15);
}
</style>
