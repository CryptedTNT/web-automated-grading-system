<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  document: { type: String, required: true },
})
const emit = defineEmits(['close', 'show-document'])
const closeButton = ref(null)

const titles = {
  terms: 'Terms and Conditions',
  privacy: 'Privacy Policy',
  cookies: 'Cookie Policy',
}
const title = computed(() => titles[props.document] || 'Legal document')

async function focusClose() {
  await nextTick()
  closeButton.value?.focus()
}
function onKeydown(event) {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  focusClose()
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
watch(() => props.document, focusClose)
</script>

<template>
  <div class="legal-modal-overlay" @click.self="emit('close')">
    <section class="legal-modal" role="dialog" aria-modal="true" :aria-labelledby="'legal-document-title'">
      <header class="legal-modal-header">
        <div>
          <span class="legal-modal-eyebrow">Legal information</span>
          <h2 id="legal-document-title">{{ title }}</h2>
        </div>
        <button ref="closeButton" type="button" class="legal-close" aria-label="Close legal document" @click="emit('close')">×</button>
      </header>

      <div class="legal-modal-body" tabindex="0">
        <template v-if="document === 'terms'">
          <p class="legal-updated">Last updated: this is a project document — update the date when you edit it.</p>
          <div class="legal-notice">This is a draft written for a thesis prototype, not a substitute for legal advice — have it reviewed before any real (non-classroom-test) deployment.</div>
          <h3>1. What this system is</h3>
          <p>An automated grading tool for handwritten objective exams (multiple choice, true/false, identification, and enumeration). It is a research prototype: automated recognition and grading can be wrong, and every result is meant to be reviewed by the teacher, not relied on as a final grade without review.</p>
          <h3>2. Accounts</h3>
          <p>You are responsible for keeping your username and password confidential and for all activity under your account. Tell the administrator if you believe your account has been accessed without authorization.</p>
          <h3>3. Your responsibility for student data you upload</h3>
          <p>By uploading a scanned or photographed answer sheet, you confirm that you are authorized to collect and process that student's information for grading purposes under your institution's own policies, and that any consent your institution or research protocol requires has already been obtained before the upload.</p>
          <h3>4. Acceptable use</h3>
          <ul><li>Use the system only for legitimate grading of exams you are authorized to grade.</li><li>Do not upload sheets or data you are not authorized to collect or process.</li><li>Do not attempt to access another teacher's account or data.</li><li>Do not use the system in a way that disrupts its operation for others.</li></ul>
          <h3>5. No warranty</h3>
          <p>This system is provided “as is,” as a research prototype, without warranty of any kind, including accuracy of handwriting recognition or grading. Always review flagged and low-confidence results before treating a grade as final.</p>
          <h3>6. Limitation of liability</h3>
          <p>To the fullest extent permitted by law, the developers of this prototype are not liable for grading errors, data loss, or damages arising from use of this academic, non-commercial software.</p>
          <h3>7. Termination and changes</h3>
          <p>An account may be suspended or removed for violating these terms or applicable law. These terms may be updated as the system changes; continued use after an update means you accept the revised terms.</p>
        </template>

        <template v-else-if="document === 'privacy'">
          <p class="legal-updated">Last updated: this is a project document — update the date when you edit it.</p>
          <div class="legal-notice">This is a draft written for a thesis prototype, not a substitute for legal advice. Before processing any real student data, have it reviewed against your institution's data privacy and research ethics requirements.</div>
          <h3>1. Who this applies to</h3>
          <p>This system connects teachers, who create accounts and use the system directly, and students, whose names, handwriting, and scores may appear because a teacher uploaded their answer sheets for grading. Students do not create accounts or use this system directly.</p>
          <h3>2. What we collect</h3>
          <p><strong>Teacher account data:</strong> full name, institution, username, hashed password, and an email address for account verification and password reset.</p>
          <p><strong>Student data:</strong> the name and section recognized from an uploaded answer sheet, answer regions cropped from the image, the system's best-effort reading of each answer, and resulting scores. A participant code and consent status may also be recorded.</p>
          <p><strong>What we do not collect:</strong> advertising identifiers, location data, contact lists, or information from any source other than what a teacher directly provides.</p>
          <h3>3. Why we process this data</h3>
          <p>Student data is processed solely to grade objective exams automatically and let the teacher review, correct, and export results. It is not sold, shared with advertisers, or used to profile anyone.</p>
          <h3>4. Cookies and third-party services</h3>
          <p>A single functional cookie keeps a teacher signed in between page loads. The application does not use advertising or analytics cookies. SheetJS is used for client-side Excel export, and Gmail may send a teacher their own verification or reset codes; neither receives student data as part of grading.</p>
          <h3>5. Retention, security, and rights</h3>
          <p>Uploaded sheets, recognized answers, and results are kept while the teacher account and grading sessions exist. Passwords and verification/reset codes are hashed. A teacher or student, through their institution, may request access to, correction of, or erasure of personal data in line with applicable law.</p>
          <h3>6. Changes and contact</h3>
          <p>Meaningful changes will be reflected in the last-updated line. Questions about this policy or data requests should go to the researchers or administrator operating this deployment.</p>
          <p class="legal-cross-link">For browser storage details, see the <button type="button" class="legal-document-link" @click="emit('show-document', 'cookies')">Cookie Policy</button>.</p>
        </template>

        <template v-else>
          <p class="legal-updated">Last updated: this is a project document — update the date when you edit it.</p>
          <div class="legal-notice">This is a draft written for a thesis prototype, not a substitute for legal advice.</div>
          <h3>What this system actually uses</h3>
          <p>Exactly two small pieces of browser storage, and nothing else:</p>
          <ul><li><strong>A session cookie</strong> keeps you signed in between page loads. It is strictly necessary for the system to function.</li><li><strong>A local storage entry for your theme preference</strong> remembers your chosen color theme on this device. It never leaves your browser.</li></ul>
          <h3>No consent banner, and why</h3>
          <p>This system does not use analytics, advertising, or tracking cookies. It uses only storage required to operate the signed-in service, which is why there is no optional cookie-consent banner.</p>
          <h3>Third-party cookies</h3>
          <p>None are set by this system. SheetJS, used to build Excel exports in your browser, is loaded from a CDN but does not set cookies or track users.</p>
          <h3>Managing this yourself</h3>
          <p>Clearing browser cookies or local site data will sign you out and reset your theme to the default. Blocking the required session cookie prevents sign-in.</p>
        </template>
      </div>
    </section>
  </div>
</template>
