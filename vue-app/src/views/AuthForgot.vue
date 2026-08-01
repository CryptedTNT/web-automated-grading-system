<script setup>
/* ============================================================
   AuthForgot.vue — reset a password with the security answer
   Ported from Auth.renderForgot() / Auth.submitForgot() in auth.js.
   ============================================================ */

import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DB } from '@/services/database.js'
import { showMessage } from '@/services/dialog.js'
import HeroPanel from '@/components/HeroPanel.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordRules from '@/components/PasswordRules.vue'

const route = useRoute()
const router = useRouter()

const PW_HINT = 'At least 8 characters, with a letter, a number, and a special character.'

const username = ref(route.query.u || '')
const answer = ref('')
const newPassword = ref('')
const confirm = ref('')

const invalid = ref(new Set())
const isInvalid = (key) => invalid.value.has(key)
const clearInvalid = (key) => invalid.value.delete(key)

const status = ref('Enter your username, security answer, and new password.')

/* The original updated this label on blur. As a computed it simply
   tracks the username field — no event wiring at all. */
const questionText = computed(() => {
  const name = username.value.trim()
  if (!name) return 'Security question will be checked from the saved local account.'
  const user = DB.getUserByUsername(name)
  return user?.security_question || 'Security question will be checked from the saved local account.'
})

async function submit() {
  const blanks = []
  if (!username.value.trim()) blanks.push('username')
  if (!answer.value.trim()) blanks.push('answer')
  if (!newPassword.value.trim()) blanks.push('newPassword')
  if (!confirm.value.trim()) blanks.push('confirm')

  if (blanks.length) {
    invalid.value = new Set(blanks)
    await showMessage('Incomplete Reset', 'Please fill out all required fields.')
    return
  }

  const pwError = DB.passwordError(newPassword.value)
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

  let ok = false
  try {
    ok = DB.resetPasswordWithSecurityAnswer(username.value.trim(), answer.value.trim(), newPassword.value)
  } catch (e) {
    await showMessage('Reset Failed', e.message)
    return
  }

  if (!ok) {
    invalid.value = new Set(['username', 'answer'])
    status.value = 'Username or security answer is incorrect.'
    await showMessage('Reset Failed', 'Username or security answer is incorrect.')
    return
  }

  router.push({ name: 'login', query: { u: username.value.trim(), status: 'reset' } })
}
</script>

<template>
  <div class="auth-container">
    <HeroPanel />

    <div class="auth-card">
      <div class="page-title">Reset Password</div>
      <div class="muted-text">Answer your security question. No email required.</div>

      <div class="form-group">
        <span class="form-label">Username <span class="required">*</span></span>
        <input
          v-model="username"
          type="text"
          placeholder="Username"
          title="Enter the username of the local teacher account."
          :class="{ invalid: isInvalid('username') }"
          @input="clearInvalid('username')"
        >
      </div>

      <div class="section-title mb-8">{{ questionText }}</div>

      <div class="form-group">
        <span class="form-label">Security Answer <span class="required">*</span></span>
        <PasswordField
          v-model="answer"
          placeholder="Security answer"
          title="Enter the saved security answer."
          :invalid="isInvalid('answer')"
          @update:model-value="clearInvalid('answer')"
        />
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

      <div class="muted-text">{{ status }}</div>

      <div class="flex gap-8">
        <RouterLink v-slot="{ navigate }" :to="{ name: 'login' }" custom>
          <button class="btn btn-secondary" title="Return to login." @click="navigate">Cancel</button>
        </RouterLink>
        <button
          class="btn btn-primary"
          title="Save new password after verifying security answer."
          @click="submit"
        >
          Save New Password
        </button>
      </div>

      <div class="spacer"></div>
    </div>
  </div>
</template>
