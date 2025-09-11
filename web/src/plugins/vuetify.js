/**
 * plugins/vuetify.js
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

// Composables
import { createVuetify } from 'vuetify'

// Theme
const myCustomLightTheme = {
  dark: false,
  colors: {
    background: '#d0d7de',
    surface: '#e1eefe',
    'surface-bright': '#FFFFFF',
    'surface-light': '#EEEEEE',
    'surface-variant': '#424242',
    'on-surface-variant': '#EEEEEE',
    'primary-lighten-1': '#42607c',
    primary: '#13385b',
    'primary-darken-1': '#0C2338',
    'secondary-lighten-4': '#d0dfee',
    'secondary-lighten-3': '#a0bfdc',
    'secondary-lighten-2': '#719fcb',
    'secondary-lighten-1': '#427fb9',
    secondary: '#125fa8',
    'secondary-darken-1': '#0e477e',
    'secondary-darken-2': '#092f54',
    'tertiary-lighten-3': '#dccba0',
    'tertiary-lighten-2': '#cbb171',
    'tertiary-lighten-1': '#b99742',
    tertiary: '#a87d12',
    'tertiary-darken-1': '#7e5e0e',
    'tertiary-darken-2': '#543f09',
    'tertiary-darken-3': '#2a1f05',
    error: '#B00020',
    info: '#2196F3',
    success: '#4CAF50',
    warning: '#FB8C00',
  },
  variables: {
    'border-color': '#000000',
    'border-opacity': 0.12,
    'high-emphasis-opacity': 0.87,
    'medium-emphasis-opacity': 0.60,
    'disabled-opacity': 0.38,
    'idle-opacity': 0.04,
    'hover-opacity': 0.04,
    'focus-opacity': 0.12,
    'selected-opacity': 0.08,
    'activated-opacity': 0.12,
    'pressed-opacity': 0.12,
    'dragged-opacity': 0.08,
    'theme-kbd': '#212529',
    'theme-on-kbd': '#FFFFFF',
    'theme-code': '#F5F5F5',
    'theme-on-code': '#000000',
  }
}

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    defaultTheme: 'myCustomLightTheme',
    themes: {
      myCustomLightTheme,
    },
  },
})
