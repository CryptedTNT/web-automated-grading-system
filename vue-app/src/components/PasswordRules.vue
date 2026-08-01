<script setup>
/* Live password requirement checklist.

   The original repainted this list by hand on every keystroke
   (_paintPwRules). Here the classes are derived from the password
   prop, so the list simply follows the input. */

import { computed } from 'vue'
import { DB } from '@/services/database.js'

const props = defineProps({
  password: { type: String, default: '' },
})

const rules = computed(() => DB.checkPassword(props.password).results)
</script>

<template>
  <ul class="pw-rules" aria-live="polite">
    <li
      v-for="rule in rules"
      :key="rule.id"
      :class="{ ok: rule.ok, bad: !rule.ok && password.length > 0 }"
    >
      {{ rule.label }}
    </li>
  </ul>
</template>
