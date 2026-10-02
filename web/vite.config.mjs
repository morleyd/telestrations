// Plugins
import Components from 'unplugin-vue-components/vite'
import Vue from '@vitejs/plugin-vue'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

// Identifies this build. The app compares it with the server's /version.json on
// page changes and reloads when the server has a newer build (see router.js).
const buildId = process.env.BUILD_ID || new Date().toISOString()

const emitVersionFile = {
  name: 'emit-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) })
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  base: '/', // Also needs to be changed in router/router.js
  plugins: [
    emitVersionFile,
    Vue({
      template: { transformAssetUrls }
    }),
    // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
    // The settings file swaps Vuetify's fonts and type (the fonts themselves are
    // bundled, see main.js, so a game on a LAN needs no internet).
    Vuetify({ styles: { configFile: 'src/styles/settings.scss' } }),
    Components(),
  ],
  // Vuetify's SASS (see the settings file above) on Sass's current API, not
  // the deprecated one, which warns on every file
  css: {
    preprocessorOptions: {
      sass: { api: 'modern-compiler' },
      scss: { api: 'modern-compiler' },
    },
  },
  define: {
    'process.env': {},
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
    extensions: [
      '.js',
      '.json',
      '.jsx',
      '.mjs',
      '.ts',
      '.tsx',
      '.vue',
    ],
  },
  server: {
    port: 3000,
    // Precompile the route components on server start so the first navigation
    // isn't a slow cold on-demand compile (keeps dev snappy and E2E stable).
    warmup: {
      clientFiles: [
        './src/pages/HomeScreen.vue',
        './src/pages/WaitingRoom.vue',
        './src/pages/TakeTurn.vue',
        './src/pages/Review.vue',
        './src/pages/PageNotFound.vue',
      ],
    },
  },
})
