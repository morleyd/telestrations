import vuetify from '@/plugins/vuetify'
import router from "./router/router";

// The sketchbook theme: Bricolage Grotesque for the app, Patrick Hand for what
// players write, then the paper, ink and stickers
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import '@fontsource/patrick-hand'
import '@/styles/sketchbook.css'

import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import { createApp } from 'vue'
import App from './App.vue'

const app = createApp(App)

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)
app.use(vuetify)

app.mount('#app')
