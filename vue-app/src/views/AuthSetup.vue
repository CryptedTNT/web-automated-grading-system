<script setup>
/* ============================================================
   AuthSetup.vue — sign up: create a teacher account
   Ported from Auth.renderSetup() / Auth.submitSetup() in auth.js.
   Multiple teachers can each have their own account -- this isn't
   gated to "only when no account exists yet" (see router/index.js).
   ============================================================ */

import { reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { showMessage } from '@/services/dialog.js'
import { useAppStore } from '@/stores/app.js'
import HeroPanel from '@/components/HeroPanel.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordRules from '@/components/PasswordRules.vue'

const router = useRouter()
const store = useAppStore()

const PW_HINT = 'At least 8 characters, with a letter, a number, and a special character.'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const form = reactive({
  fullname: '',
  institution: '',
  username: '',
  password: '',
  confirm: '',
  email: '',
})

/* Fields flagged by the last failed submit. Cleared per-field as soon
   as the teacher edits that field, matching _clearInvalid(). */
const invalid = ref(new Set())
const isInvalid = (key) => invalid.value.has(key)
const clearInvalid = (key) => invalid.value.delete(key)

const status = ref('Create a teacher account to get started.')

const REQUIRED = ['fullname', 'institution', 'username', 'password', 'confirm', 'email']
const blanks = computed(() => REQUIRED.filter((key) => !form[key].trim()))

async function submit() {
  if (blanks.value.length) {
    invalid.value = new Set(blanks.value)
    await showMessage('Incomplete Setup', 'Please fill out all required fields.')
    return
  }

  if (!EMAIL_PATTERN.test(form.email.trim())) {
    invalid.value = new Set(['email'])
    await showMessage('Invalid Email', 'Please enter a valid email address.')
    return
  }

  const pwError = API.passwordError(form.password)
  if (pwError) {
    invalid.value = new Set(['password'])
    await showMessage('Weak Password', pwError)
    return
  }

  if (form.password !== form.confirm) {
    invalid.value = new Set(['password', 'confirm'])
    await showMessage('Password Mismatch', 'Password and confirm password do not match.')
    return
  }

  let user
  try {
    user = await API.createUser(
      form.fullname,
      form.institution,
      form.username,
      form.password,
      form.email.trim(),
    )
  } catch (e) {
    await showMessage('Account Setup Failed', e.message)
    return
  }

  // Registering also signs the account in server-side, so pick straight
  // up where AuthLogin.vue would leave off and head into email verification.
  await store.signIn(user)
  router.push({ name: 'verify_email' })
}
</script>

<template>
  <div class="auth-container">
    <HeroPanel />

    <div class="auth-card">
      <div class="page-title">Set up your account</div>
      <div class="muted-text">Create your teacher account to get started.</div>

      <div class="form-group">
        <span class="form-label">Full Name <span class="required">*</span></span>
        <input
          v-model="form.fullname"
          type="text"
          placeholder="Full name"
          title="Enter the full name of the teacher account owner."
          :class="{ invalid: isInvalid('fullname') }"
          @input="clearInvalid('fullname')"
        >
      </div>

      <div class="form-group">
        <span class="form-label">Institution <span class="required">*</span></span>
        <input
          v-model="form.institution"
          type="text"
          placeholder="Institution"
          title="Enter the school or institution name."
          :class="{ invalid: isInvalid('institution') }"
          @input="clearInvalid('institution')"
        >
      </div>

      <div class="form-group">
        <span class="form-label">Username <span class="required">*</span></span>
        <input
          v-model="form.username"
          type="text"
          placeholder="Username"
          title="Create a local username for signing in."
          :class="{ invalid: isInvalid('username') }"
          @input="clearInvalid('username')"
        >
      </div>

      <div class="form-group">
        <span class="form-label">Password <span class="required">*</span></span>
        <PasswordField
          v-model="form.password"
          placeholder="Password"
          :title="`Create a password. ${PW_HINT}`"
          :invalid="isInvalid('password')"
          @update:model-value="clearInvalid('password')"
        />
        <PasswordRules :password="form.password" />
      </div>

      <div class="form-group">
        <span class="form-label">Confirm Password <span class="required">*</span></span>
        <PasswordField
          v-model="form.confirm"
          placeholder="Confirm password"
          title="Re-type the password to confirm."
          :invalid="isInvalid('confirm')"
          @update:model-value="clearInvalid('confirm')"
        />
      </div>

      <div class="form-group">
        <span class="form-label">Email <span class="required">*</span></span>
        <input
          v-model="form.email"
          type="email"
          placeholder="you@example.com"
          title="Enter an email address. You'll verify it next, and it's needed to reset your password later."
          :class="{ invalid: isInvalid('email') }"
          @input="clearInvalid('email')"
        >
      </div>

      <div class="muted-text">{{ status }}</div>
      <button
        class="btn btn-primary w-full"
        title="Create the local teacher account and proceed to email verification."
        @click="submit"
      >
        Create Account
      </button>

      <div class="muted-text text-center mt-8">
        Already have an account?
        <RouterLink :to="{ name: 'login' }">Login</RouterLink>
      </div>

      <div class="spacer"></div>
    </div>
  </div>
</template>
