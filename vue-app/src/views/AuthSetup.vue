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
import HeroPanel from '@/components/HeroPanel.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordRules from '@/components/PasswordRules.vue'
import LegalDocumentLink from '@/components/LegalDocumentLink.vue'

const router = useRouter()

const PW_HINT = 'At least 8 characters, with a letter, a number, and a special character.'

// Restricting sign-up to this domain is IT-expert feedback: a teacher
// account should only be issuable to the school's own email addresses,
// so an outsider can't self-register. Confirm/replace with the real
// domain LSPU issues to its faculty before relying on this.
const ALLOWED_EMAIL_DOMAIN = 'lspu.edu.ph'
const EMAIL_PATTERN = new RegExp(`^[^\\s@]+@([^\\s@]+\\.)?${ALLOWED_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`, 'i')

const form = reactive({
  fullname: '',
  username: '',
  password: '',
  confirm: '',
  email: '',
})
const agreedToTerms = ref(false)

/* Fields flagged by the last failed submit. Cleared per-field as soon
   as the teacher edits that field, matching _clearInvalid(). */
const invalid = ref(new Set())
const isInvalid = (key) => invalid.value.has(key)
const clearInvalid = (key) => invalid.value.delete(key)

const status = ref('Create a teacher account to get started.')

const REQUIRED = ['fullname', 'username', 'password', 'confirm', 'email']
const blanks = computed(() => REQUIRED.filter((key) => !form[key].trim()))

async function submit() {
  if (blanks.value.length) {
    invalid.value = new Set(blanks.value)
    await showMessage('Incomplete Setup', 'Please fill out all required fields.')
    return
  }

  if (!EMAIL_PATTERN.test(form.email.trim())) {
    invalid.value = new Set(['email'])
    await showMessage(
      'Invalid Email',
      `Please use your ${ALLOWED_EMAIL_DOMAIN} school email address to register.`,
    )
    return
  }

  if (!agreedToTerms.value) {
    await showMessage('Agreement Required', 'You must agree to the Terms and Privacy Policy to create an account.')
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
    // Institution used to be collected here; it added a required field to sign-up
    // without being needed to use the system, so it was dropped from onboarding
    // (feedback from IT expert review). A teacher can still add it afterward from
    // Settings > Account, where it stays optional -- see SettingsView.vue.
    user = await API.createUser(
      form.fullname,
      null,
      form.username,
      form.password,
      form.email.trim(),
    )
  } catch (e) {
    await showMessage('Account Setup Failed', e.message)
    return
  }

  // Send the teacher to log in with their new credentials rather than
  // straight into the dashboard -- signing them in here too was one
  // more thing to undo if createUser succeeded but something after it
  // failed, and it skipped the moment of confirming the password works.
  // AuthLogin.vue already has a 'created' status message and an autofilled
  // username for exactly this handoff.
  router.push({ name: 'login', query: { status: 'created', u: user.username || form.username } })
}
</script>

<template>
  <div class="auth-container">
    <HeroPanel />

    <div class="auth-card">
      <h1 class="page-title">Set up your account</h1>
      <div class="muted-text">Create your teacher account to get started.</div>

      <div class="form-group">
        <span class="form-label">Full Name <span class="required">*</span></span>
        <input
          v-model="form.fullname"
          type="text"
          placeholder="Full name"
          title="Enter the full name of the teacher account owner."
          aria-label="Full name"
          :class="{ invalid: isInvalid('fullname') }"
          @input="clearInvalid('fullname')"
        >
      </div>

      <div class="form-group">
        <span class="form-label">Username <span class="required">*</span></span>
        <input
          v-model="form.username"
          type="text"
          placeholder="Username"
          title="Create a local username for signing in."
          aria-label="Username"
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
          :placeholder="`you@${ALLOWED_EMAIL_DOMAIN}`"
          :title="`Enter your ${ALLOWED_EMAIL_DOMAIN} school email address. It's needed to reset your password later.`"
          aria-label="Email address"
          :class="{ invalid: isInvalid('email') }"
          @input="clearInvalid('email')"
        >
      </div>

      <label class="checkbox-row mb-8">
        <input
          v-model="agreedToTerms"
          type="checkbox"
          title="You must agree to the Terms and Privacy Policy to create an account."
        >
        <span>
          I agree to the
          <LegalDocumentLink document="terms">Terms</LegalDocumentLink> and
          <LegalDocumentLink document="privacy">Privacy Policy</LegalDocumentLink>.
        </span>
      </label>

      <div class="muted-text">{{ status }}</div>
      <button
        class="btn btn-primary w-full"
        title="Create the teacher account, then sign in with it."
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
