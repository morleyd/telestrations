<template>
  <div v-if="duration > 0" class="timer">
    <!-- Time left in blue, time gone in red -->
    <v-progress-circular :size="100" :width="15" :model-value="percentage" color="primary" bg-color="tertiary">
      <span v-if="secondsLeft > 15" :style="dramaticStyling">{{ timeLeft }}</span>
      <div v-else>
        <transition name="fade" mode="out-in">
          <span :key="timeLeft" :style="dramaticStyling">{{ timeLeft }}</span>
        </transition>
      </div>
    </v-progress-circular>
  </div>
</template>

<script>
// A round's timer: counts `duration` seconds down and emits `finished` once.
// No timer for a duration of 0 or less (an untimed game).
export default {
  props: ["duration"],
  emits: ["finished"],
  data() {
    return {
      elapsed: 0,
    }
  },
  computed: {
    secondsLeft() {
      return Math.max(0, this.duration - this.elapsed)
    },
    percentage() {
      return (this.secondsLeft / this.duration) * 100
    },
    dramaticStyling() {
      if (this.secondsLeft < 10) {
        return {
          'font-size': `${2.2 + (10 - this.secondsLeft) / 10}em`,
          'font-weight': `${600 + (10 - this.secondsLeft) * 30}`,
          'color': 'red',
        }
      } else if (this.secondsLeft < 30) {
        return {
          'font-size': '2em',
          'font-weight': '600',
          'color': 'orange',
        }
      } else {
        return { 'font-size': '1.6em', }
      }
    },
    // "1:02:03", "2:03" or "3"
    timeLeft() {
      const s = this.secondsLeft
      const [hours, minutes, seconds] = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
      const pad = (n) => String(n).padStart(2, '0')
      if (hours) return `${hours}:${pad(minutes)}:${pad(seconds)}`
      if (minutes) return `${minutes}:${pad(seconds)}`
      return seconds
    },
  },
  mounted() {
    if (!(this.duration > 0)) return
    this.interval = setInterval(() => {
      if (++this.elapsed < this.duration) return
      clearInterval(this.interval)
      this.$emit("finished")
    }, 1000)
  },
  unmounted() {
    clearInterval(this.interval)
  },
};
</script>
<style scoped>
.timer {
  right: 0;
  top: 48px;
  margin: 16px;
  position: absolute;
  z-index: 1;
  /* A paper sticker, so it reads over the drawing */
  background: rgb(var(--v-theme-surface));
  border-radius: 50%;
  box-shadow: 0 0 0 2.5px var(--ink), 4px 4px 0 2.5px var(--ink);
}

.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-leave-to {
  opacity: 0;
}
</style>
