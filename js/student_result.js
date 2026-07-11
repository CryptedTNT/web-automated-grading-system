/* ============================================================
   student_result.js — Student detail table (per-item results)
   ============================================================ */

const StudentResult = (() => {
  function render() { /* rendered in refresh */ }

  function refresh() {
    const el = document.getElementById('page-student_result');
    if (!el) return;

    const rid = App.state.selectedStudentResultId;
    if (!rid) {
      el.innerHTML = `
        <div class="title-block">
          <div class="page-title">Full Result</div>
          <div class="page-subtitle">Select a student from Results.</div>
        </div>
        <div class="card">
          <div class="muted-text" style="padding:24px;text-align:center;">No student selected. Go to Results and double-click a student row.</div>
        </div>`;
      return;
    }

    const r = DB.getStudentResultById(rid);
    if (!r) {
      el.innerHTML = `
        <div class="title-block">
          <div class="page-title">Full Result</div>
          <div class="page-subtitle">Student result not found.</div>
        </div>`;
      return;
    }

    const items = DB.resultItems(rid);

    let tableRows = '';
    for (const it of items) {
      const autoStatus = it.auto_status || it.status;
      const finalStatus = it.status;
      const manual = it.manual_override ? 'Yes' : 'No';
      const remarks = it.remarks || '';
      const statusClass = finalStatus === 'OK' ? 'badge-success' : finalStatus === 'Flagged' ? 'badge-warning' : finalStatus === 'Wrong' ? 'badge-danger' : 'badge-gray';
      const autoClass = autoStatus === 'OK' ? 'badge-success' : autoStatus === 'Flagged' ? 'badge-warning' : autoStatus === 'Wrong' ? 'badge-danger' : 'badge-gray';

      tableRows += `<tr>
        <td>${it.item_no}</td>
        <td>${it.type || ''}</td>
        <td>${it.enum_group ?? ''}</td>
        <td>${it.student_answer || ''}</td>
        <td>${it.correct_answer || ''}</td>
        <td>${it.match_score}%</td>
        <td>${it.earned}</td>
        <td><span class="badge ${autoClass}">${autoStatus}</span></td>
        <td><span class="badge ${statusClass}">${finalStatus}</span></td>
        <td>${manual}</td>
        <td style="max-width:200px;word-break:break-word;">${remarks}</td>
        <td>${it.model_used || ''}</td>
      </tr>`;
    }

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Full Result — ${r.student_name || 'Unknown'}</div>
        <div class="page-subtitle">Section: ${r.section || '—'} • Score: ${r.score} / ${r.total} • Flagged Items: ${r.flagged_count}</div>
      </div>
      <div class="card">
        <div class="table-wrapper" style="max-height:500px;overflow-y:auto;">
          <table>
            <thead><tr>
              <th>#</th><th>Type</th><th>Group</th><th>Student Answer</th><th>Correct Answer</th>
              <th>Match %</th><th>Score</th><th>Auto Result</th><th>Final Result</th>
              <th>Manual</th><th>Remarks</th><th>Model</th>
            </tr></thead>
            <tbody>${tableRows || '<tr><td colspan="12" class="muted-text" style="text-align:center;padding:24px;">No items found.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="flex gap-8 mt-8">
          <button class="btn btn-secondary" id="sr-back-btn">← Back to Results</button>
          <div class="spacer"></div>
          <button class="btn btn-primary" id="sr-review-btn">Review Flagged</button>
        </div>
      </div>
    `;

    document.getElementById('sr-back-btn')?.addEventListener('click', () => App.showPage('results'));
    document.getElementById('sr-review-btn')?.addEventListener('click', () => App.showPage('review'));
  }

  return { render, refresh };
})();
