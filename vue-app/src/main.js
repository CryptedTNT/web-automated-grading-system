import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router/index.js'
import { loadSavedTheme } from './services/theme.js'

import './assets/styles.css'

// Apply the saved palette before mount so the first paint is not
// a flash of the default colours.
loadSavedTheme()

const app = createApp(App)

// v-focus: focus an element as soon as it is inserted. Used by the
// dialog host so the default button is keyboard-ready, matching the
// .focus() calls in the original showMessage/showConfirm.
app.directive('focus', {
  mounted: (el) => el.focus(),
})

app.use(createPinia()).use(router).mount('#app')
