<script setup>
/* ============================================================
   TermsView.vue — plain-language terms of use.
   DRAFT, not reviewed by a lawyer -- see the notice banner below.
   ============================================================ */
</script>

<template>
  <div class="legal-page">
    <h1 class="page-title">Terms and Conditions</h1>
    <div class="legal-updated">Last updated: this is a project document — update the date when you edit it.</div>

    <div class="legal-notice">
      This is a draft written for a thesis prototype, not a substitute for legal advice — have it
      reviewed before any real (non-classroom-test) deployment.
    </div>

    <h2>1. What this system is</h2>
    <p>
      An automated grading tool for handwritten objective exams (multiple choice, true/false,
      identification, and enumeration). It is a research prototype: automated recognition and
      grading can be wrong, and every result is meant to be reviewed by the teacher, not relied on
      as a final grade without review.
    </p>

    <h2>2. Accounts</h2>
    <p>
      You are responsible for keeping your username and password confidential and for all activity
      under your account. Tell the administrator if you believe your account has been accessed
      without authorization.
    </p>

    <h2>3. Your responsibility for student data you upload</h2>
    <p>
      By uploading a scanned or photographed answer sheet, you confirm that you are authorized to
      collect and process that student's information for grading purposes under your institution's
      own policies, and that any consent your institution or research protocol requires (see the
      <RouterLink :to="{ name: 'privacy' }">Privacy Policy</RouterLink>) has already been obtained
      before the upload. This system does not verify that consent on your behalf — that
      responsibility stays with you and your institution.
    </p>

    <h2>4. Acceptable use</h2>
    <ul>
      <li>Use the system only for legitimate grading of exams you are authorized to grade.</li>
      <li>Do not upload sheets or data you are not authorized to collect or process.</li>
      <li>Do not attempt to access another teacher's account or data.</li>
      <li>Do not use the system in a way that disrupts its operation for others.</li>
    </ul>

    <h2>5. No warranty</h2>
    <p>
      This system is provided "as is," as a research prototype, without warranty of any kind,
      including accuracy of handwriting recognition or grading. Flagged and low-confidence results
      exist specifically because automated recognition is not perfect — always review them before
      treating a grade as final.
    </p>

    <h2>6. Limitation of liability</h2>
    <p>
      To the fullest extent permitted by law, the developers of this prototype are not liable for
      grading errors, data loss, or any damages arising from use of this system. This is academic,
      non-commercial software, not a warranted commercial product.
    </p>

    <h2>7. Termination</h2>
    <p>
      An account may be suspended or removed for violating these terms or applicable law. You may
      request deletion of your account and associated data at any time.
    </p>

    <h2>8. Governing law</h2>
    <p>
      These terms are governed by the laws of the Republic of the Philippines, without regard to
      conflict-of-law principles.
    </p>

    <h2>9. Changes</h2>
    <p>
      These terms may be updated as the system changes. Continued use after an update means you
      accept the revised terms.
    </p>

    <RouterLink :to="{ name: 'login' }" class="legal-back">&larr; Back to login</RouterLink>
  </div>
</template>
