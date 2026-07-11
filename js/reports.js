/* ============================================================
   reports.js — Reports & Analytics + SheetJS export
   ============================================================ */

const Reports = (() => {
  function render() { /* rendered in refresh */ }

  function refresh() {
    const el = document.getElementById('page-reports');
    if (!el) return;

    const allSessions = DB.sessions();
    const currentSid = App.state.currentSessionId;
    const results = currentSid ? DB.studentResults(currentSid) : [];
    const avg = results.length ? Math.round(results.reduce((s, r) => s + (r.percentage || 0), 0) / results.length * 100) / 100 : 0;
    const flags = results.reduce((s, r) => s + (r.flagged_count || 0), 0);

    let sessionOpts = allSessions.map(s => {
      const sel = s.id === currentSid ? 'selected' : '';
      return `<option value="${s.id}" ${sel}>#${s.id} - ${s.created_at} - ${s.answer_key_name || 'No key'}</option>`;
    }).join('');
    if (!sessionOpts) sessionOpts = '<option value="">No sessions</option>';

    let sessionRows = '';
    for (const s of allSessions.slice(0, 50)) {
      const rs = DB.studentResults(s.id);
      const avg2 = rs.length ? Math.round(rs.reduce((sum, r) => sum + (r.percentage || 0), 0) / rs.length * 100) / 100 : 0;
      const flagged = rs.reduce((sum, r) => sum + (r.flagged_count || 0), 0);
      sessionRows += `<tr>
        <td>${s.id}</td>
        <td>${s.created_at}</td>
        <td>${s.answer_key_name || 'No key'}</td>
        <td>${rs.length}</td>
        <td>${avg2}%</td>
        <td>${flagged}</td>
        <td><span class="badge ${s.status === 'Completed' ? 'badge-success' : s.status === 'Processing' ? 'badge-warning' : 'badge-gray'}">${s.status}</span></td>
      </tr>`;
    }

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Reports & Analytics</div>
        <div class="page-subtitle">Generate Excel-ready summaries and compare grading sessions.</div>
      </div>
      <div class="flex gap-16 mb-14" style="flex-wrap:wrap;">
        <div class="stat-card">
          <div class="stat-label">Total Sheets Graded</div>
          <div class="stat-value">${results.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Average Score</div>
          <div class="stat-value">${avg}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Flagged Items</div>
          <div class="stat-value">${flags}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Sessions</div>
          <div class="stat-value">${allSessions.length}</div>
        </div>
      </div>
      <div class="flex gap-8 items-center mb-14" style="flex-wrap:wrap;">
        <label class="form-label" style="margin-bottom:0;">Session to export:</label>
        <select id="rpt-session" title="Select session to export." style="max-width:400px;">${sessionOpts}</select>
        <div class="spacer"></div>
        <button class="btn btn-success" id="rpt-export-btn" title="Generate an Excel report.">Export Selected Session to Excel</button>
      </div>
      <div class="card">
        <div class="card-title">Grading Sessions</div>
        <div class="table-wrapper" style="max-height:400px;overflow-y:auto;">
          <table>
            <thead><tr><th>Session ID</th><th>Date</th><th>Answer Key</th><th>Sheets</th><th>Avg Score</th><th>Flagged</th><th>Status</th></tr></thead>
            <tbody>${sessionRows || '<tr><td colspan="7" class="muted-text" style="text-align:center;padding:24px;">No sessions yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('rpt-export-btn')?.addEventListener('click', exportSelected);
  }

  function exportSelected() {
    const sid = parseInt(document.getElementById('rpt-session')?.value) || App.state.currentSessionId;
    if (!sid) { App.showMessage('No Session', 'Choose a session to export.'); return; }

    const results = DB.studentResults(sid);
    if (!results.length) { App.showMessage('No Data', 'No results in this session.'); return; }

    const wsData = [['#', 'Student Name', 'Section', 'Score', 'Total', '% Score', 'Flagged', 'Status']];
    results.forEach((r, i) => {
      wsData.push([i + 1, r.student_name, r.section, r.score, r.total, r.percentage, r.flagged_count, r.status]);
    });

    if (typeof XLSX !== 'undefined') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Results');

      const detailData = [['Student', 'Item #', 'Type', 'Student Answer', 'Correct Answer', 'Match %', 'Earned', 'Status', 'Model']];
      for (const r of results) {
        const items = DB.resultItems(r.id);
        for (const it of items) {
          detailData.push([r.student_name, it.item_no, it.type, it.student_answer, it.correct_answer, it.match_score, it.earned, it.status, it.model_used]);
        }
      }
      const ws2 = XLSX.utils.aoa_to_sheet(detailData);
      XLSX.utils.book_append_sheet(wb, ws2, 'Item Details');
      XLSX.writeFile(wb, `grading_session_${sid}.xlsx`);
      App.showMessage('Exported', `Excel file downloaded: grading_session_${sid}.xlsx`);
    } else {
      const csv = wsData.map(row => row.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `grading_session_${sid}.csv`;
      a.click();
      App.showMessage('Exported', `CSV file downloaded (SheetJS not loaded).`);
    }
  }

  return { render, refresh };
})();
