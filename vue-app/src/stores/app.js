/* ============================================================
   stores/app.js — shared application state (replaces App.state)

   In the original app this was a plain object in app.js, and every
   mutation had to be followed by a manual call such as
   updateUserLabels(). Here the sidebar and top bar bind to
   `currentUser` directly, so the UI follows the data on its own.
   ============================================================ */

import { defineStore } from 'pinia'
import { DB } from '@/services/database.js'

export const useAppStore = defineStore('app', {
  state: () => ({
    currentUser: null,
    selectedAnswerKeyId: null,
    /* Normalized upload entries staged by the Upload page — was
       App.state.uploadPaths. Each entry wraps the browser File plus
       the derived fields Processing reads: key, name, size, type,
       lastModified, relativePath, source. */
    uploadFiles: [],
    currentSessionId: null,
    selectedStudentResultId: null,
    selectedFlaggedItemId: null,
    searchTerm: '',
  }),

  getters: {
    isSignedIn: (state) => state.currentUser !== null,
    teacherLabel: (state) =>
      state.currentUser
        ? `Teacher: ${state.currentUser.full_name}`
        : 'Teacher: Not signed in',
  },

  actions: {
    /**
     * Reset the per-session selections and pick sensible defaults.
     * Mirrors clearRuntimeSelection() in the original app.js.
     */
    clearRuntimeSelection() {
      this.uploadFiles = []
      this.currentSessionId = DB.latestSessionId()
      this.selectedStudentResultId = null
      this.selectedFlaggedItemId = null

      const keys = DB.answerKeys()
      this.selectedAnswerKeyId = keys.length ? keys[0].id : null
    },

    signIn(user) {
      this.currentUser = user
      this.clearRuntimeSelection()
    },

    signOut() {
      DB.setSetting('remember_me', 'false')
      DB.setSetting('remembered_user_id', '')
      this.currentUser = null
    },

    /**
     * Restore a "remember me" session if one was saved.
     * Returns true when a user was restored.
     */
    restoreRememberedUser() {
      const settings = DB.getSettings()
      if (settings.remember_me !== 'true' || !settings.remembered_user_id) {
        return false
      }
      try {
        const user = DB.getUserPublicById(parseInt(settings.remembered_user_id))
        if (!user) return false
        this.signIn(user)
        return true
      } catch {
        return false
      }
    },
  },
})
