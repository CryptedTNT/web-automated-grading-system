<script setup>
/* ============================================================
   VerifyEmailView.vue — post-signup (and Settings-triggered) email
   verification step. A code is sent automatically on mount; the
   teacher can verify it here or click "Not now" and verify later
   from Settings (see SettingsView.vue's Account tab).
   ============================================================ */

import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '@/services/api.js'
import { showMessage } from '@/services/dialog.js'
import { useAppStore } from '@/stores/app.js'
import { useResendCooldown } from '@/composables/useResendCooldown.js'
import HeroPanel from '@/components/HeroPanel.vue'

const router = useRouter()
const store = useAppStore()

// Mirrors the backend's 5-minute resend cooldown (see auth.py's
// RESEND_COOLDOWN) so the button visibly can't be spammed.
const RESEND_COOLDOWN_SECONDS = 300
const cooldown = useResendCooldown()

const code = ref('')
const invalidCode = ref(false)
const sending = ref(false)
const verifying = ref(false)
const status = ref('Sending a verification code…')

async function sendCode(isResend) {
  if (cooldown.active.value) return
  sending.value = true
  try {
    await API.sendVerificationCode()
    status.value = isResend
      ? `A new code was sent to ${store.currentUser?.email}.`
      : `A 6-digit code was sent to ${store.currentUser?.email}.`
    cooldown.start(RESEND_COOLDOWN_SECONDS)
  } catch (e) {
    if (e.retryAfterSeconds) {
      // Not a real failure -- a code was already sent recently (e.g.
      // this page was reloaded mid-cooldown). Reflect it, don't alarm.
      cooldown.start(e.retryAfterSeconds)
      status.value = isResend
        ? 'Please wait before requesting another code.'
        : `A code was already sent to ${store.currentUser?.email}. Check your email, or wait to resend.`
    } else {
      status.value = 'Could not send a verification code.'
      await showMessage('Send Failed', e.message)
    }
  } finally {
    sending.value = false
  }
}

onMounted(() => sendCode(false))

async function verify() {
  if (!code.value.trim()) {
    invalidCode.value = true
    await showMessage('Code Required', 'Please enter the 6-digit code sent to your email.')
    return
  }

  verifying.value = true
  let ok = false
  try {
    ok = await API.verifyEmailCode(code.value.trim())
  } catch (e) {
    verifying.value = false
    await showMessage('Verification Failed', e.message)
    return
  }
  verifying.value = false

  if (!ok) {
    invalidCode.value = true
    await showMessage('Incorrect Code', 'That code is incorrect or has expired. Try resending a new one.')
    return
  }

  if (store.currentUser) store.currentUser.email_verified = true
  await showMessage('Email Verified', 'Your email address has been verified.')
  router.push({ name: 'dashboard' })
}

function notNow() {
  router.push({ name: 'dashboard' })
}

function clearInvalid() {
  invalidCode.value = false
}
</script>

<template>
  <div class="auth-container">
    <HeroPanel />

    <div class="auth-card">
      <div class="page-title">Verify your email</div>
      <div class="muted-text">{{ status }}</div>

      <div class="form-group">
        <span class="form-label">Verification Code <span class="required">*</span></span>
        <input
          v-model="code"
          type="text"
          inputmode="numeric"
          maxlength="6"
          placeholder="6-digit code"
          title="Enter the 6-digit code sent to your email."
          :class="{ invalid: invalidCode }"
          @input="clearInvalid"
          @keydown.enter="verify"
        >
      </div>

      <div class="form-group">
        <button
          class="btn btn-primary w-full"
          title="Verify your email using the code above."
          :disabled="verifying"
          @click="verify"
        >
          Verify
        </button>
      </div>

      <div class="form-group">
        <button
          class="btn btn-secondary w-full"
          title="Send another code if the last one expired or didn't arrive."
          :disabled="sending || cooldown.active.value"
          @click="sendCode(true)"
        >
          {{ cooldown.active.value ? `Resend Code (${cooldown.formatted.value})` : 'Resend Code' }}
        </button>
      </div>

      <div class="form-group">
        <button
          class="btn btn-secondary w-full"
          title="Skip for now — you can verify your email later from Settings."
          @click="notNow"
        >
          Not now
        </button>
      </div>

      <div class="spacer"></div>
      <div class="muted-text text-center">
        You'll need a verified email to reset your password if you ever forget it.
      </div>
    </div>
  </div>
</template>
