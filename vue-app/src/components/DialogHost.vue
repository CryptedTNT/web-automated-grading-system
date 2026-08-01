<script setup>
/* Renders any dialogs queued through services/dialog.js.
   Mounted once in App.vue so every page can call showMessage()
   without owning any markup. */

import { dialogs, closeDialog } from '@/services/dialog.js'

function dismiss(dialog) {
  closeDialog(dialog.id, dialog.type === 'confirm' ? false : 'OK')
}
</script>

<template>
  <div
    v-for="dialog in dialogs"
    :key="dialog.id"
    class="toast-overlay"
    @click.self="dismiss(dialog)"
  >
    <div class="toast-box">
      <div class="toast-title">{{ dialog.title }}</div>
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
