/* ============================================================
   reports.js - Session analytics and shared export workflow
   ============================================================ */

const Reports = (() => {
  function render() { /* rendered by refresh */ }

  function refresh() {
    const el = document.getElementById('page-reports');
    if (!el) return;

    const sessions = DB.sessions();
    if (!sessions.some(session => session.id === App.state.currentSessionId)) {
      App.state.currentSessionId = sessions[0]?.id || null;
    }
    const selectedSession = sessions.find(session => session.id === App.state.currentSessionId) || null;
    const results = selectedSession ? DB.studentResults(selectedSession.id) : [];
    const average = results.length
      ? Math.round(results.reduce((sum, row) => sum + (_number(row.percentage)), 0) / results.length * 100) / 100
      : 0;
    const flagged = results.reduce((sum, row) => sum + _number(row.flagged_count), 0);
    const prefs = DB.getExportPreferences();

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Reports &amp; Analytics</div>
        <div class="page-subtitle">Review session totals and export using saved filename and column preferences.</div>
      </div>

      <div class="stats-grid reports-stats">
        ${_stat('Sheets in Session', results.length, selectedSession ? `Session #${selectedSession.id}` : 'No session selected')}
        ${_stat('Average Score', `${average}%`, 'Selected session')}
        ${_stat('Flagged Items', flagged, 'Selected session')}
        ${_stat('All Sessions', sessions.length, 'Stored in this browser')}
      </div>

      <div class="action-bar reports-toolbar">
        <label class="form-label" for="rpt-session">Selected Session</label>
        <select id="rpt-session">${_sessionOptions(sessions, selectedSession?.id)}</select>
        <div class="spacer"></div>
        <button class="btn btn-secondary" id="rpt-results-btn">Open Results</button>
        <button class="btn btn-success" id="rpt-export-btn">Export Selected Session</button>
      </div>

      <div class="export-preference-summary">
        <span class="badge badge-gray">${_esc(prefs.folder_label)}</span>
        <span>${_esc(prefs.filename_format)}</span>
      </div>

      <section class="card">
        <div class="card-title">Grading Sessions</div>
        <div class="table-wrapper reports-table-wrapper">
          <table>
            <thead><tr><th>Session</th><th>Date</th><th>Answer Key</th><th>Sheets</th><th>Average</th><th>Flagged</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>${_sessionRows(sessions, selectedSession?.id)}</tbody>
          </table>
        </div>
      </section>
    `;

    el.querySelector('#rpt-session')?.addEventListener('change', event => {
      App.state.currentSessionId = parseInt(event.target.value) || null;
      refresh();
    });
    el.querySelector('#rpt-export-btn')?.addEventListener('click', exportSelected);
    el.querySelector('#rpt-results-btn')?.addEventListener('click', openResults);
    el.querySelectorAll('[data-report-session]').forEach(button => {
      button.addEventListener('click', () => {
        App.state.currentSessionId = parseInt(button.dataset.reportSession) || null;
        App.state.selectedStudentResultId = null;
        App.showPage('results');
      });
    });
  }

  function exportSelected() {
    const sessionId = parseInt(document.getElementById('rpt-session')?.value) || App.state.currentSessionId;
    App.exportSessionToFile(sessionId);
  }

  function openResults() {
    const sessionId = parseInt(document.getElementById('rpt-session')?.value) || App.state.currentSessionId;
    if (sessionId) App.state.currentSessionId = sessionId;
    App.showPage('results');
  }

  function _sessionRows(sessions, selectedId) {
    if (!sessions.length) return '<tr><td colspan="8" class="table-empty">No grading sessions yet.</td></tr>';
    return sessions.slice(0, 100).map(session => {
      const results = DB.studentResults(session.id);
      const average = results.length
        ? Math.round(results.reduce((sum, row) => sum + _number(row.percentage), 0) / results.length * 100) / 100
        : 0;
      const flagged = results.reduce((sum, row) => sum + _number(row.flagged_count), 0);
      return `<tr class="${session.id === selectedId ? 'selected' : ''}">
        <td>#${session.id}</td>
        <td>${_esc(session.created_at)}</td>
        <td>${_esc(session.answer_key_name || 'No key')}</td>
        <td>${results.length}</td>
        <td>${average}%</td>
        <td>${flagged}</td>
        <td><span class="badge ${_sessionStatusClass(session.status)}">${_esc(session.status)}</span></td>
        <td><button class="btn btn-secondary btn-small" data-report-session="${session.id}">View</button></td>
      </tr>`;
    }).join('');
  }

  function _sessionOptions(sessions, selectedId) {
    if (!sessions.length) return '<option value="">No sessions available</option>';
    return sessions.map(session => `<option value="${session.id}" ${session.id === selectedId ? 'selected' : ''}>#${session.id} - ${_esc(session.created_at)} - ${_esc(session.answer_key_name || 'No key')}</option>`).join('');
  }

  function _stat(label, value, detail) {
    return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-delta">${detail}</div></div>`;
  }

  function _sessionStatusClass(status) {
    if (status === 'Completed') return 'badge-success';
    if (status === 'Processing') return 'badge-warning';
    if (status === 'Failed') return 'badge-danger';
    return 'badge-gray';
  }

  function _number(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function _esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { render, refresh };
})();
