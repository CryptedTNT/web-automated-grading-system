import { ref } from 'vue'

export const activeLegalDocument = ref(null)

export function showLegalDocument(document) {
  if (['terms', 'privacy', 'cookies'].includes(document)) {
    activeLegalDocument.value = document
  }
}

export function closeLegalDocument() {
  activeLegalDocument.value = null
}
