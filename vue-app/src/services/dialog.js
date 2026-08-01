/* ============================================================
   services/dialog.js — replaces App.showMessage / App.showConfirm

   Same promise-based API as before, so call sites read identically:
     await showMessage('Exported', 'File downloaded.')
     if (await showConfirm('Delete?', 'This cannot be undone.')) { ... }

   The difference is that DialogHost.vue renders these through a
   template, so message text is escaped by Vue automatically. The
   original had to call _escHtml() by hand before interpolating into
   innerHTML — a step that is easy to forget and becomes an
   injection bug when the text contains a student's name.
   ============================================================ */

import { reactive } from 'vue'

let nextId = 1

export const dialogs = reactive([])

function push(dialog) {
  return new Promise((resolve) => {
    dialogs.push({ ...dialog, id: nextId++, resolve })
  })
}

export function showMessage(title, message) {
  return push({ type: 'message', title, message })
}

export function showConfirm(title, message) {
  return push({ type: 'confirm', title, message })
}

export function closeDialog(id, value) {
  const index = dialogs.findIndex((d) => d.id === id)
  if (index === -1) return
  const [dialog] = dialogs.splice(index, 1)
  dialog.resolve(value)
}
