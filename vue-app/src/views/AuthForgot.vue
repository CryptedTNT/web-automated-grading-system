<script setup>
/* ============================================================
   AuthForgot.vue — reset a forgotten password with an emailed code

   Two steps: (1) enter the username and request a code -- the backend
   only sends one if that account's email is verified, and says so
   plainly if it isn't; (2) enter the code plus a new password.
   ============================================================ */

import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { showMessage } from '@/services/dialog.js'
import { useResendCooldown } from '@/composables/useResendCooldown.js'
import HeroPanel from '@/components/HeroPanel.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordRules from '@/components/PasswordRules.vue'

const route = useRoute()
const router = useRouter()

const PW_HINT = 'At least 8 characters, with a letter, a number, and a special character.'

// Mirrors the backend's 5-minute resend cooldown (see auth.py's
// RESEND_COOLDOWN) so the button visibly can't be spammed.
const RESEND_COOLDOWN_SECONDS = 300
const cooldown = useResendCooldown()

const username = ref(route.query.u || '')
const code = ref('')
const newPassword = ref('')
const confirm = ref('')

const invalid = ref(new Set())
const isInvalid = (key) => invalid.value.has(key)
const clearInvalid = (key) => invalid.value.delete(key)

/* Step 2 only appears once a code has actually been sent. */
const codeSent = ref(false)
const sending = ref(false)
const resetting = ref(false)

const status = ref('Enter your username to receive a password reset code by email.')

async function sendCode() {
  if (cooldown.active.value) return
  if (!username.value.trim()) {
    invalid.value = new Set(['username'])
    await showMessage('Username Required', 'Please enter your username.')
    return
  }

  sending.value = true
  try {
    await API.forgotSendCode(username.value.trim())
  } catch (e) {
    sending.value = false
    if (e.retryAfterSeconds) {
      // A code for this account went out recently -- not a real
      // failure, just reflect the existing cooldown.
      cooldown.start(e.retryAfterSeconds)
      invalid.value = new Set()
      codeSent.value = true
      status.value = 'Please wait before requesting another code.'
      return
    }
    await showMessage('Could Not Send Code', e.message)
    return
  }
  sending.value = false

  invalid.value = new Set()
  codeSent.value = true
  cooldown.start(RESEND_COOLDOWN_SECONDS)
  status.value = 'If that account has a verified email, a 6-digit code was sent to it.'
}

async function resendCode() {
  await sendCode()
}

async function submit() {
  const blanks = []
  if (!code.value.trim()) blanks.push('code')
  if (!newPassword.value.trim()) blanks.push('newPassword')
  if (!confirm.value.trim()) blanks.push('confirm')

  if (blanks.length) {
    invalid.value = new Set(blanks)
    await showMessage('Incomplete Reset', 'Please fill out all required fields.')
    return
  }

  const pwError = API.passwordError(newPassword.value)
  if (pwError) {
    invalid.value = new Set(['newPassword'])
    await showMessage('Weak Password', pwError)
    return
  }

  if (newPassword.value !== confirm.value) {
    invalid.value = new Set(['newPassword', 'confirm'])
    await showMessage('Password Mismatch', 'New password and confirmation do not match.')
    return
  }

  resetting.value = true
  let ok = false
  try {
    ok = await API.forgotReset(username.value.trim(), code.value.trim(), newPassword.value)
  } catch (e) {
    resetting.value = false
    await showMessage('Reset Failed', e.message)
    return
  }
  resetting.value = false

  if (!ok) {
    invalid.value = new Set(['code'])
    status.value = 'That code is incorrect or has expired.'
    await showMessage('Reset Failed', 'That code is incorrect or has expired. Try resending a new one.')
    return
  }

  router.push({ name: 'login', query: { u: username.value.trim(), status: 'reset' } })
}
</script>

<template>
  <div class="auth-container">
    <HeroPanel />

    <div class="auth-card">
      <h1 class="page-title">Reset Password</h1>
      <div class="muted-text">{{ status }}</div>

      <div class="form-group">
        <span class="form-label">Username <span class="required">*</span></span>
        <input
          v-model="username"
          type="text"
          placeholder="Username"
          title="Enter the username of the local teacher account."
          aria-label="Username"
          :disabled="codeSent"
          :class="{ invalid: isInvalid('username') }"
          @input="clearInvalid('username')"
        >
      </div>

      <div v-if="!codeSent" class="form-group">
        <button class="btn btn-primary w-full" :disabled="sending" title="Send a reset code to this account's email." @click="sendCode">
          Send Code
        </button>
      </div>

      <template v-else>
        <div class="form-group">
          <span class="form-label">Verification Code <span class="required">*</span></span>
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            maxlength="6"
            placeholder="6-digit code"
            title="Enter the 6-digit code sent to your email."
            aria-label="6-digit verification code"
            :class="{ invalid: isInvalid('code') }"
            @input="clearInvalid('code')"
          >
        </div>
        <div class="form-group">
          <button
            class="btn btn-secondary"
            :disabled="sending || cooldown.active.value"
            title="Send another code."
            @click="resendCode"
          >
            {{ cooldown.active.value ? `Resend Code (${cooldown.formatted.value})` : 'Resend Code' }}
          </button>
        </div>

        <div class="form-group">
          <span class="form-label">New Password <span class="required">*</span></span>
          <PasswordField
            v-model="newPassword"
            placeholder="New password"
            :title="PW_HINT"
            :invalid="isInvalid('newPassword')"
            @update:model-value="clearInvalid('newPassword')"
          />
          <PasswordRules :password="newPassword" />
        </div>

        <div class="form-group">
          <span class="form-label">Confirm New Password <span class="required">*</span></span>
          <PasswordField
            v-model="confirm"
            placeholder="Confirm new password"
            title="Re-type the new password."
            :invalid="isInvalid('confirm')"
            @update:model-value="clearInvalid('confirm')"
          />
        </div>
      </template>

      <div class="flex gap-8">
        <RouterLink v-slot="{ navigate }" :to="{ name: 'login' }" custom>
          <button class="btn btn-secondary" title="Return to login." @click="navigate">Cancel</button>
        </RouterLink>
        <button
          v-if="codeSent"
          class="btn btn-primary"
          :disabled="resetting"
          title="Save the new password after verifying the code."
          @click="submit"
        >
          Save New Password
        </button>
      </div>

      <div class="spacer"></div>
    </div>
  </div>
</template>
