/* ============================================================
   debug.js — Test/debug admin account and data seeding

   Disabled by default. Turn it on for a browser by opening the app
   with ?debug=1 (the flag is remembered until you open ?debug=0).
   Nothing in this file runs unless the flag is set.
   ============================================================ */

const Debug = (() => {
  const FLAG_KEY = 'ags_debug';

  const ACCOUNT = {
    full_name: 'Debug Admin',
    institution: 'Local Testing',
    username: 'admin',
    password: 'Admin@123',
    security_question: 'What personal word can you remember?',
    security_answer: 'debug',
  };

  let enabled = false;

  /* ---------- Flag handling ---------- */
  function _readFlag() {
    const param = new URLSearchParams(location.search).get('debug');
    if (param === '1' || param === 'true') {
      localStorage.setItem(FLAG_KEY, 'true');
      return true;
    }
    if (param === '0' || param === 'false') {
      localStorage.removeItem(FLAG_KEY);
      return false;
    }
    return localStorage.getItem(FLAG_KEY) === 'true';
  }

  function isEnabled() { return enabled; }

  /* ---------- Account ---------- */
  function ensureAccount() {
    const existing = DB.getUserByUsername(ACCOUNT.username);
    if (existing) return existing.id;
    return DB.createUser(
      ACCOUNT.full_name,
      ACCOUNT.institution,
      ACCOUNT.username,
      ACCOUNT.password,
      ACCOUNT.security_question,
      ACCOUNT.security_answer,
    );
  }

  function login() {
    ensureAccount();
    const user = DB.verifyUser(ACCOUNT.username, ACCOUNT.password);
    if (!user) {
      // The account exists but the password was changed since it was seeded.
      App.showMessage(
        'Debug Login Failed',
        `The "${ACCOUNT.username}" account exists but its password is no longer the seeded one. ` +
        'Sign in manually, or run AGSDebug.resetAll() to start clean.'
      );
      return null;
    }
    App.state.currentUser = user;
    App.clearRuntimeSelection();
    App.updateUserLabels();
    App.enterApp();
    return user;
  }

  /* ---------- Sample data ---------- */
  const SAMPLE_ITEMS = [
    { item_no: 1, type: 'Multiple Choice', correct_answer: 'A', alternatives: '', points: 1 },
    { item_no: 2, type: 'Multiple Choice', correct_answer: 'C', alternatives: '', points: 1 },
    { item_no: 3, type: 'True or False', correct_answer: 'True', alternatives: 'T', points: 1 },
    { item_no: 4, type: 'True or False', correct_answer: 'False', alternatives: 'F', points: 1 },
    { item_no: 5, type: 'Identification', correct_answer: 'Photosynthesis', alternatives: '', points: 2 },
    { item_no: 6, type: 'Identification', correct_answer: 'Mitochondria', alternatives: 'Mitochondrion', points: 2 },
    { item_no: 7, type: 'Enumeration', enum_group: '1', correct_answer: 'Solid', alternatives: '', points: 1 },
    { item_no: 8, type: 'Enumeration', enum_group: '1', correct_answer: 'Liquid', alternatives: '', points: 1 },
    { item_no: 9, type: 'Enumeration', enum_group: '1', correct_answer: 'Gas', alternatives: '', points: 1 },
    { item_no: 10, type: 'Identification', correct_answer: 'Newton', alternatives: '', points: 2 },
  ];

  const SAMPLE_STUDENTS = [
    'Reyes_Ana', 'Santos_Miguel', 'Cruz_Bea', 'Garcia_Paolo', 'Dela_Cruz_Liza',
  ];

  async function seedSampleData(sheetCount) {
    const count = Math.max(1, Math.min(parseInt(sheetCount) || 3, SAMPLE_STUDENTS.length));

    const keyId = DB.createAnswerKey('Debug Answer Key', 'General Science');
    DB.replaceAnswerKeyItems(keyId, SAMPLE_ITEMS.map(item => ({
      ...item,
      enum_group: item.enum_group || null,
      fuzzy_threshold: 85,
    })));

    const items = DB.answerKeyItems(keyId);
    const files = SAMPLE_STUDENTS.slice(0, count).map(name => ({ name: `${name}.jpg` }));
    const sessionId = DB.createSession(keyId, 'Debug Seed');

    const results = await ProcessingAdapter.runProcessingJob(files, items, {});
    results.forEach(result => {
      const resultId = DB.addStudentResult(
        sessionId,
        result.student_name,
        'Debug Section',
        result.image_path,
        result.score,
        result.total,
        result.percentage,
        result.flagged_count,
        result.status,
      );
      result.items.forEach(item => DB.addResultItem(resultId, item));
    });
    DB.updateSessionStatus(sessionId, 'Completed');

    App.state.selectedAnswerKeyId = keyId;
    App.state.currentSessionId = sessionId;
    _log(`Seeded session #${sessionId} with ${results.length} sheet(s) on answer key #${keyId}.`);
    return { sessionId, answerKeyId: keyId, sheets: results.length };
  }

  /* ---------- Destructive helpers ---------- */
  async function resetAll() {
    const ok = await App.showConfirm(
      'Reset All Data',
      'This deletes every account, answer key, session, and result stored in this browser. ' +
      'The app returns to the account setup screen. Continue?'
    );
    if (!ok) return false;
    DB.resetAllData();
    App.state.currentUser = null;
    // Reload without autologin, or the debug account would be re-created
    // immediately and the setup screen would be skipped again.
    _reloadWithoutAutologin();
    return true;
  }

  function _reloadWithoutAutologin() {
    const params = new URLSearchParams(location.search);
    if (!params.has('autologin')) { location.reload(); return; }
    params.delete('autologin');
    const query = params.toString();
    location.replace(`${location.pathname}${query ? '?' + query : ''}${location.hash || ''}`);
  }

  async function resetGrading() {
    const ok = await App.showConfirm(
      'Clear Grading Data',
      'This deletes all answer keys, sessions, and results but keeps accounts. Continue?'
    );
    if (!ok) return false;
    DB.resetGradingData();
    location.reload();
    return true;
  }

  function dumpState() {
    const snapshot = {
      currentUser: App.state.currentUser,
      stats: DB.dashboardStats(),
      answerKeys: DB.answerKeys(),
      sessions: DB.sessions(),
      results: DB.studentResults(),
      settings: DB.getSettings(),
    };
    console.log('[AGS debug] state snapshot', snapshot);
    return snapshot;
  }

  function disable() {
    localStorage.removeItem(FLAG_KEY);
    location.search = '';
  }

  /* ---------- Debug banner ---------- */
  function _renderBanner() {
    if (document.getElementById('debug-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'debug-bar';
    bar.setAttribute('style', [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:9998',
      'display:flex', 'align-items:center', 'gap:8px', 'flex-wrap:wrap',
      'padding:6px 10px', 'background:#3b1d5e', 'color:#fff',
      'font:12px/1.4 system-ui,sans-serif', 'box-shadow:0 -2px 8px rgba(0,0,0,.25)',
    ].join(';'));

    const btn = 'background:#fff;color:#3b1d5e;border:0;border-radius:4px;padding:4px 8px;font:inherit;font-weight:600;cursor:pointer;';
    bar.innerHTML = `
      <strong>DEBUG</strong>
      <span>${ACCOUNT.username} / ${ACCOUNT.password}</span>
      <span style="flex:1 1 auto;"></span>
      <button type="button" style="${btn}" data-debug="login">Log in as admin</button>
      <button type="button" style="${btn}" data-debug="seed">Seed sample data</button>
      <button type="button" style="${btn}" data-debug="dump">Dump state</button>
      <button type="button" style="${btn}" data-debug="reset">Reset all</button>
      <button type="button" style="${btn}" data-debug="off" title="Turn off debug mode">&times;</button>
    `;
    document.body.appendChild(bar);

    bar.addEventListener('click', async (event) => {
      const action = event.target.getAttribute?.('data-debug');
      if (!action) return;
      if (action === 'login') login();
      if (action === 'dump') dumpState();
      if (action === 'reset') resetAll();
      if (action === 'off') disable();
      if (action === 'seed') {
        if (!App.state.currentUser) { App.showMessage('Log In First', 'Log in as admin before seeding sample data.'); return; }
        const seeded = await seedSampleData(3);
        await App.showMessage('Sample Data Seeded', `Session #${seeded.sessionId} created with ${seeded.sheets} sheet(s).`);
        App.showPage('results');
      }
    });
  }

  function _log(message) {
    console.log(`[AGS debug] ${message}`);
  }

  /* ---------- Init ---------- */
  function init() {
    enabled = _readFlag();
    if (!enabled) return;

    // The account is created on demand (login / autologin), never here — seeding
    // on every load would re-create it after a reset and skip the setup screen.
    _renderBanner();

    // Prefill the login form so signing in is one click.
    const username = document.getElementById('login-username');
    const password = document.getElementById('login-password');
    if (username) username.value = ACCOUNT.username;
    if (password) password.value = ACCOUNT.password;

    if (new URLSearchParams(location.search).get('autologin') === '1') {
      login();
    }

    _log(`Debug mode active. Account "${ACCOUNT.username}" / "${ACCOUNT.password}". See window.AGSDebug.`);
  }

  return {
    init, isEnabled, ensureAccount, login, seedSampleData,
    resetAll, resetGrading, dumpState, disable, ACCOUNT,
  };
})();

window.AGSDebug = Debug;
