<script setup>
/* ============================================================
   HowToUseView.vue — step-by-step guide
   Ported from how_to_use.js. Static content, so this page is the
   cleanest illustration of the change: the original built a ~70
   line HTML string then attached five click listeners by id. Here
   the markup is the template and navigation is <RouterLink>.
   ============================================================ */

const WORKFLOW = [
  { step: 1, task: 'Create or log in to a teacher account', description: 'Your account is saved in this browser.' },
  { step: 2, task: 'Create an answer key', description: 'Enter item number, question type, correct answer, points, and group number for enumeration.' },
  { step: 3, task: 'Upload answer sheets', description: 'Select the answer key and upload scanned or captured examination sheet images.' },
  { step: 4, task: 'Process the sheets', description: 'The system detects answer regions, recognizes handwriting, and grades the responses. (Placeholder in web app)' },
  { step: 5, task: 'View results', description: 'Check student scores, item-level answers, and final result status.' },
  { step: 6, task: 'Review flagged answers', description: 'Manually confirm answers that are close matches or uncertain.' },
  { step: 7, task: 'Export Excel report', description: 'Generate a teacher-friendly report with student name, section, per-item scores, total score, and flagged items.' },
]

const QUESTION_TYPES = [
  { type: 'Multiple Choice', entry: 'Use A, B, C, or D.', behavior: 'Checked by exact matching.' },
  { type: 'True or False', entry: 'Use True/False or T/F.', behavior: 'Checked by exact matching.' },
  { type: 'Identification', entry: 'Use the exact expected text answer.', behavior: '100% is correct; 70–99% is flagged for review.' },
  { type: 'Enumeration', entry: 'Use the same group number for answers that belong to one enumeration question.', behavior: 'Order does not matter within the same group.' },
]

const SHORTCUTS = [
  { name: 'answer_key', label: 'Answer Keys', title: 'Create or edit an answer key.' },
  { name: 'upload', label: 'Upload Sheets', title: 'Upload exam sheet images.' },
  { name: 'results', label: 'Results', title: 'View grading summaries.' },
  { name: 'review', label: 'Review Flagged', title: 'Manually check uncertain answers.' },
  { name: 'reports', label: 'Reports', title: 'Export Excel reports.' },
]
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">How to Use</div>
      <div class="page-subtitle">Step-by-step guide for using the Automated Grading System.</div>
    </div>

    <div style="max-height:calc(100vh - 220px);overflow-y:auto;padding-right:8px;">
      <div class="card mb-14">
        <div class="card-title">System Overview</div>
        <div class="muted-text" style="line-height:1.7;">
          This application helps teachers grade structured handwritten objective examination sheets.
          The main workflow is: create an answer key, upload answer sheets, process them,
          review flagged answers, and export the final scores to Excel.
        </div>
      </div>

      <div class="card mb-14">
        <div class="card-title">Basic Workflow</div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Step</th><th>Task</th><th>Description</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in WORKFLOW" :key="row.step">
                <td>{{ row.step }}</td>
                <td>{{ row.task }}</td>
                <td>{{ row.description }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card mb-14">
        <div class="card-title">Answer Key Guide</div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Question Type</th><th>What to Enter</th><th>Grading Behavior</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in QUESTION_TYPES" :key="row.type">
                <td>{{ row.type }}</td>
                <td>{{ row.entry }}</td>
                <td>{{ row.behavior }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card mb-14">
        <div class="card-title">Important Notes</div>
        <div class="muted-text" style="line-height:1.8;">
          • Flagged answers require teacher review because the recognized answer is close but not exact.<br>
          • For Identification and Enumeration, only a 100% match is automatically marked OK; 70–99% is flagged.<br>
          • If OCR accuracy is low, check the crop/result first before assuming the student answer is wrong.<br>
          • Always review the Excel report before using it as the final class record.
        </div>
      </div>

      <div class="card">
        <div class="card-title">Quick Navigation</div>
        <div class="muted-text mb-8">Use these shortcuts after reading the guide.</div>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <RouterLink
            v-for="shortcut in SHORTCUTS"
            :key="shortcut.name"
            v-slot="{ navigate }"
            :to="{ name: shortcut.name }"
            custom
          >
            <button class="btn btn-secondary" :title="shortcut.title" @click="navigate">
              {{ shortcut.label }}
            </button>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
