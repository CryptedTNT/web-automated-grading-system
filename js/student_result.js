/* ============================================================
   student_result.js - Item-level result details
   ============================================================ */

const StudentResult = (() => {
  function render() { /* rendered by refresh */ }

  function refresh() {
    const el = document.getElementById('page-student_result');
    if (!el) return;

    const resultId = App.state.selectedStudentResultId;
    const result = resultId ? DB.getStudentResultById(resultId) : null;
    if (!result) {
      el.innerHTML = `
        <div class="title-block">
          <div class="page-title">Student Result</div>
          <div class="page-subtitle">Select a student from the Results page.</div>
        </div>
        <section class="card empty-state">
          <div class="muted-text">No student result is selected.</div>
          <button class="btn btn-primary" id="sr-results-btn">Open Results</button>
        </section>`;
      el.querySelector('#sr-results-btn')?.addEventListener('click', () => App.showPage('results'));
      return;
    }

    const items = DB.resultItems(result.id);
    const hasPendingModel = items.some(item => item.model_used === 'Model Pending Placeholder');
    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Full Result - ${_esc(result.student_name || 'Unknown')}</div>
        <div class="page-subtitle">Section: ${_esc(result.section || '-')} - Score: ${_number(result.score)} / ${_number(result.total)} - Flagged: ${_number(result.flagged_count)}</div>
      </div>
      ${hasPendingModel ? '<div class="processing-banner"><span class="badge badge-blue">Model Pending Placeholder</span><span>Answers shown below are scaffold data awaiting the OCR model.</span></div>' : ''}
      <section class="card">
        <div class="table-wrapper student-result-table">
          <table>
            <thead><tr><th>#</th><th>Type</th><th>Group</th><th>Student Answer</th><th>Correct Answer</th><th>Match %</th><th>Score</th><th>Auto Result</th><th>Final Result</th><th>Manual</th><th>Remarks</th><th>Model</th></tr></thead>
            <tbody>${_itemRows(items)}</tbody>
          </table>
        </div>
        <div class="workflow-actions">
          <button class="btn btn-secondary" id="sr-back-btn">Back to Results</button>
          <button class="btn btn-primary" id="sr-review-btn" ${Number(result.flagged_count) ? '' : 'disabled'}>${Number(result.flagged_count) ? 'Review Flagged' : 'No Flags Remaining'}</button>
        </div>
      </section>`;

    el.querySelector('#sr-back-btn')?.addEventListener('click', () => App.showPage('results'));
    el.querySelector('#sr-review-btn')?.addEventListener('click', () => App.showPage('review'));
  }

  function _itemRows(items) {
    if (!items.length) return '<tr><td colspan="12" class="table-empty">No item-level records are available.</td></tr>';
    return items.map(item => {
      const autoStatus = item.auto_status || item.status;
      return `<tr>
        <td>${item.item_no}</td>
        <td>${_esc(item.type || '')}</td>
        <td>${_esc(item.enum_group ?? '')}</td>
        <td>${_esc(item.student_answer || '')}</td>
        <td>${_esc(item.correct_answer || '')}</td>
        <td>${_number(item.match_score)}%</td>
        <td>${_number(item.earned)} / ${_number(item.points)}</td>
        <td><span class="badge ${_statusClass(autoStatus)}">${_esc(autoStatus)}</span></td>
        <td><span class="badge ${_statusClass(item.status)}">${_esc(item.status)}</span></td>
        <td>${item.manual_override ? 'Yes' : 'No'}</td>
        <td class="remarks-cell">${_esc(item.remarks || '')}</td>
        <td>${_esc(item.model_used || '')}</td>
      </tr>`;
    }).join('');
  }

  function _statusClass(status) {
    if (status === 'OK') return 'badge-success';
    if (status === 'Flagged') return 'badge-warning';
    if (status === 'Wrong') return 'badge-danger';
    return 'badge-gray';
  }

  function _number(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function _esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { render, refresh };
})();
