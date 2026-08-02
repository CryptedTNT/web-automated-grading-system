<script setup>
/* ============================================================
   AuthLogin.vue — sign in
   Ported from Auth.renderLogin() / Auth.submitLogin() in auth.js.
   ============================================================ */

import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DB } from '@/services/database.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'
import HeroPanel from '@/components/HeroPanel.vue'
import PasswordField from '@/components/PasswordField.vue'

const route = useRoute()
const router = useRouter()
const store = useAppStore()

/* Status is driven by the query string so the message survives the
   redirect from setup / password reset without a shared global. */
const STATUS_MESSAGES = {
  created: 'Account created. Log in to continue.',
  reset: 'Password reset. Log in using your new password.',
  loggedout: 'Logged out.',
}

const username = ref(route.query.u || '')
const password = ref('')
const remember = ref(false)
/* Tracked per field: a wrong password used to redden the username box
   too, pointing the teacher at the wrong input. */
const invalidUsername = ref(false)
const invalidPassword = ref(false)
const failureMessage = ref('')

const status = computed(
  () =>
    failureMessage.value ||
    STATUS_MESSAGES[route.query.status] ||
    'Sign in with the teacher account saved in this browser.',
)

const passwordInput = ref(null)

async function submit() {
  if (!username.value.trim() || !password.value.trim()) {
    invalidUsername.value = !username.value.trim()
    invalidPassword.value = !password.value.trim()
    await showMessage('Login Required', 'Please enter your username and password.')
    return
  }

  const user = DB.verifyUser(username.value.trim(), password.value)
  if (!user) {
    /* Which of the two was wrong is deliberately not revealed to the
       user, but the username is only flagged when no such account
       exists — otherwise the password is the one to re-check. */
    invalidUsername.value = !DB.getUserByUsername(username.value.trim())
    invalidPassword.value = true
    failureMessage.value = 'Invalid username or password.'
    await showMessage('Login Failed', 'Invalid username or password.')
    return
  }

  DB.setSetting('remember_me', remember.value ? 'true' : 'false')
  DB.setSetting('remembered_user_id', remember.value ? user.id : '')

  store.signIn(user)
  router.push({ name: 'dashboard' })
}

function clearInvalid(field) {
  if (field === 'username') invalidUsername.value = false
  else invalidPassword.value = false
  failureMessage.value = ''
}
</script>

<template>
  <div class="auth-container">
    <HeroPanel />

    <div class="auth-card">
      <div class="page-title">Welcome back, Teacher!</div>
      <div class="muted-text">Please sign in to continue.</div>

      <div class="form-group">
        <span class="form-label">Username <span class="required">*</span></span>
        <input
          v-model="username"
          type="text"
          placeholder="Enter your username"
          title="Enter your local teacher account username."
          :class="{ invalid: invalidUsername }"
          @input="clearInvalid('username')"
          @keydown.enter="passwordInput?.focus()"
        >
      </div>

      <div class="form-group">
        <span class="form-label">Password <span class="required">*</span></span>
        <PasswordField
          ref="passwordInput"
          v-model="password"
          placeholder="Enter your password"
          title="Enter your password."
          :invalid="invalidPassword"
          @update:model-value="clearInvalid('password')"
          @keydown.enter="submit"
        />
      </div>

      <div class="flex items-center justify-between mb-8">
        <label class="checkbox-row">
          <input
            v-model="remember"
            type="checkbox"
            title="When checked, the app opens the dashboard directly next time."
          > Remember me
        </label>
        <RouterLink
          v-slot="{ navigate }"
          :to="{ name: 'forgot', query: { u: username.trim() } }"
          custom
        >
          <button
            class="btn btn-secondary"
            title="Reset your password using the saved security answer."
            @click="navigate"
          >
            Forgot password?
          </button>
        </RouterLink>
      </div>

      <div class="muted-text">{{ status }}</div>
      <button
        class="btn btn-primary w-full"
        title="Sign in using the local teacher account."
        @click="submit"
      >
        Login
      </button>

      <div class="spacer"></div>
      <div class="muted-text text-center">© 2027 AGS. Web-based application.</div>
    </div>
  </div>
</template>
