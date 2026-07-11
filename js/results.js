/* ============================================================
   results.js - Session results, filters, selection, and export
   ============================================================ */

const Results = (() => {
  let rows = [];
  let filteredRows = [];
  let selectedResultId = null;
  const filters = { query: '', section: 'All Sections' };

  function render() { /* rendered by refresh */ }

  function refresh() {
    const el = document.getElementById('page-results');
    if (!el) return;

    const sessions = DB.sessions();
    if (!sessions.some(session => session.id === App.state.currentSessionId)) {
      App.state.currentSessionId = sessions[0]?.id || null;
    }
    const session = sessions.find(item => item.id === App.state.currentSessionId) || null;
    rows = session ? DB.studentResults(session.id) : [];
    if (!rows.some(row => row.id === selectedResultId)) selectedResultId = null;

    const sections = [...new Set(rows.map(row => String(row.section || '').trim()).filter(Boolean))].sort();
    if (filters.section !== 'All Sections' && !sections.includes(filters.section)) filters.section = 'All Sections';

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Grading Results</div>
        <div class="page-subtitle">${session ? `Session #${session.id} - ${_esc(session.answer_key_name)} - ${_esc(session.status)}` : 'No grading session is available.'}</div>
      </div>

      <div class="action-bar results-toolbar">
        <input type="text" id="res-search" value="${_esc(filters.query)}" placeholder="Search student, section, status..." aria-label="Search results">
        <select id="res-session" aria-label="Select grading session">${_sessionOptions(sessions, session?.id)}</select>
        <select id="res-section" aria-label="Filter by section">
          <option>All Sections</option>
          ${sections.map(section => `<option ${section === filters.section ? 'selected' : ''}>${_esc(section)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn btn-secondary" id="res-refresh-btn">Refresh</button>
        <button class="btn btn-success" id="res-export-btn">Export Session</button>
      </div>

      <section class="card">
        <div class="results-summary">
          <span><strong>${rows.length}</strong> student record(s)</span>
          <span><strong>${rows.reduce((sum, row) => sum + (Number(row.flagged_count) || 0), 0)}</strong> flagged item(s)</span>
          ${session?.status === 'Completed' && rows.some(row => DB.resultItems(row.id).some(item => item.model_used === 'Model Pending Placeholder'))
            ? '<span class="badge badge-blue">Model Pending Placeholder</span>'
            : ''}
        </div>
        <div class="table-wrapper results-table-wrapper">
          <table id="res-table">
            <thead><tr><th>#</th><th>Student Name</th><th>Section</th><th>Score</th><th>% Score</th><th>Flagged</th><th>Status</th></tr></thead>
            <tbody id="res-tbody"></tbody>
          </table>
        </div>
        <div class="workflow-actions results-actions">
          <button class="btn btn-secondary" id="res-review-btn">Review Flagged</button>
          <button class="btn btn-primary" id="res-open-btn">Open Student Result</button>
        </div>
      </section>
    `;

    applyFilters();
    _attachEvents(el);
  }

  function _attachEvents(el) {
    el.querySelector('#res-search')?.addEventListener('input', event => {
      filters.query = event.target.value;
      applyFilters();
    });
    el.querySelector('#res-section')?.addEventListener('change', event => {
      filters.section = event.target.value;
      applyFilters();
    });
    el.querySelector('#res-session')?.addEventListener('change', event => {
      App.state.currentSessionId = parseInt(event.target.value) || null;
      App.state.selectedStudentResultId = null;
      selectedResultId = null;
      filters.section = 'All Sections';
      refresh();
    });
    el.querySelector('#res-refresh-btn')?.addEventListener('click', refresh);
    el.querySelector('#res-export-btn')?.addEventListener('click', exportSession);
    el.querySelector('#res-open-btn')?.addEventListener('click', openSelected);
    el.querySelector('#res-review-btn')?.addEventListener('click', reviewFlagged);
  }

  function applyFilters() {
    const query = filters.query.trim().toLowerCase();
    const session = DB.sessions().find(item => item.id === App.state.currentSessionId);
    filteredRows = rows.filter(row => {
      if (filters.section !== 'All Sections' && String(row.section || '') !== filters.section) return false;
      if (!query) return true;
      const haystack = [row.student_name, row.section, row.status, row.score, row.total, row.percentage, session?.answer_key_name]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
    _renderTable();
  }

  function applySearch(text) {
    filters.query = String(text || '');
    const query = filters.query.trim().toLowerCase();
    if (query) {
      const match = DB.sessions().find(session => {
        if (String(session.answer_key_name || '').toLowerCase().includes(query)) return true;
        return DB.studentResults(session.id).some(row => [row.student_name, row.section, row.status]
          .join(' ')
          .toLowerCase()
          .includes(query));
      });
      if (match) App.state.currentSessionId = match.id;
    }
    refresh();
  }

  function _renderTable() {
    const tbody = document.getElementById('res-tbody');
    if (!tbody) return;
    if (!filteredRows.length) {
      const message = rows.length ? 'No results match the current filters.' : 'This session has no student records.';
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${message}</td></tr>`;
      return;
    }

    tbody.innerHTML = filteredRows.map((row, index) => `
      <tr data-result-id="${row.id}" tabindex="0" class="${row.id === selectedResultId ? 'selected' : ''}">
        <td>${index + 1}</td>
        <td>${_esc(row.student_name || 'Unknown')}</td>
        <td>${_esc(row.section || '')}</td>
        <td>${_number(row.score)} / ${_number(row.total)}</td>
        <td>${_number(row.percentage)}%</td>
        <td>${_number(row.flagged_count)}</td>
        <td><span class="badge ${_statusClass(row.status)}">${_esc(row.status || 'Unknown')}</span></td>
      </tr>`).join('');

    tbody.querySelectorAll('tr[data-result-id]').forEach(tableRow => {
      const select = () => _selectResult(parseInt(tableRow.dataset.resultId));
      tableRow.addEventListener('click', select);
      tableRow.addEventListener('dblclick', () => {
        select();
        openSelected();
      });
      tableRow.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          select();
          openSelected();
        }
      });
    });
  }

  function _selectResult(resultId) {
    selectedResultId = resultId;
    App.state.selectedStudentResultId = resultId;
    document.querySelectorAll('#res-tbody tr[data-result-id]').forEach(row => {
      row.classList.toggle('selected', parseInt(row.dataset.resultId) === resultId);
    });
  }

  async function openSelected() {
    if (!selectedResultId) {
      await App.showMessage('Student Required', 'Select a student row first.');
      return;
    }
    App.state.selectedStudentResultId = selectedResultId;
    App.showPage('student_result');
  }

  async function reviewFlagged() {
    const selected = rows.find(row => row.id === selectedResultId);
    const sessionHasFlags = rows.some(row => Number(row.flagged_count) > 0);
    if (!sessionHasFlags) {
      await App.showMessage('Nothing to Review', 'This session has no flagged items.');
      return;
    }
    App.state.selectedStudentResultId = selected && Number(selected.flagged_count) > 0 ? selected.id : null;
    App.showPage('review');
  }

  function exportSession() {
    const sessionId = parseInt(document.getElementById('res-session')?.value) || App.state.currentSessionId;
    App.exportSessionToFile(sessionId);
  }

  function _sessionOptions(sessions, selectedId) {
    if (!sessions.length) return '<option value="">No sessions available</option>';
    return sessions.map(session => `<option value="${session.id}" ${session.id === selectedId ? 'selected' : ''}>#${session.id} - ${_esc(session.created_at)} - ${_esc(session.answer_key_name || 'No key')}</option>`).join('');
  }

  function _statusClass(status) {
    if (status === 'OK') return 'badge-success';
    if (status === 'Flagged') return 'badge-warning';
    if (status === 'Wrong' || status === 'Failed') return 'badge-danger';
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

  return { render, refresh, applySearch };
})();
