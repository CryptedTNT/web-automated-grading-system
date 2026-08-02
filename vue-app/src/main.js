import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router/index.js'
import { loadSavedTheme } from './services/theme.js'
import { DB } from './services/database.js'

import './assets/styles.css'

// Apply the saved palette before mount so the first paint is not
// a flash of the default colours.
loadSavedTheme()

// A run cannot survive a page load, so any session still marked
// 'Processing' belongs to a tab that was closed mid-job. Settle it
// before the dashboard reports it as in progress.
DB.failInterruptedSessions()

const app = createApp(App)

// v-focus: focus an element as soon as it is inserted. Used by the
// dialog host so the default button is keyboard-ready, matching the
// .focus() calls in the original showMessage/showConfirm.
app.directive('focus', {
  mounted: (el) => el.focus(),
})

app.use(createPinia()).use(router).mount('#app')
