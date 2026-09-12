/* ============================================================
   stores/app.js — shared application state (replaces App.state)

   In the original app this was a plain object in app.js, and every
   mutation had to be followed by a manual call such as
   updateUserLabels(). Here the sidebar and top bar bind to
   `currentUser` directly, so the UI follows the data on its own.
   ============================================================ */

import { defineStore } from 'pinia'
import { API } from '@/services/api.js'

export const useAppStore = defineStore('app', {
  state: () => ({
    currentUser: null,
    selectedAnswerKeyId: null,
    /* Normalized upload entries staged by the Upload page — was
       App.state.uploadPaths. Each entry wraps the browser File plus
       the derived fields Processing reads: key, name, size, type,
       lastModified, relativePath, source. */
    uploadFiles: [],
    /* The teacher's attestation, on the Upload page, that paper consent
       (SettingsView.vue's downloadable consent form) was already
       collected for every student in the current queue -- this is what
       student_info.consent_status actually records per upload, so it
       resets with every new queue rather than persisting silently. */
    consentConfirmed: false,
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
     * Mirrors clearRuntimeSelection() in the original app.js. Reads
     * through the FastAPI backend now that every page that consumes
     * these ids (Answer Keys, Upload, Processing, Results) does too --
     * a localStorage id here would no longer match anything.
     */
    async clearRuntimeSelection() {
      this.uploadFiles = []
      this.consentConfirmed = false
      this.currentSessionId = await API.latestSessionId()
      this.selectedStudentResultId = null
      this.selectedFlaggedItemId = null

      const keys = await API.answerKeys()
      this.selectedAnswerKeyId = keys.length ? keys[0].id : null
    },

    async signIn(user) {
      this.currentUser = user
      await this.clearRuntimeSelection()
    },

    async signOut() {
      // Clears the FastAPI session cookie so a stale cookie can't
      // silently re-authenticate the next visitor on a shared machine.
      await API.logout().catch(() => {})
      this.currentUser = null
    },

    /**
     * Restore a session if the browser still holds a valid one.
     * Returns true when a user was restored.
     *
     * Auth now runs through the FastAPI backend (see api.js), which
     * uses a signed session cookie rather than the old localStorage
     * "remembered_user_id" scheme — so restoring just means asking the
     * backend "is this cookie still good?" instead of looking anything
     * up locally.
     */
    async restoreRememberedUser() {
      const user = await API.getCurrentUser()
      if (!user) return false
      await this.signIn(user)
      return true
    },
  },
})
