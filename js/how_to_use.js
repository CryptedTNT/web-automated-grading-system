/* ============================================================
   how_to_use.js — How to Use guide page
   ============================================================ */

const HowToUse = (() => {
  function render() { /* rendered in refresh */ }

  function refresh() {
    const el = document.getElementById('page-how_to_use');
    if (!el) return;

    el.innerHTML = `
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
              <thead><tr><th>Step</th><th>Task</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td>1</td><td>Create or log in to a teacher account</td><td>Your account is saved in this browser.</td></tr>
                <tr><td>2</td><td>Create an answer key</td><td>Enter item number, question type, correct answer, points, and group number for enumeration.</td></tr>
                <tr><td>3</td><td>Upload answer sheets</td><td>Select the answer key and upload scanned or captured examination sheet images.</td></tr>
                <tr><td>4</td><td>Process the sheets</td><td>The system detects answer regions, recognizes handwriting, and grades the responses. <em>(Placeholder in web app)</em></td></tr>
                <tr><td>5</td><td>View results</td><td>Check student scores, item-level answers, and final result status.</td></tr>
                <tr><td>6</td><td>Review flagged answers</td><td>Manually confirm answers that are close matches or uncertain.</td></tr>
                <tr><td>7</td><td>Export Excel report</td><td>Generate a teacher-friendly report with student name, section, per-item scores, total score, and flagged items.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card mb-14">
          <div class="card-title">Answer Key Guide</div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Question Type</th><th>What to Enter</th><th>Grading Behavior</th></tr></thead>
              <tbody>
                <tr><td>Multiple Choice</td><td>Use A, B, C, or D.</td><td>Checked by exact matching.</td></tr>
                <tr><td>True or False</td><td>Use True/False or T/F.</td><td>Checked by exact matching.</td></tr>
                <tr><td>Identification</td><td>Use the exact expected text answer.</td><td>100% is correct; 70–99% is flagged for review.</td></tr>
                <tr><td>Enumeration</td><td>Use the same group number for answers that belong to one enumeration question.</td><td>Order does not matter within the same group.</td></tr>
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
            <button class="btn btn-secondary" id="htu-ak" title="Create or edit an answer key.">Answer Keys</button>
            <button class="btn btn-secondary" id="htu-upload" title="Upload exam sheet images.">Upload Sheets</button>
            <button class="btn btn-secondary" id="htu-results" title="View grading summaries.">Results</button>
            <button class="btn btn-secondary" id="htu-review" title="Manually check uncertain answers.">Review Flagged</button>
            <button class="btn btn-secondary" id="htu-reports" title="Export Excel reports.">Reports</button>
          </div>
        </div>

      </div>
    `;

    document.getElementById('htu-ak')?.addEventListener('click', () => App.showPage('answer_key'));
    document.getElementById('htu-upload')?.addEventListener('click', () => App.showPage('upload'));
    document.getElementById('htu-results')?.addEventListener('click', () => App.showPage('results'));
    document.getElementById('htu-review')?.addEventListener('click', () => App.showPage('review'));
    document.getElementById('htu-reports')?.addEventListener('click', () => App.showPage('reports'));
  }

  return { render, refresh };
})();
