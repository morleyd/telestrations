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

// Theme: a sketchbook. Ink on dot-grid paper, with construction-paper colors:
// a marker blue, sunflower yellow and tomato red, plus grass and plum for the
// paper shapes and badges (see styles/sketchbook.css).
const myCustomLightTheme = {
  dark: false,
  colors: {
    background: '#F6F1E7',
    'on-background': '#1F1B16',
    surface: '#FFFDF8',
    'on-surface': '#1F1B16',
    'surface-bright': '#FFFFFF',
    'surface-light': '#EFE8DA',
    'surface-variant': '#2B2520',
    'on-surface-variant': '#F6F1E7',
    'primary-lighten-1': '#5C77DA',
    primary: '#3355D1',
    'primary-darken-1': '#26409D',
    'secondary-lighten-4': '#FDF0D5',
    'secondary-lighten-3': '#FCE1AA',
    'secondary-lighten-2': '#FAD180',
    'secondary-lighten-1': '#F9C255',
    secondary: '#F7B32B',
    'on-secondary': '#1F1B16',
    'secondary-darken-1': '#B98620',
    'secondary-darken-2': '#7C5A16',
    'tertiary-lighten-3': '#F4D8D1',
    'tertiary-lighten-2': '#DE8B74',
    'tertiary-lighten-1': '#D36445',
    tertiary: '#C83D17',
    'tertiary-darken-1': '#962E11',
    'tertiary-darken-2': '#641E0C',
    'tertiary-darken-3': '#320F06',
    grass: '#2A7D45',
    'grass-darken-1': '#1F5E33',
    plum: '#7B3FA0',
    error: '#C62828',
    info: '#3355D1',
    success: '#2A7D45',
    warning: '#E08600',
  },
  variables: {
    // Ink, for dividers and outlines
    'border-color': '#1F1B16',
    'border-opacity': 0.16,
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
  // Fields drawn as inked boxes (see sketchbook.css), each label always up on
  // the box's edge as a tag, an empty field's too
  defaults: {
    VTextField: { variant: 'outlined', persistentPlaceholder: true },
    VTextarea: { variant: 'outlined', persistentPlaceholder: true },
    VSelect: { variant: 'outlined', persistentPlaceholder: true },
    VNumberInput: { variant: 'outlined', persistentPlaceholder: true },
  },
  theme: {
    defaultTheme: 'myCustomLightTheme',
    themes: {
      myCustomLightTheme,
    },
  },
})
