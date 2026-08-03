<script setup>
/* ============================================================
   SettingsView.vue — account, template, export, theme, and about
   Ported from js/settings.js.

   Two things moved out of this page on the way over:
   the palette table and applyTheme() now live in services/theme.js,
   because main.js also needs them at boot, and the password
   show/hide toggle plus the live rule list are the shared
   PasswordField / PasswordRules components.

   The tab strip is a single `activeTab` ref instead of the
   class-toggling loops in _attachTabs().
   ============================================================ */

import { computed, ref } from 'vue'
import { DB } from '@/services/database.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'
import { PALETTES, DEFAULT_THEME, applyTheme } from '@/services/theme.js'
import PasswordField from '@/components/PasswordField.vue'
import PasswordRules from '@/components/PasswordRules.vue'

const store = useAppStore()

const TABS = [
  { id: 'set-account', label: 'Account' },
  { id: 'set-template', label: 'Exam Template' },
  { id: 'set-export', label: 'Export Preferences' },
  { id: 'set-theme', label: 'Application Theme' },
  { id: 'set-about', label: 'About' },
]

const activeTab = ref('set-account')

/* ---------------------------------------------------------- Account */

const account = ref({
  full_name: store.currentUser?.full_name || '',
  institution: store.currentUser?.institution || '',
})
const passwords = ref({ current: '', next: '', confirm: '' })
const invalid = ref(new Set())

const username = computed(() => store.currentUser?.username || '')

function isInvalid(field) {
  return invalid.value.has(field)
}

function markInvalid(...fields) {
  invalid.value = new Set(fields)
}

async function saveAccount() {
  const user = store.currentUser
  if (!user) {
    await showMessage('Not Signed In', 'Please sign in before changing account settings.')
    return
  }

  invalid.value = new Set()
  const name = account.value.full_name.trim()
  if (!name) {
    markInvalid('full_name')
    await showMessage('Teacher Name Required', 'Enter the teacher name before saving.')
    return
  }

  const { current, next, confirm } = passwords.value
  const changingPassword = Boolean(current || next || confirm)

  if (changingPassword && !(current && next && confirm)) {
    markInvalid('current', 'next', 'confirm')
    await showMessage(
      'Password Fields Required',
      'Complete all three password fields to change the password.',
    )
    return
  }
  const newPwError = changingPassword ? DB.passwordError(next) : null
  if (newPwError) {
    markInvalid('next')
    await showMessage('Weak Password', newPwError)
    return
  }
  if (changingPassword && next !== confirm) {
    markInvalid('next', 'confirm')
    await showMessage('Passwords Do Not Match', 'The new password and confirmation must match.')
    return
  }

  try {
    if (changingPassword && !DB.updateUserPassword(user.id, current, next)) {
      markInvalid('current')
      await showMessage('Incorrect Password', 'The current password is incorrect.')
      return
    }
    /* Assigning to the store is all that is needed — the sidebar and
       top bar bind to currentUser, so the old updateUserLabels() call
       has no equivalent here. */
    store.currentUser = DB.updateUserProfile(user.id, name, account.value.institution.trim())
    passwords.value = { current: '', next: '', confirm: '' }
    account.value = {
      full_name: store.currentUser.full_name,
      institution: store.currentUser.institution || '',
    }
    await showMessage(
      'Settings Saved',
      changingPassword ? 'Profile and password changes were saved.' : 'Profile changes were saved.',
    )
  } catch (error) {
    await showMessage('Save Failed', error.message || 'Account settings could not be saved.')
  }
}

/* --------------------------------------------------- Export prefs */

const prefs = ref(DB.getExportPreferences())
const filenameInvalid = ref(false)

const PREF_TOGGLES = [
  { field: 'include_student_info', label: 'Student name and section' },
  { field: 'include_item_scores', label: 'Item-level details and scores' },
  { field: 'include_total_score', label: 'Total score and percentage' },
  { field: 'include_flagged_notes', label: 'Flagged counts, status, and notes' },
  { field: 'include_question_type', label: 'Question type' },
]

async function saveExportPreferences() {
  filenameInvalid.value = false
  if (!prefs.value.filename_format.trim()) {
    filenameInvalid.value = true
    await showMessage('Filename Required', 'Enter an export filename format before saving.')
    return
  }
  prefs.value = DB.setExportPreferences({
    ...prefs.value,
    folder_label: prefs.value.folder_label.trim() || 'Downloads',
  })
  await showMessage('Preferences Saved', 'Export filename and column preferences were saved.')
}

/* ------------------------------------------------------- Template */

function previewTemplate() {
  const preview = window.open('', '_blank')
  if (!preview) {
    showMessage('Preview Blocked', 'Allow pop-ups for this page to preview the exam template.')
    return
  }
  preview.document.open()
  preview.document.write(templateHtml())
  preview.document.close()
}

function downloadTemplate() {
  const blob = new Blob([templateHtml()], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'ags_exam_template.html'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/* A standalone printable document, so it stays a plain HTML string
   rather than a component — it is never mounted in this app. */
function templateHtml() {
  const rows = Array.from(
    { length: 20 },
    (_, index) => `<tr><td>${index + 1}</td><td></td><td></td></tr>`,
  ).join('')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AGS Exam Template</title>
  <style>
    * { box-sizing: border-box; }
    body { max-width: 820px; margin: 28px auto; padding: 0 24px; font-family: Arial, sans-serif; color: #111827; }
    h1 { margin: 0 0 4px; text-align: center; font-size: 21px; }
    .subtitle { text-align: center; color: #4b5563; margin-bottom: 24px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 28px; }
    .line { min-height: 30px; padding-top: 8px; border-bottom: 1px solid #111827; }
    table { width: 100%; margin-top: 22px; border-collapse: collapse; }
    th, td { height: 34px; padding: 7px; border: 1px solid #111827; text-align: left; }
    th { background: #e5e7eb; }
    th:first-child, td:first-child { width: 70px; text-align: center; }
    .print { margin: 0 0 18px; padding: 8px 14px; border: 0; background: #1f6fb2; color: white; cursor: pointer; }
    @media print { body { margin: 0; max-width: none; } .print { display: none; } }
  </style>
</head>
<body>
  <button class="print" onclick="window.print()">Print Template</button>
  <h1>Automated Grading System Answer Sheet</h1>
  <div class="subtitle">Handwritten Objective Examination Template</div>
  <div class="fields">
    <div>Name:<div class="line"></div></div>
    <div>Section:<div class="line"></div></div>
    <div>Date:<div class="line"></div></div>
    <div>Subject:<div class="line"></div></div>
  </div>
  <table>
    <thead><tr><th>Item #</th><th>Question Type</th><th>Answer</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`
}

/* ---------------------------------------------------------- Theme */

const themes = Object.entries(PALETTES).map(([key, palette]) => ({ key, ...palette }))

/* Fall back the same way applyTheme() does. Showing the raw saved value
   left no swatch highlighted when the stored key was unrecognised, even
   though the app was visibly running the default palette. */
const savedTheme = DB.getSettings().theme
const activeTheme = ref(PALETTES[savedTheme] ? savedTheme : DEFAULT_THEME)

function selectTheme(key) {
  activeTheme.value = key
  applyTheme(key)
}
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">Settings</div>
      <div class="page-subtitle">
        Manage the teacher account, exam template, exports, and appearance.
      </div>
    </div>

    <div class="tabs settings-tabs" role="tablist">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Account -->
    <section
      class="tab-content settings-panel"
      :class="{ active: activeTab === 'set-account' }"
      role="tabpanel"
    >
      <div class="card-title">Account Settings</div>
      <div class="settings-form-grid">
        <div class="form-group">
          <label class="form-label" for="set-name">Teacher Name</label>
          <input
            id="set-name"
            v-model="account.full_name"
            type="text"
            maxlength="120"
            :class="{ invalid: isInvalid('full_name') }"
          >
        </div>
        <div class="form-group">
          <label class="form-label" for="set-inst">Institution</label>
          <input id="set-inst" v-model="account.institution" type="text" maxlength="160">
        </div>
        <div class="form-group settings-span-2">
          <label class="form-label" for="set-user">Username</label>
          <input id="set-user" type="text" :value="username" readonly>
        </div>

        <div class="form-group">
          <span class="form-label">Current Password</span>
          <PasswordField
            v-model="passwords.current"
            placeholder="Required only when changing the password"
            :invalid="isInvalid('current')"
          />
        </div>
        <div class="form-group">
          <span class="form-label">New Password</span>
          <PasswordField
            v-model="passwords.next"
            placeholder="New password"
            :invalid="isInvalid('next')"
          />
          <PasswordRules :password="passwords.next" />
        </div>
        <div class="form-group">
          <span class="form-label">Confirm New Password</span>
          <PasswordField
            v-model="passwords.confirm"
            placeholder="Repeat the new password"
            :invalid="isInvalid('confirm')"
          />
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" @click="saveAccount">Save Changes</button>
      </div>
    </section>

    <!-- Exam template -->
    <section
      class="tab-content settings-panel"
      :class="{ active: activeTab === 'set-template' }"
      role="tabpanel"
    >
      <div class="card-title">Exam Template</div>
      <div class="template-summary">
        <div>
          <div class="section-title">Print-ready answer sheet</div>
          <div class="muted-text mt-8">
            Includes student fields and 20 standardized item rows for handwritten objective answers.
          </div>
        </div>
        <span class="badge badge-blue">HTML Template</span>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" @click="previewTemplate">Preview Template</button>
        <button class="btn btn-secondary" @click="downloadTemplate">Download Template</button>
      </div>
    </section>

    <!-- Export preferences -->
    <section
      class="tab-content settings-panel"
      :class="{ active: activeTab === 'set-export' }"
      role="tabpanel"
    >
      <div class="card-title">Export Preferences</div>
      <div class="settings-form-grid">
        <div class="form-group">
          <label class="form-label" for="set-export-folder">Download Location Label</label>
          <input
            id="set-export-folder"
            v-model="prefs.folder_label"
            type="text"
            maxlength="80"
          >
          <div class="muted-text mt-8">
            This label is saved for reference. The browser controls the actual download location.
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="set-export-filename">Filename Format</label>
          <input
            id="set-export-filename"
            v-model="prefs.filename_format"
            type="text"
            :class="{ invalid: filenameInvalid }"
          >
          <div class="muted-text mt-8">
            Tokens: {session}, {date}, {answer_key}, {subject}, {section}
          </div>
        </div>
      </div>
      <fieldset class="preference-group">
        <legend>Included data</legend>
        <label v-for="toggle in PREF_TOGGLES" :key="toggle.field" class="checkbox-row">
          <input v-model="prefs[toggle.field]" type="checkbox"> <span>{{ toggle.label }}</span>
        </label>
      </fieldset>
      <div class="settings-actions">
        <button class="btn btn-primary" @click="saveExportPreferences">Save Preferences</button>
      </div>
    </section>

    <!-- Theme -->
    <section
      class="tab-content settings-panel"
      :class="{ active: activeTab === 'set-theme' }"
      role="tabpanel"
    >
      <div class="card-title">Application Theme</div>
      <div class="theme-row">
        <button
          v-for="theme in themes"
          :key="theme.key"
          class="theme-swatch"
          :class="{ active: activeTheme === theme.key }"
          :style="{ background: theme.swatch }"
          :aria-pressed="activeTheme === theme.key"
          @click="selectTheme(theme.key)"
        >
          {{ theme.label }}
        </button>
      </div>
    </section>

    <!-- About -->
    <section
      class="tab-content settings-panel"
      :class="{ active: activeTab === 'set-about' }"
      role="tabpanel"
    >
      <div class="card-title">About</div>
      <div class="about-copy">
        Automated Grading System for Handwritten Objective Examinations Using Deep Learning<br><br>
        Researchers: Bueta, Cosico, Lumalang<br>
        Adviser: Prince Ross Andres<br>
        Laguna State Polytechnic University - San Pablo City Campus<br>
        A.Y. 2026-2027<br><br>
        Web frontend with an intentional model-pending processing adapter.
      </div>
    </section>
  </div>
</template>
