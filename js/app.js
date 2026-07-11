/* ============================================================
   app.js — Main controller, routing, init
   ============================================================ */

const App = (() => {
  /* ---------- Shared Application State ---------- */
  const state = {
    currentUser: null,
    selectedAnswerKeyId: null,
    uploadPaths: [],       // Browser File wrappers prepared by Upload
    currentSessionId: null,
    selectedStudentResultId: null,
    selectedFlaggedItemId: null,
    lastError: '',
  };

  /* ---------- Initialization ---------- */
  function init() {
    // Render auth pages
    Auth.renderSetup();
    Auth.renderLogin();
    Auth.renderForgot();

    // Setup sidebar navigation
    document.querySelectorAll('.sidebar-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => showPage(btn.dataset.page));
    });

    document.getElementById('mobile-menu-btn')?.addEventListener('click', toggleMobileSidebar);
    document.getElementById('pages-container')?.addEventListener('click', closeMobileSidebar);
    window.addEventListener('resize', () => {
      if (window.innerWidth > 720) closeMobileSidebar();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMobileSidebar();
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', logout);

    // Global search
    document.getElementById('top-search')?.addEventListener('input', (e) => {
      _onGlobalSearch(e.target.value);
    });

    // Load saved theme
    Settings.loadSavedTheme();

    // Determine start page
    _showStartPage();
  }

  /* ---------- Start Page Logic ---------- */
  function _showStartPage() {
    if (DB.hasUser()) {
      const settings = DB.getSettings();
      if (settings.remember_me === 'true' && settings.remembered_user_id) {
        try {
          const user = DB.getUserPublicById(parseInt(settings.remembered_user_id));
          if (user) {
            state.currentUser = user;
            clearRuntimeSelection();
            updateUserLabels();
            enterApp();
            return;
          }
        } catch (e) { /* fall through */ }
      }
      showView('auth-login');
      Auth.setLoginStatus('Sign in with the local teacher account stored in browser storage.');
    } else {
      showView('auth-setup');
      Auth.setSetupStatus('No local account found. Create the first teacher account to start.');
    }
  }

  /* ---------- View Management ---------- */
  function showView(viewId) {
    document.querySelectorAll('.auth-view').forEach(el => el.classList.remove('active'));
    document.getElementById('shell')?.classList.remove('active');
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');
  }

  function enterApp() {
    showView('shell');
    showPage('dashboard');
  }

  /* ---------- Page Routing ---------- */
  const PAGE_MODULES = {
    dashboard: () => Dashboard,
    answer_key: () => AnswerKey,
    upload: () => Upload,
    processing: () => Processing,
    results: () => Results,
    student_result: () => StudentResult,
    review: () => Review,
    reports: () => Reports,
    how_to_use: () => HowToUse,
    settings: () => Settings,
  };

  function showPage(key) {
    if (!PAGE_MODULES[key]) return;

    closeMobileSidebar();

    // Switch active page
    document.querySelectorAll('#pages-container .page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + key);
    if (page) page.classList.add('active');

    // Update sidebar active state
    document.querySelectorAll('.sidebar-btn[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === key);
    });

    // Refresh page content
    const mod = PAGE_MODULES[key]();
    if (mod && typeof mod.refresh === 'function') {
      try { mod.refresh(); } catch (e) { console.error(`Error refreshing ${key}:`, e); }
    }
  }

  /* ---------- Auth Actions ---------- */
  function logout() {
    closeMobileSidebar();
    DB.setSetting('remember_me', 'false');
    DB.setSetting('remembered_user_id', '');
    state.currentUser = null;
    updateUserLabels();
    if (DB.hasUser()) {
      Auth.renderLogin();
      Auth.setLoginStatus('Logged out.');
      showView('auth-login');
    } else {
      showView('auth-setup');
    }
  }

  /* ---------- User Labels ---------- */
  function updateUserLabels() {
    const name = state.currentUser ? state.currentUser.full_name : '';
    const text = name ? `Teacher: ${name}` : 'Teacher: Not signed in';
    const sidebarUser = document.getElementById('sidebar-user');
    const topTeacher = document.getElementById('top-teacher');
    if (sidebarUser) sidebarUser.textContent = text;
    if (topTeacher) topTeacher.textContent = text;
  }

  /* ---------- Runtime State ---------- */
  function clearRuntimeSelection() {
    state.uploadPaths = [];
    state.currentSessionId = DB.latestSessionId();
    state.selectedStudentResultId = null;
    state.selectedFlaggedItemId = null;
    state.lastError = '';
    // Auto-select first answer key
    const keys = DB.answerKeys();
    state.selectedAnswerKeyId = keys.length ? keys[0].id : null;
  }

  /* ---------- Global Search ---------- */
  function _onGlobalSearch(text) {
    if (!text.trim()) return;
    showPage('results');
    if (Results && typeof Results.applySearch === 'function') {
      Results.applySearch(text);
    }
  }

  function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const button = document.getElementById('mobile-menu-btn');
    if (!sidebar || !button) return;
    const isOpen = sidebar.classList.toggle('mobile-open');
    button.setAttribute('aria-expanded', String(isOpen));
  }

  function closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('mobile-menu-btn')?.setAttribute('aria-expanded', 'false');
  }

  /* ---------- Message Box (replaces QMessageBox) ---------- */
  function showMessage(title, message, type) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'toast-overlay';
      overlay.innerHTML = `
        <div class="toast-box">
          <div class="toast-title">${_escHtml(title)}</div>
          <div class="toast-message">${_escHtml(message)}</div>
          <div class="toast-actions">
            <button class="btn btn-primary" data-action="ok">OK</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const close = () => { overlay.remove(); resolve('OK'); };
      overlay.querySelector('[data-action="ok"]').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      // Focus OK button
      overlay.querySelector('[data-action="ok"]').focus();
    });
  }

  function showConfirm(title, message) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'toast-overlay';
      overlay.innerHTML = `
        <div class="toast-box">
          <div class="toast-title">${_escHtml(title)}</div>
          <div class="toast-message">${_escHtml(message)}</div>
          <div class="toast-actions">
            <button class="btn btn-secondary" data-action="no">No</button>
            <button class="btn btn-primary" data-action="yes">Yes</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      overlay.querySelector('[data-action="yes"]').addEventListener('click', () => { overlay.remove(); resolve(true); });
      overlay.querySelector('[data-action="no"]').addEventListener('click', () => { overlay.remove(); resolve(false); });
      overlay.querySelector('[data-action="yes"]').focus();
    });
  }

  function exportSessionToFile(sessionId) {
    const sid = parseInt(sessionId) || state.currentSessionId;
    if (!sid) {
      showMessage('No Session', 'No grading session to export.');
      return;
    }

    const results = DB.studentResults(sid);
    if (!results.length) {
      showMessage('No Data', 'No results in this session to export.');
      return;
    }

    const prefs = DB.getExportPreferences();
    const requestedFilename = _formatExportFilename(sid, prefs);
    const summaryData = _buildSummaryRows(results, prefs);
    const detailData = prefs.include_item_scores ? _buildDetailRows(results, prefs) : null;
    const forceCsv = /\.csv$/i.test(requestedFilename);

    if (!forceCsv && typeof XLSX !== 'undefined') {
      const filename = requestedFilename.replace(/\.csv$/i, '.xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Results');
      if (detailData && detailData.length > 1) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailData), 'Item Details');
      }
      XLSX.writeFile(wb, filename);
      showMessage('Exported', `Excel file downloaded: ${filename}`);
      return filename;
    }

    const filename = requestedFilename.replace(/\.xlsx$/i, '.csv');
    const csvRows = detailData && detailData.length > 1
      ? [...summaryData, [], ['Item Details'], ...detailData]
      : summaryData;
    _downloadCsv(csvRows, filename);
    showMessage('Exported', `CSV file downloaded: ${filename}`);
    return filename;
  }

  function _buildSummaryRows(results, prefs) {
    const header = ['#'];
    if (prefs.include_student_info) header.push('Student Name', 'Section');
    if (prefs.include_total_score) header.push('Score', 'Total', '% Score');
    if (prefs.include_flagged_notes) header.push('Flagged', 'Status');
    const rows = [header];

    results.forEach((r, i) => {
      const row = [i + 1];
      if (prefs.include_student_info) row.push(r.student_name || '', r.section || '');
      if (prefs.include_total_score) row.push(r.score, r.total, r.percentage);
      if (prefs.include_flagged_notes) row.push(r.flagged_count, r.status);
      rows.push(row);
    });
    return rows;
  }

  function _buildDetailRows(results, prefs) {
    const header = [];
    if (prefs.include_student_info) header.push('Student', 'Section');
    header.push('Item #');
    if (prefs.include_question_type) header.push('Type');
    header.push('Student Answer', 'Correct Answer');
    header.push('Match %', 'Points', 'Earned');
    header.push('Status', 'Model');
    if (prefs.include_flagged_notes) header.push('Remarks');
    const rows = [header];

    for (const r of results) {
      const items = DB.resultItems(r.id);
      for (const it of items) {
        const row = [];
        if (prefs.include_student_info) row.push(r.student_name || '', r.section || '');
        row.push(it.item_no);
        if (prefs.include_question_type) row.push(it.type || '');
        row.push(it.student_answer || '', it.correct_answer || '');
        row.push(it.match_score || 0, it.points || 0, it.earned || 0);
        row.push(it.status || '', it.model_used || '');
        if (prefs.include_flagged_notes) row.push(it.remarks || '');
        rows.push(row);
      }
    }
    return rows;
  }

  function _formatExportFilename(sessionId, prefs) {
    const session = DB.sessions().find(s => s.id === sessionId) || {};
    const answerKey = DB.answerKeys().find(k => k.id === session.answer_key_id) || {};
    const results = DB.studentResults(sessionId);
    const sections = [...new Set(results.map(r => (r.section || '').trim()).filter(Boolean))];
    const date = new Date().toISOString().slice(0, 10);
    const tokens = {
      session: sessionId,
      date,
      answer_key: session.answer_key_name || answerKey.name || 'answer_key',
      subject: answerKey.subject || answerKey.name || 'subject',
      section: sections.length === 1 ? sections[0] : 'all_sections',
    };
    let format = (prefs.filename_format || 'grading_session_{session}_{date}.xlsx').trim();
    if (!format) format = 'grading_session_{session}_{date}.xlsx';
    format = format.replace(/\{(session|date|answer_key|subject|section)\}/g, (_, key) => tokens[key]);
    format = format.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
    if (!/\.(xlsx|csv)$/i.test(format)) format += '.xlsx';
    return format;
  }

  function _downloadCsv(rows, filename) {
    const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function _escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init, state,
    showView, enterApp, showPage,
    logout, updateUserLabels, clearRuntimeSelection,
    showMessage, showConfirm, exportSessionToFile,
  };
})();

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', () => App.init());
