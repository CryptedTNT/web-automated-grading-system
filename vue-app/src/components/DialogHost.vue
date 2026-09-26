<script setup>
/* Renders any dialogs queued through services/dialog.js.
   Mounted once in App.vue so every page can call showMessage()
   without owning any markup. */

import { onMounted, onUnmounted } from 'vue'
import { dialogs, closeDialog } from '@/services/dialog.js'
import LegalDocumentModal from '@/components/LegalDocumentModal.vue'
import { activeLegalDocument, closeLegalDocument, showLegalDocument } from '@/services/legal.js'

function dismiss(dialog) {
  closeDialog(dialog.id, dialog.type === 'confirm' ? false : 'OK')
}

// Keyboard-only users had no way to dismiss a toast at all -- clicking
// the overlay was the only escape hatch. Only the topmost (most recently
// pushed) dialog responds, matching how a stack of real modals behaves.
function onKeydown(event) {
  if (event.key !== 'Escape' || !dialogs.length) return
  dismiss(dialogs[dialogs.length - 1])
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <LegalDocumentModal
    v-if="activeLegalDocument"
    :document="activeLegalDocument"
    @close="closeLegalDocument"
    @show-document="showLegalDocument"
  />

  <div
    v-for="dialog in dialogs"
    :key="dialog.id"
    class="toast-overlay"
    @click.self="dismiss(dialog)"
  >
    <div class="toast-box" role="dialog" aria-modal="true" :aria-labelledby="`dialog-title-${dialog.id}`">
      <div :id="`dialog-title-${dialog.id}`" class="toast-title">{{ dialog.title }}</div>
      <div class="toast-message">{{ dialog.message }}</div>

      <div v-if="dialog.type === 'confirm'" class="toast-actions">
        <button class="btn btn-secondary" @click="closeDialog(dialog.id, false)">No</button>
        <button v-focus class="btn btn-primary" @click="closeDialog(dialog.id, true)">Yes</button>
      </div>
      <div v-else class="toast-actions">
        <button v-focus class="btn btn-primary" @click="closeDialog(dialog.id, 'OK')">OK</button>
      </div>
    </div>
  </div>
</template>
