<!-- AddBots lets the host seat AI players before the game starts: pick a model,
     give them a personality, a drawing style, and how many seats. Shows
     nothing unless the server has an AI configured (ai.json; see ai.go). -->
<template>
  <template v-if="modelItems.length">
    <v-btn prepend-icon="mdi-robot-happy-outline" size="x-large" variant="tonal" color="secondary" @click="open">
      Add AI players
    </v-btn>
    <v-dialog v-model="visible" max-width="500">
      <v-card class="pa-4 bg-white" width="500" max-width="100%">
        <v-card-title class="text-center text-h5">Add AI players</v-card-title>
        <v-alert v-if="error" class="ma-2" type="error" density="compact" :text="error" />
        <v-form ref="form" class="pa-2" @submit.prevent="add">
          <v-select v-model="model" :items="modelItems" label="AI model" />
          <v-text-field v-model="persona" label="Personality (optional)" counter="200"
            placeholder="e.g. a pirate who loves puns" :rules="[v => (v || '').length <= 200 || 'Keep it under 200 characters']" />
          <v-select v-model="style" :items="styleItems" label="Drawing style" />
          <v-text-field v-model.number="count" type="number" label="How many seats" min="1" max="8"
            :rules="[v => (Number.isInteger(v) && v >= 1 && v <= 8) || 'Between 1 and 8']" />
          <v-row class="pa-2" style="justify-content: center;">
            <v-btn size="x-large" color="primary" elevation="2" :loading="busy" @click="add">Add</v-btn>
          </v-row>
        </v-form>
      </v-card>
    </v-dialog>
  </template>
</template>
<script>
import { mapStores } from 'pinia'
import { useUserStore } from '@/stores/user';
import { pbService } from '@/services/pocketbase'
import { log } from '@/services/log'

export default {
  name: "AddBots",
  props: ["gameId"],
  data() {
    return {
      providers: [],
      styles: [],
      visible: false,
      model: "",
      persona: "",
      style: "",
      count: 1,
      busy: false,
      error: "",
    }
  },
  computed: {
    ...mapStores(useUserStore),
    modelItems() {
      return this.providers.flatMap(p => p.models.map(m => ({ title: `${p.label} · ${m}`, value: `${p.id}|${m}` })))
    },
    styleItems() {
      return this.styles.map(s => ({ title: s.label, value: s.id }))
    },
  },
  async mounted() {
    const resp = await pbService.games.getAIOptions()
    if (resp.errMsg) {
      log.warn("addBots.options", { err: resp.errMsg })
      return
    }
    this.providers = resp.data.providers || []
    this.styles = resp.data.styles || []
    this.model = this.modelItems[0]?.value || ""
    this.style = this.styleItems[0]?.value || ""
  },
  methods: {
    open() {
      this.error = ""
      this.visible = true
    },
    async add() {
      const { valid } = await this.$refs.form.validate()
      if (!valid) return
      const [provider, model] = this.model.split("|")
      this.busy = true
      const resp = await pbService.games.addBots(this.gameId, this.userStore.userId, {
        provider, model, persona: this.persona.trim(), style: this.style, count: this.count,
      })
      this.busy = false
      log.info("addBots", { provider, model, style: this.style, count: this.count, err: resp.errMsg })
      if (resp.errMsg) {
        this.error = resp.errMsg
        return
      }
      this.visible = false // the roster updates over the realtime subscription
    },
  },
}
</script>
