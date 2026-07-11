/* ============================================================
   results.js — Results page with session selector, search,
                section filter, results table, export
   ============================================================ */

const Results = (() => {
  let rows = [];
  let filteredRows = [];
  let refreshingFilters = false;

  function render() { /* rendered in refresh */ }

  function refresh(reloadSessions) {
    const el = document.getElementById('page-results');
    if (!el) return;
    reloadSessions = reloadSessions !== false;

    const allSessions = DB.sessions();
    const currentSid = App.state.currentSessionId || DB.latestSessionId();
    App.state.currentSessionId = currentSid;

    let sessionOpts = allSessions.map(s => {
      const sel = s.id === currentSid ? 'selected' : '';
      return `<option value="${s.id}" ${sel}>#${s.id} - ${s.created_at} - ${s.answer_key_name || 'No key'}</option>`;
    }).join('');
    if (!sessionOpts) sessionOpts = '<option value="">No sessions</option>';

    rows = currentSid ? DB.studentResults(currentSid) : [];
    const sections = [...new Set(rows.map(r => (r.section || '').trim()).filter(Boolean))].sort();
    let sectionOpts = '<option>All Sections</option>' + sections.map(s => `<option>${s}</option>`).join('');

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Grading Results</div>
        <div class="page-subtitle">${currentSid ? `Session #${currentSid}` : 'No session loaded.'}</div>
      </div>
      <div class="flex gap-8 items-center mb-14" style="flex-wrap:wrap;">
        <input type="text" id="res-search" placeholder="Search student, section, or status..." title="Filter results." style="max-width:280px;">
        <select id="res-session" title="Choose which grading session to view." style="max-width:360px;">${sessionOpts}</select>
        <select id="res-section" title="Filter by section." style="max-width:180px;">${sectionOpts}</select>
        <div class="spacer"></div>
        <button class="btn btn-secondary" id="res-refresh-btn" title="Reload results.">Refresh</button>
        <button class="btn btn-success" id="res-export-btn" title="Export session to Excel.">Export Selected Session</button>
      </div>
      <div class="card">
        <div class="table-wrapper" style="max-height:450px;overflow-y:auto;">
          <table id="res-table">
            <thead><tr><th>#</th><th>Student Name</th><th>Section</th><th>Score</th><th>% Score</th><th>Flagged</th><th>Status</th></tr></thead>
            <tbody id="res-tbody"></tbody>
          </table>
        </div>
        <div class="flex gap-8 mt-8 justify-end">
          <button class="btn btn-secondary" id="res-review-btn" title="Open flagged-answer review.">Review Flagged</button>
          <button class="btn btn-primary" id="res-open-btn" title="Open selected student result.">Open Student Result</button>
        </div>
      </div>
    `;

    applyFilters();

    document.getElementById('res-search')?.addEventListener('input', applyFilters);
    document.getElementById('res-section')?.addEventListener('change', applyFilters);
    document.getElementById('res-session')?.addEventListener('change', (e) => {
      App.state.currentSessionId = parseInt(e.target.value) || null;
      rows = App.state.currentSessionId ? DB.studentResults(App.state.currentSessionId) : [];
      _refreshSectionFilter();
      applyFilters();
    });
    document.getElementById('res-refresh-btn')?.addEventListener('click', () => refresh());
    document.getElementById('res-export-btn')?.addEventListener('click', exportSession);
    document.getElementById('res-open-btn')?.addEventListener('click', openSelected);
    document.getElementById('res-review-btn')?.addEventListener('click', () => App.showPage('review'));
  }

  function _refreshSectionFilter() {
    const sel = document.getElementById('res-section');
    if (!sel) return;
    const current = sel.value;
    const sections = [...new Set(rows.map(r => (r.section || '').trim()).filter(Boolean))].sort();
    sel.innerHTML = '<option>All Sections</option>' + sections.map(s => `<option>${s}</option>`).join('');
    if (sections.includes(current)) sel.value = current;
  }

  function applyFilters() {
    const query = (document.getElementById('res-search')?.value || '').trim().toLowerCase();
    const section = document.getElementById('res-section')?.value || 'All Sections';

    filteredRows = rows.filter(r => {
      if (section !== 'All Sections' && (r.section || '') !== section) return false;
      if (query) {
        const haystack = [r.student_name, r.section, r.status, r.score, r.percentage].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    _renderTable();
  }

  function applySearch(text) {
    const search = document.getElementById('res-search');
    if (search) search.value = text;
    applyFilters();
  }

  function _renderTable() {
    const tbody = document.getElementById('res-tbody');
    if (!tbody) return;
    if (!filteredRows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted-text" style="text-align:center;padding:24px;">No results found.</td></tr>';
      return;
    }
    tbody.innerHTML = filteredRows.map((r, i) => {
      const statusClass = r.status === 'OK' ? 'badge-success' : r.status === 'Flagged' ? 'badge-warning' : 'badge-gray';
      return `<tr data-idx="${i}" style="cursor:pointer;">
        <td>${i + 1}</td>
        <td>${r.student_name || ''}</td>
        <td>${r.section || ''}</td>
        <td>${r.score} / ${r.total}</td>
        <td>${r.percentage}%</td>
        <td>${r.flagged_count}</td>
        <td><span class="badge ${statusClass}">${r.status}</span></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
      tr.addEventListener('dblclick', () => {
        const idx = parseInt(tr.dataset.idx);
        openStudent(idx);
      });
      tr.addEventListener('click', () => {
        tbody.querySelectorAll('tr').forEach(t => t.classList.remove('selected'));
        tr.classList.add('selected');
      });
    });
  }

  function openStudent(idx) {
    if (idx >= 0 && idx < filteredRows.length) {
      App.state.selectedStudentResultId = filteredRows[idx].id;
      App.showPage('student_result');
    }
  }

  function openSelected() {
    const selected = document.querySelector('#res-tbody tr.selected');
    if (selected) openStudent(parseInt(selected.dataset.idx));
    else App.showMessage('No Selection', 'Select a student row first.');
  }

  function exportSession() {
    const sid = parseInt(document.getElementById('res-session')?.value) || App.state.currentSessionId;
    if (!sid) { App.showMessage('No Session', 'No grading session to export.'); return; }

    const results = DB.studentResults(sid);
    if (!results.length) { App.showMessage('No Data', 'No results in this session to export.'); return; }

    // Build data for SheetJS
    const wsData = [['#', 'Student Name', 'Section', 'Score', 'Total', '% Score', 'Flagged', 'Status']];
    results.forEach((r, i) => {
      wsData.push([i + 1, r.student_name, r.section, r.score, r.total, r.percentage, r.flagged_count, r.status]);
    });

    if (typeof XLSX !== 'undefined') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Results');

      // Add item-level detail sheet
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
      // Fallback CSV
      const csv = wsData.map(row => row.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `grading_session_${sid}.csv`;
      a.click();
      App.showMessage('Exported', `CSV file downloaded: grading_session_${sid}.csv`);
    }
  }

  return { render, refresh, applySearch };
})();
