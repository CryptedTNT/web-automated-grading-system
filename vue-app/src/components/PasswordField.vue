<script setup>
/* Password input with a show/hide toggle.
   Replaces _pwField() + _attachToggles() from auth.js — the toggle
   state is now local to each field instead of being wired by id. */

import { ref } from 'vue'

defineProps({
  placeholder: { type: String, default: 'Password' },
  title: { type: String, default: '' },
  invalid: { type: Boolean, default: false },
})

const model = defineModel({ type: String, default: '' })
const revealed = ref(false)
const input = ref(null)

// Lets a parent move focus here (e.g. Enter on the username field).
defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div class="password-wrapper">
    <input
      ref="input"
      v-model="model"
      :type="revealed ? 'text' : 'password'"
      :placeholder="placeholder"
      :title="title"
      :class="{ invalid }"
    >
    <button
      type="button"
      class="password-toggle"
      :title="revealed ? 'Hide password' : 'Show password'"
      @click="revealed = !revealed"
    >
      <svg
        viewBox="0 0 24 24" width="18" height="18" stroke="currentColor"
        stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"
      >
        <template v-if="revealed">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </template>
        <template v-else>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </template>
      </svg>
    </button>
  </div>
</template>
