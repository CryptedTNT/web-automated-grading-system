<script setup>
import { showLegalDocument } from '@/services/legal.js'

defineProps({
  document: { type: String, required: true },
})
</script>

<template>
  <button
    type="button"
    class="legal-document-link"
    aria-haspopup="dialog"
    @click="showLegalDocument(document)"
  >
    <slot />
  </button>
</template>
