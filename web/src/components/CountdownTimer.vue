<template>
  <div v-if="duration >= 0" class="timer">
    <v-progress-circular :size="100" :width="15" :model-value="percentage" color="teal">

      <span v-if="timeLeft > 15" :style="dramaticStyling">{{ timeLeft }}</span>
      <div v-else>
        <transition name="scale" mode="out-in">
          <span :key="timeLeft" :style="dramaticStyling">{{ timeLeft }}</span>
        </transition>
      </div>
    </v-progress-circular>
  </div>
</template>

<script>
export default {
  name: "CountdownTimer",
  props: ["duration"],
  data() {
    return {
      interval: {},
      value: 0,
      percentage: 100,
    }
  },
  computed: {
    dramaticStyling() {
      if (this.totalSecondsLeft < 10) {
        return {
          'font-size': `${2.2 + (10 - this.totalSecondsLeft) / 10}em`,
          'font-weight': `${600 + (10 - this.totalSecondsLeft) * 30}`,
          'color': 'red',
        }
      } else if (this.totalSecondsLeft < 30) {
        return {
          'font-size': '2em',
          'font-weight': '600',
          'color': 'orange',
        }
      } else {
        return { 'font-size': '1.6em', }
      }
    },
    totalSecondsLeft() {
      return this.duration - this.value
    },
    timeLeft() {
      let hoursLeft = Math.floor((this.totalSecondsLeft) / 3600)
      let minustesLeft = Math.floor((this.totalSecondsLeft - (hoursLeft * 3600)) / 60)
      let secondsLeft = Math.floor((this.totalSecondsLeft - (minustesLeft * 60 + hoursLeft * 3600)))
      if (hoursLeft > 0) {
        return `${hoursLeft}:${String(minustesLeft).padStart(2, '0')}:${String(secondsLeft).padStart(2, '0')}`
      } else if (minustesLeft > 0) {
        return `${minustesLeft}:${String(secondsLeft).padStart(2, '0')}`
      } else {
        return secondsLeft
      }
    },
  },
  async mounted() {
    this.interval = setInterval(() => {
      if (this.percentage <= 0) {
        clearInterval(this.interval)
        this.$emit("finished")
        this.percentage = 0
        this.value = this.duration
      } else {
        this.value += 1
        this.percentage = 100 - Math.ceil((this.value / this.duration) * 100)
      }
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
}

.scale-enter-active,
.scale-leave-active {
  transition: opacity 0.2s ease;
}

.scale-enter-from {
  opacity: 1;
}

.scale-enter-to {
  opacity: 1;
}

.scale-leave-from {
  opacity: 1;
}

.scale-leave-to {
  opacity: 0;
}
</style>
