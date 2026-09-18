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

import { computed, ref, onMounted } from 'vue'
import { API } from '@/services/api.js'
// Theme is a device display preference, not account data, and
// loadSavedTheme() in main.js runs before login exists -- so it (and
// this tab's saved-theme readout) deliberately stay on localStorage
// rather than the authenticated backend. See services/theme.js.
import { DB } from '@/services/database.js'
import { useAppStore } from '@/stores/app.js'
import { showMessage } from '@/services/dialog.js'
import { PALETTES, DEFAULT_THEME, applyTheme } from '@/services/theme.js'
import { useResendCooldown } from '@/composables/useResendCooldown.js'
import { questionnaireHtml, paginatePreview } from '@/services/questionnaireTemplate.js'
import PasswordField from '@/components/PasswordField.vue'
import PasswordRules from '@/components/PasswordRules.vue'
import LegalDocumentLink from '@/components/LegalDocumentLink.vue'

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

/* ------------------------------------------------------------ Email */

const emailForm = ref({ email: store.currentUser?.email || '' })
const isEmailVerified = computed(() => Boolean(store.currentUser?.email_verified))
const verifiedLabel = computed(() => (isEmailVerified.value ? 'Verified' : 'Not Verified'))
const verifiedBadgeClass = computed(() => (isEmailVerified.value ? 'badge-success' : 'badge-warning'))

const codeSent = ref(false)
const sendingCode = ref(false)
const verifyingCode = ref(false)
const verifyCodeInput = ref('')

// Mirrors the backend's 5-minute resend cooldown (see auth.py's
// RESEND_COOLDOWN) so the button visibly can't be spammed.
const RESEND_COOLDOWN_SECONDS = 300
const emailCooldown = useResendCooldown()

async function saveEmail() {
  const email = emailForm.value.email.trim()
  if (!email) {
    await showMessage('Email Required', 'Enter an email address before saving.')
    return
  }
  if (email === (store.currentUser?.email || '')) {
    await showMessage('No Changes', "You haven't changed the email address.")
    return
  }
  try {
    store.currentUser = await API.updateEmail(email)
    codeSent.value = false
    verifyCodeInput.value = ''
    await showMessage('Email Saved', 'Email address saved. Verify it below to use it for password resets.')
  } catch (error) {
    await showMessage('Save Failed', error.message || 'Email could not be saved.')
  }
}

async function sendVerifyCode() {
  if (emailCooldown.active.value) return
  sendingCode.value = true
  try {
    await API.sendVerificationCode()
    codeSent.value = true
    emailCooldown.start(RESEND_COOLDOWN_SECONDS)
    await showMessage('Code Sent', `A 6-digit code was sent to ${store.currentUser?.email}.`)
  } catch (error) {
    if (error.retryAfterSeconds) {
      // A code went out recently -- not a real failure, just reflect
      // the existing cooldown and let the teacher enter that one.
      emailCooldown.start(error.retryAfterSeconds)
      codeSent.value = true
    } else {
      await showMessage('Send Failed', error.message || 'Could not send a verification code.')
    }
  } finally {
    sendingCode.value = false
  }
}

async function submitVerifyCode() {
  if (!verifyCodeInput.value.trim()) {
    await showMessage('Code Required', 'Enter the 6-digit code sent to your email.')
    return
  }
  verifyingCode.value = true
  let ok = false
  try {
    ok = await API.verifyEmailCode(verifyCodeInput.value.trim())
  } catch (error) {
    verifyingCode.value = false
    await showMessage('Verification Failed', error.message || 'Could not verify the code.')
    return
  }
  verifyingCode.value = false
  if (!ok) {
    await showMessage('Incorrect Code', 'That code is incorrect or has expired. Try resending a new one.')
    return
  }
  if (store.currentUser) store.currentUser.email_verified = true
  codeSent.value = false
  verifyCodeInput.value = ''
  await showMessage('Email Verified', 'Your email address has been verified.')
}

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
  const newPwError = changingPassword ? API.passwordError(next) : null
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
    if (changingPassword && !(await API.updateUserPassword(user.id, current, next))) {
      markInvalid('current')
      await showMessage('Incorrect Password', 'The current password is incorrect.')
      return
    }
    /* Assigning to the store is all that is needed — the sidebar and
       top bar bind to currentUser, so the old updateUserLabels() call
       has no equivalent here. */
    store.currentUser = await API.updateUserProfile(user.id, name, account.value.institution.trim())
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

const prefs = ref({ folder_label: 'Downloads', filename_format: '' })
onMounted(async () => {
  prefs.value = await API.getExportPreferences()
})
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
  prefs.value = await API.setExportPreferences({
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
  paginatePreview(preview.document)
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

function previewConsentForm() {
  const preview = window.open('', '_blank')
  if (!preview) {
    showMessage('Preview Blocked', 'Allow pop-ups for this page to preview the consent form.')
    return
  }
  preview.document.open()
  preview.document.write(consentFormHtml())
  preview.document.close()
}

function downloadConsentForm() {
  const blob = new Blob([consentFormHtml()], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'ags_student_data_consent_form.html'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/* Paper consent form for a student (or guardian, if a minor) to sign
   BEFORE their answer sheet is scanned/photographed and processed --
   this is what `student_info.consent_status` in the database records
   the outcome of (see database/migrations). This form itself is never
   submitted through the app; it exists to be printed, signed on
   paper, and kept on file per your institution's research ethics
   requirements -- consistent with the Philippine Data Privacy Act of
   2012 (RA 10173), which is why the language below cites it. */
function consentFormHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Student Data Consent Form</title>
  <style>
    * { box-sizing: border-box; }
    body { max-width: 720px; margin: 28px auto; padding: 0 24px; font-family: Arial, sans-serif; color: #111827; line-height: 1.6; }
    h1 { font-size: 19px; text-align: center; margin-bottom: 4px; }
    .subtitle { text-align: center; color: #4b5563; margin-bottom: 22px; font-size: 13px; }
    h2 { font-size: 14px; margin: 20px 0 6px; }
    p, li { font-size: 13px; }
    .fields { margin-top: 26px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px 28px; }
    .line { min-height: 30px; padding-top: 8px; border-bottom: 1px solid #111827; }
    .checkbox-line { margin: 10px 0; }
    .sign-block { margin-top: 34px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px 28px; }
    .print { margin: 0 0 18px; padding: 8px 14px; border: 0; background: #1f6fb2; color: white; cursor: pointer; }
    @media print { body { margin: 0; max-width: none; } .print { display: none; } }
  </style>
</head>
<body>
  <button class="print" onclick="window.print()">Print Form</button>
  <h1>Student Data Consent Form</h1>
  <div class="subtitle">Automated Grading System for Handwritten Objective Examinations</div>

  <p>
    This exam is part of a system that automatically scans and grades handwritten answer sheets
    for research purposes. Your answer sheet (or your child's, if you are signing as a
    parent/guardian) will be photographed or scanned, and the handwriting and score will be
    processed and stored as described below.
  </p>

  <h2>What is collected</h2>
  <ul>
    <li>Your name and section, as written on the answer sheet.</li>
    <li>A photograph/scan of your answer sheet, including your handwritten answers.</li>
    <li>The automatically recognized answers and resulting score.</li>
  </ul>

  <h2>How it is used</h2>
  <p>
    Solely to grade this exam and, if you consent below, to support the related research project.
    Results reported in any research output will use a de-identified code, not your name, in line
    with the Philippine Data Privacy Act of 2012 (RA 10173).
  </p>

  <h2>Your choice</h2>
  <p>Participation is voluntary. Declining does not affect how your exam is graded or scored by
    your teacher through the usual (non-automated) process.</p>

  <div class="checkbox-line">&#9633; I consent to my answer sheet being processed as described above.</div>
  <div class="checkbox-line">&#9633; I do not consent. (My sheet will still be graded normally, outside this system.)</div>

  <div class="fields">
    <div>Student Name:<div class="line"></div></div>
    <div>Section:<div class="line"></div></div>
    <div>Date:<div class="line"></div></div>
    <div>Parent/Guardian Name (if applicable):<div class="line"></div></div>
  </div>

  <div class="sign-block">
    <div>Signature:<div class="line"></div></div>
    <div>Signature (parent/guardian, if applicable):<div class="line"></div></div>
  </div>
</body>
</html>`
}

/* Sample content in the exact shape collectItems() produces in
   AnswerKeyView.vue -- 5 Multiple Choice, 5 True or False, 5
   Identification, 2 Enumeration groups (3 blanks each). This exists so
   a teacher can see the real paper format (underline blanks, section
   numbering, choices grid) before ever building an actual answer key --
   not a generic placeholder table that looks nothing like what
   actually gets printed/scanned, which is what used to be here. */
function exampleItems() {
  const items = []
  let itemNo = 0
  const next = () => (itemNo += 1)

  const mc = [
    { q: 'What is the capital of the Philippines?', choices: ['Manila', 'Cebu', 'Davao', 'Baguio'], correct: 'a' },
    { q: 'Which of the following is a prime number?', choices: ['4', '6', '7', '9'], correct: 'c' },
    { q: 'What is the chemical symbol for water?', choices: ['CO2', 'H2O', 'O2', 'NaCl'], correct: 'b' },
    { q: "Who composed the Philippine national anthem's music?", choices: ['Julian Felipe', 'Jose Rizal', 'Andres Bonifacio', 'Emilio Aguinaldo'], correct: 'a' },
    { q: 'What is 12 x 12?', choices: ['124', '144', '134', '154'], correct: 'b' },
  ]
  mc.forEach(({ q, choices, correct }) => {
    items.push({
      item_no: next(), type: 'Multiple Choice', enum_group: null, question_text: q,
      choices: { a: choices[0], b: choices[1], c: choices[2], d: choices[3] }, correct_answer: correct,
    })
  })

  const tf = [
    ['The sun rises in the east.', 'True'],
    ['A triangle has four sides.', 'False'],
    ['The Philippines is composed of three major island groups.', 'True'],
    ['Water boils at 50 degrees Celsius at sea level.', 'False'],
    ['Manila is the capital of the Philippines.', 'True'],
  ]
  tf.forEach(([q, correct]) => {
    items.push({ item_no: next(), type: 'True or False', enum_group: null, question_text: q, choices: null, correct_answer: correct })
  })

  const ident = [
    ['What is the study of living organisms called?', 'Biology'],
    ['What is the largest planet in our solar system?', 'Jupiter'],
    ['What do you call the process by which plants make their own food?', 'Photosynthesis'],
    ['What is the national language of the Philippines?', 'Filipino'],
    ['What do you call a group of islands?', 'Archipelago'],
  ]
  ident.forEach(([q, correct]) => {
    items.push({ item_no: next(), type: 'Identification', enum_group: null, question_text: q, choices: null, correct_answer: correct })
  })

  const enumGroups = [
    ['Name the three branches of the Philippine government.', ['Executive', 'Legislative', 'Judicial']],
    ['Name the three primary colors.', ['Red', 'Blue', 'Yellow']],
  ]
  enumGroups.forEach(([q, answers], groupIdx) => {
    answers.forEach((a) => {
      items.push({ item_no: next(), type: 'Enumeration', enum_group: groupIdx + 1, question_text: q, choices: null, correct_answer: a })
    })
  })

  return items
}

/* A standalone printable document built through the same
   questionnaireHtml() every real answer key's Preview/Print uses (see
   AnswerKeyView.vue) -- this is what keeps the example honestly
   matching the real paper format instead of drifting into its own
   look, the way the old hand-rolled table version had. */
function templateHtml() {
  return questionnaireHtml('Example Answer Key', exampleItems())
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

        <div class="form-group settings-span-2">
          <label class="form-label" for="set-email">
            Email Address
            <span class="badge" :class="verifiedBadgeClass">{{ verifiedLabel }}</span>
          </label>
          <input
            id="set-email"
            v-model="emailForm.email"
            type="email"
            placeholder="you@example.com"
            title="Used to verify your account and reset your password if you forget it."
          >
          <div class="settings-actions mt-8">
            <button class="btn btn-secondary btn-small" @click="saveEmail">Save Email</button>
            <button
              v-if="!isEmailVerified"
              class="btn btn-secondary btn-small"
              :disabled="sendingCode || emailCooldown.active.value"
              @click="sendVerifyCode"
            >
              {{ emailCooldown.active.value
                ? `Resend Code (${emailCooldown.formatted.value})`
                : (codeSent ? 'Resend Code' : 'Send Verification Code') }}
            </button>
          </div>
          <div v-if="codeSent" class="form-group mt-8">
            <label class="form-label" for="set-email-code">Verification Code</label>
            <input
              id="set-email-code"
              v-model="verifyCodeInput"
              type="text"
              inputmode="numeric"
              maxlength="6"
              placeholder="6-digit code"
            >
            <div class="settings-actions mt-8">
              <button class="btn btn-primary btn-small" :disabled="verifyingCode" @click="submitVerifyCode">
                Verify
              </button>
            </div>
          </div>
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
            A worked example (5 Multiple Choice, 5 True/False, 5 Identification, 2 Enumeration groups)
            showing the real paper format -- the same layout, section numbering, and underline blanks
            a real answer key's Preview/Print produces.
          </div>
        </div>
        <span class="badge badge-blue">HTML Template</span>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" @click="previewTemplate">Preview Template</button>
        <button class="btn btn-secondary" @click="downloadTemplate">Download Template</button>
      </div>

      <div class="template-summary mt-14">
        <div>
          <div class="section-title">Student data consent form</div>
          <div class="muted-text mt-8">
            A printable form for a student (or guardian) to sign before their answer sheet is
            processed by this system — see the Privacy Policy for what that processing involves.
          </div>
        </div>
        <span class="badge badge-blue">HTML Template</span>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" @click="previewConsentForm">Preview Consent Form</button>
        <button class="btn btn-secondary" @click="downloadConsentForm">Download Consent Form</button>
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
      <div class="settings-actions mt-14">
        <LegalDocumentLink document="terms" class="btn btn-secondary btn-small">Terms</LegalDocumentLink>
        <LegalDocumentLink document="privacy" class="btn btn-secondary btn-small">Privacy Policy</LegalDocumentLink>
        <LegalDocumentLink document="cookies" class="btn btn-secondary btn-small">Cookie Policy</LegalDocumentLink>
      </div>
    </section>
  </div>
</template>
