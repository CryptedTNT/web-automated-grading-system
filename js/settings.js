/* ============================================================
   settings.js — Settings page with tabs
   ============================================================ */

const Settings = (() => {
  const EYE_OPEN = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const EYE_CLOSED = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  function render() { /* rendered in refresh */ }

  function refresh() {
    const el = document.getElementById('page-settings');
    if (!el) return;

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Account, exam template, export preferences, appearance, and about.</div>
      </div>
      <div class="tabs" id="settings-tabs">
        <button class="tab-btn active" data-tab="set-account">Account</button>
        <button class="tab-btn" data-tab="set-template">Exam Template</button>
        <button class="tab-btn" data-tab="set-export">Export Preferences</button>
        <button class="tab-btn" data-tab="set-theme">Application Theme</button>
        <button class="tab-btn" data-tab="set-about">About</button>
      </div>

      <div class="tab-content active" id="set-account">
        <div class="card">
          <div class="card-title">Account Settings</div>
          <div class="form-group"><label class="form-label">Teacher Name</label>
            <input type="text" id="set-name" value="${_esc(App.state.currentUser?.full_name)}"></div>
          <div class="form-group"><label class="form-label">Institution</label>
            <input type="text" id="set-inst" value="${_esc(App.state.currentUser?.institution)}"></div>
          <div class="form-group"><label class="form-label">Username</label>
            <input type="text" id="set-user" value="${_esc(App.state.currentUser?.username)}" readonly style="opacity:0.6;"></div>
          <div class="form-group"><label class="form-label">Current Password</label>
            <div class="password-wrapper">
              <input type="password" id="set-oldpw" placeholder="Enter current password">
              <button type="button" class="password-toggle" data-target="set-oldpw" title="Show password">${EYE_OPEN}</button>
            </div>
          </div>
          <div class="form-group"><label class="form-label">New Password</label>
            <div class="password-wrapper">
              <input type="password" id="set-newpw" placeholder="Leave blank to keep current">
              <button type="button" class="password-toggle" data-target="set-newpw" title="Show password">${EYE_OPEN}</button>
            </div>
          </div>
          <button class="btn btn-primary mt-8" id="set-save-acct">Save Changes</button>
        </div>
      </div>

      <div class="tab-content" id="set-template">
        <div class="card">
          <div class="card-title">Exam Template</div>
          <div class="muted-text mb-8">The system requires a standardized examination sheet for accurate field detection.</div>
          <div class="muted-text mb-14">Template includes: header fields, answer blanks, Multiple Choice, True/False, Identification, and Enumeration.</div>
          <button class="btn btn-primary mb-8">Download Template (.docx)</button>
          <button class="btn btn-secondary">Open Template Folder</button>
        </div>
      </div>

      <div class="tab-content" id="set-export">
        <div class="card">
          <div class="card-title">Export Preferences</div>
          <div class="form-group"><label class="form-label">Default Export Folder</label>
            <input type="text" value="Downloads/" readonly></div>
          <div class="form-group"><label class="form-label">Excel Filename Format</label>
            <input type="text" value="{section}_{subject}_{date}.xlsx"></div>
          <div class="form-group" style="margin-top:12px;">
            <label class="checkbox-row"><input type="checkbox" checked> Student name and section</label>
            <label class="checkbox-row"><input type="checkbox" checked> Per-item scores</label>
            <label class="checkbox-row"><input type="checkbox" checked> Total score</label>
            <label class="checkbox-row"><input type="checkbox" checked> Flagged item notes</label>
            <label class="checkbox-row"><input type="checkbox" checked> Question type per item</label>
          </div>
          <button class="btn btn-primary mt-8">Save Preferences</button>
        </div>
      </div>

      <div class="tab-content" id="set-theme">
        <div class="card">
          <div class="card-title">Application Theme & Look</div>
          <div class="muted-text mb-14">Recommended theme: Ocean Blue</div>
          <div class="theme-row">
            <button class="theme-swatch" style="background:#1F6FB2;" data-theme="ocean">Ocean Blue</button>
            <button class="theme-swatch" style="background:#0B3558;" data-theme="deep">Deep Blue</button>
            <button class="theme-swatch" style="background:#2FAE73;" data-theme="green">Forest Green</button>
            <button class="theme-swatch" style="background:#8E5EA2;" data-theme="purple">Purple Haze</button>
            <button class="theme-swatch" style="background:#2D3748;" data-theme="dark">Dark</button>
          </div>
        </div>
      </div>

      <div class="tab-content" id="set-about">
        <div class="card">
          <div class="card-title">About</div>
          <div class="muted-text" style="line-height:1.8;white-space:pre-line;">Automated Grading System for Handwritten Objective Examinations Using Deep Learning

Researchers: Bueta, Cosico, Lumalang
Adviser: Prince Ross Andres
Laguna State Polytechnic University — San Pablo City Campus
A.Y. 2026–2027

Web-based prototype built with HTML, CSS, and JavaScript.</div>
        </div>
      </div>
    `;

    // Tab switching
    el.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        el.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab)?.classList.add('active');
      });
    });

    // Theme switching
    el.querySelectorAll('.theme-swatch').forEach(btn => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });

    // Save account
    document.getElementById('set-save-acct')?.addEventListener('click', () => {
      App.showMessage('Info', 'Account settings are display-only in this web prototype.');
    });

    // Password toggles
    el.querySelectorAll('.password-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        if (input.type === 'password') {
          input.type = 'text'; btn.innerHTML = EYE_CLOSED; btn.title = 'Hide password';
        } else {
          input.type = 'password'; btn.innerHTML = EYE_OPEN; btn.title = 'Show password';
        }
      });
    });
  }

  function _esc(val) {
    return String(val || '').replace(/"/g, '&quot;');
  }

  const PALETTES = {
    ocean: { sidebar: '#0B3558', sidebarHover: '#174D78', primary: '#1F6FB2', primaryHover: '#185C96', success: '#2FAE73', heroBg: '#0B3558' },
    deep:  { sidebar: '#062A46', sidebarHover: '#0A4268', primary: '#0B4F7A', primaryHover: '#083D5E', success: '#1B8A5A', heroBg: '#062A46' },
    green: { sidebar: '#12402B', sidebarHover: '#1F7A4F', primary: '#2FAE73', primaryHover: '#238B5D', success: '#2FAE73', heroBg: '#12402B' },
    purple:{ sidebar: '#3B245C', sidebarHover: '#6B3F82', primary: '#8E5EA2', primaryHover: '#744A87', success: '#2FAE73', heroBg: '#3B245C' },
    dark:  { sidebar: '#1F2937', sidebarHover: '#303A48', primary: '#374151', primaryHover: '#111827', success: '#2FAE73', heroBg: '#1F2937' },
  };

  function applyTheme(key) {
    const p = PALETTES[key] || PALETTES.ocean;
    const root = document.documentElement;
    root.style.setProperty('--sidebar-bg', p.sidebar);
    root.style.setProperty('--sidebar-hover', p.sidebarHover);
    root.style.setProperty('--primary', p.primary);
    root.style.setProperty('--primary-hover', p.primaryHover);
    root.style.setProperty('--success', p.success);
    root.style.setProperty('--hero-bg', p.heroBg);
    root.style.setProperty('--progress-fill', p.primary);
    root.style.setProperty('--input-focus', p.primary);
    root.style.setProperty('--tab-active-text', p.primary);
    DB.setSetting('theme', key);
  }

  function loadSavedTheme() {
    const saved = DB.getSettings().theme;
    if (saved && PALETTES[saved]) applyTheme(saved);
  }

  return { render, refresh, applyTheme, loadSavedTheme };
})();
