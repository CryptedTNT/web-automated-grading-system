<script setup>
/* ============================================================
   AuthSetup.vue — create the first teacher account
   Ported from Auth.renderSetup() / Auth.submitSetup() in auth.js.
   ============================================================ */

import { reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { DB } from '@/services/database.js'
import { showMessage } from '@/services/dialog.js'
import HeroPanel from '@/components/HeroPanel.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordRules from '@/components/PasswordRules.vue'

const router = useRouter()

const PW_HINT = 'At least 8 characters, with a letter, a number, and a special character.'

const SECURITY_QUESTIONS = [
  'What personal word can you remember?',
  "What is your favorite teacher's nickname?",
  'What memorable place do you remember?',
]

const form = reactive({
  fullname: '',
  institution: '',
  username: '',
  password: '',
  confirm: '',
  question: SECURITY_QUESTIONS[0],
  answer: '',
})

/* Fields flagged by the last failed submit. Cleared per-field as soon
   as the teacher edits that field, matching _clearInvalid(). */
const invalid = ref(new Set())
const isInvalid = (key) => invalid.value.has(key)
const clearInvalid = (key) => invalid.value.delete(key)

const status = ref('No account found yet. Create the first teacher account to start.')

const REQUIRED = ['fullname', 'institution', 'username', 'password', 'confirm', 'answer']
const blanks = computed(() => REQUIRED.filter((key) => !form[key].trim()))

async function submit() {
  if (blanks.value.length) {
    invalid.value = new Set(blanks.value)
    await showMessage('Incomplete Setup', 'Please fill out all required fields.')
    return
  }

  const pwError = DB.passwordError(form.password)
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

  try {
    DB.createUser(
      form.fullname,
      form.institution,
      form.username,
      form.password,
      form.question,
      form.answer,
    )
  } catch (e) {
    await showMessage('Account Setup Failed', e.message)
    return
  }

  router.push({ name: 'login', query: { u: form.username.trim(), status: 'created' } })
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
        <span class="form-label">Security Question <span class="required">*</span></span>
        <select v-model="form.question" title="Choose a security question for password reset.">
          <option v-for="question in SECURITY_QUESTIONS" :key="question">{{ question }}</option>
        </select>
      </div>

      <div class="form-group">
        <span class="form-label">Security Answer <span class="required">*</span></span>
        <PasswordField
          v-model="form.answer"
          placeholder="Security answer"
          title="Enter the answer for password reset."
          :invalid="isInvalid('answer')"
          @update:model-value="clearInvalid('answer')"
        />
      </div>

      <div class="muted-text">{{ status }}</div>
      <button
        class="btn btn-primary w-full"
        title="Create the local teacher account and proceed to login."
        @click="submit"
      >
        Create Account
      </button>
      <div class="spacer"></div>
    </div>
  </div>
</template>
