<script setup>
/* ============================================================
   PrivacyPolicyView.vue — plain-language privacy notice.

   DRAFT, not reviewed by a lawyer -- see the notice banner in the
   template. Grounded in what the app actually does as of when this
   was written: a FastAPI + MySQL backend, one functional session
   cookie (see backend/app/main.py's SessionMiddleware), no analytics/
   tracking scripts, one third-party script load (SheetJS, for
   client-side Excel export -- see vue-app/index.html), and Gmail SMTP
   used only to email the *teacher's own* verification/reset codes
   (see backend/app/email_sender.py). Update this if any of that
   changes -- a privacy policy that no longer matches the code is worse
   than no policy at all.
   ============================================================ */
</script>

<template>
  <div class="legal-page">
    <h1 class="page-title">Privacy Policy</h1>
    <div class="legal-updated">Last updated: this is a project document — update the date when you edit it.</div>

    <div class="legal-notice">
      This is a draft written for a thesis prototype, not a substitute for legal advice. Before
      processing any real (non-test) student data, have this reviewed against your institution's
      data privacy office / research ethics board requirements — that review, not this page, is
      what actually governs whether real data collection is permitted.
    </div>

    <h2>1. Who this applies to</h2>
    <p>
      This system has two kinds of people connected to it, and they are treated differently:
    </p>
    <ul>
      <li><strong>Teachers</strong>, who create an account, sign in, and use the system directly.</li>
      <li><strong>Students</strong>, whose names, handwriting, and scores appear in the system because a
        teacher uploaded their answer sheets for grading. Students do not create accounts or use this
        system themselves — their data is processed by and on behalf of the teacher/institution.</li>
    </ul>

    <h2>2. What we collect</h2>
    <p><strong>Teacher account data:</strong> full name, institution, username, a hashed password
      (never stored in plain text), and an email address used only for account verification and
      password reset.</p>
    <p><strong>Student data (uploaded by a teacher):</strong> the student's name and section as
      recognized from a scanned/photographed answer sheet, the handwritten answer regions cropped
      from that image, the system's best-effort reading of each answer, and the resulting scores.
      A de-identified participant code and a consent status are also recorded per sheet, matching
      this project's own data-handling design.</p>
    <p><strong>What we do not collect:</strong> no advertising identifiers, no location data, no
      contact lists, and no data from any source other than what a teacher directly uploads or
      types into the system.</p>

    <h2>3. Cookies and similar technology</h2>
    <p>
      A single functional cookie keeps a teacher signed in between page loads. It is not used for
      advertising or tracking. Full detail is in the <RouterLink :to="{ name: 'cookies' }">Cookie Policy</RouterLink>.
    </p>

    <h2>4. Third-party services</h2>
    <p>
      This system loads one third-party script (SheetJS, for building the Excel export entirely in
      your browser) and uses Gmail's email service to send a teacher their own verification/reset
      codes. Neither service receives student data as part of that.
    </p>

    <h2>5. Why we process this data</h2>
    <p>
      Student data is processed solely to grade objective exams automatically and let the teacher
      review, correct, and export the results. It is not used for any other purpose, and it is not
      sold, shared with advertisers, or used to profile anyone.
    </p>

    <h2>6. How long data is kept</h2>
    <p>
      Uploaded sheets, recognized answers, and results are kept for as long as the teacher's
      account and grading sessions exist, so results remain reviewable. Deleting a grading session
      or answer key removes its associated records. A teacher can request account deletion at any
      time (see Contact below).
    </p>

    <h2>7. Security</h2>
    <p>
      Passwords are hashed, never stored or emailed in plain text. Verification/reset codes are
      hashed the same way and expire after a short window. Session cookies are marked HTTPS-only
      in any real deployment. No system can guarantee absolute security, but reasonable technical
      measures are in place appropriate to a project of this scope.
    </p>

    <h2>8. Your rights</h2>
    <p>
      Consistent with the Philippine Data Privacy Act of 2012 (Republic Act 10173), a data subject
      (teacher or, through their teacher/institution, a student) may request access to, correction
      of, or erasure of their personal data, and may object to further processing. Requests can be
      raised with the person operating this system for your institution, or escalated to the
      National Privacy Commission if unresolved.
    </p>

    <h2>9. Changes to this policy</h2>
    <p>
      This page may be updated as the system changes. Meaningful changes will be reflected in the
      "Last updated" line above.
    </p>

    <h2>10. Contact</h2>
    <p>
      Questions about this policy or a specific data request should go to the researchers/
      administrator operating this deployment, not to any third-party service mentioned above.
    </p>

    <RouterLink :to="{ name: 'login' }" class="legal-back">&larr; Back to login</RouterLink>
  </div>
</template>
