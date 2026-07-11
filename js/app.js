/* ============================================================
   app.js — Main controller, routing, init
   ============================================================ */

const App = (() => {
  /* ---------- Shared Application State ---------- */
  const state = {
    currentUser: null,
    selectedAnswerKeyId: null,
    uploadPaths: [],       // File objects from file input
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

  function _escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init, state,
    showView, enterApp, showPage,
    logout, updateUserLabels, clearRuntimeSelection,
    showMessage, showConfirm,
  };
})();

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', () => App.init());
