<!-- A game's settings: rounds (or Infinite) and an optional turn timer. Used in
     a v-form by the New Game dialog and the host's Play Again; the value is
     services/settings' shape, and Enter in any field emits `submit`. -->
<template>
  <!-- How many times each story goes round the group. Infinite goes on until
       the host ends the game. -->
  <v-row class="mx-4 mt-2 ga-4 align-center">
    <v-number-input v-if="!endless" v-model="rounds" label="Rounds" :min="1" :step="1"
      hint="Times each story goes around the group" persistent-hint :rules="[roundsRule]"
      @keyup.enter="$emit('submit')" />
    <v-text-field v-else model-value="∞" label="Rounds" hint="Until the host ends the game" persistent-hint
      disabled />
    <v-checkbox v-model="endless" label="Infinite" color="primary" hide-details style="flex: none;" />
  </v-row>
  <v-row class="pa-2" style="justify-content: center;">
    <v-switch v-model="timed" color="primary" label="Set Timed Rounds" hide-details />
  </v-row>
  <v-row v-if="timed" class="mx-4 ga-4">
    <v-text-field v-model="timeValue" type="number" label="Round Duration" @keyup.enter="$emit('submit')"
      :rules="[v => (v !== null && v !== undefined && String(v).trim() !== '' && Number(v) > 0) || 'Duration must be a positive number!']" />
    <v-select v-model="timeUnit" label="Unit" :items="['Seconds', 'Minutes', 'Hours']"
      @keyup.enter="$emit('submit')" :rules="[v => !!v?.trim() || 'Time Unit cannot be empty!']" />
  </v-row>
</template>
<script>
import { VNumberInput } from 'vuetify/labs/VNumberInput'

// A computed field of the settings object that emits a new object when set.
const field = (name) => ({
  get() {
    return this.modelValue[name]
  },
  set(value) {
    this.$emit("update:modelValue", { ...this.modelValue, [name]: value })
  },
})

export default {
  name: "GameSettings",
  components: { VNumberInput },
  props: { modelValue: { type: Object, required: true } },
  emits: ["update:modelValue", "submit"],
  computed: {
    rounds: field("rounds"),
    endless: field("endless"),
    timed: field("timed"),
    timeValue: field("timeValue"),
    timeUnit: field("timeUnit"),
  },
  methods: {
    roundsRule(v) {
      const n = Number(v)
      return (v !== null && v !== "" && Number.isInteger(n) && n >= 1) || "Rounds must be a whole number, 1 or more!"
    },
  },
}
</script>
