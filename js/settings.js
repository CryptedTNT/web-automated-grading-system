/* ============================================================
   settings.js - Account, template, export, and theme settings
   ============================================================ */

const Settings = (() => {
  let activeTab = 'set-account';

  const PALETTES = {
    ocean: { label: 'Ocean Blue', swatch: '#1F6FB2', sidebar: '#0B3558', sidebarHover: '#174D78', primary: '#1F6FB2', primaryHover: '#185C96', success: '#2FAE73', heroBg: '#0B3558' },
    deep: { label: 'Deep Blue', swatch: '#0B4F7A', sidebar: '#062A46', sidebarHover: '#0A4268', primary: '#0B4F7A', primaryHover: '#083D5E', success: '#1B8A5A', heroBg: '#062A46' },
    green: { label: 'Forest Green', swatch: '#2FAE73', sidebar: '#12402B', sidebarHover: '#1F7A4F', primary: '#2FAE73', primaryHover: '#238B5D', success: '#2FAE73', heroBg: '#12402B' },
    purple: { label: 'Purple Haze', swatch: '#8E5EA2', sidebar: '#3B245C', sidebarHover: '#6B3F82', primary: '#8E5EA2', primaryHover: '#744A87', success: '#2FAE73', heroBg: '#3B245C' },
    dark: { label: 'Dark', swatch: '#374151', sidebar: '#1F2937', sidebarHover: '#303A48', primary: '#374151', primaryHover: '#111827', success: '#2FAE73', heroBg: '#1F2937' },
  };

  function render() { /* rendered by refresh */ }

  function refresh() {
    const el = document.getElementById('page-settings');
    if (!el) return;

    const user = App.state.currentUser || {};
    const prefs = DB.getExportPreferences();
    const savedTheme = DB.getSettings().theme || 'ocean';

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Manage the teacher account, exam template, exports, and appearance.</div>
      </div>

      <div class="tabs settings-tabs" id="settings-tabs" role="tablist">
        ${_tabButton('set-account', 'Account')}
        ${_tabButton('set-template', 'Exam Template')}
        ${_tabButton('set-export', 'Export Preferences')}
        ${_tabButton('set-theme', 'Application Theme')}
        ${_tabButton('set-about', 'About')}
      </div>

      <section class="tab-content settings-panel ${activeTab === 'set-account' ? 'active' : ''}" id="set-account" role="tabpanel">
        <div class="card-title">Account Settings</div>
        <div class="settings-form-grid">
          <div class="form-group">
            <label class="form-label" for="set-name">Teacher Name</label>
            <input type="text" id="set-name" maxlength="120" value="${_esc(user.full_name)}">
          </div>
          <div class="form-group">
            <label class="form-label" for="set-inst">Institution</label>
            <input type="text" id="set-inst" maxlength="160" value="${_esc(user.institution)}">
          </div>
          <div class="form-group settings-span-2">
            <label class="form-label" for="set-user">Username</label>
            <input type="text" id="set-user" value="${_esc(user.username)}" readonly>
          </div>
          ${_passwordField('set-oldpw', 'Current Password', 'Required only when changing the password')}
          ${_passwordField('set-newpw', 'New Password', 'New password', true)}
          ${_passwordField('set-confirmpw', 'Confirm New Password', 'Repeat the new password')}
        </div>
        <div class="settings-actions">
          <button class="btn btn-primary" id="set-save-acct">Save Changes</button>
        </div>
      </section>

      <section class="tab-content settings-panel ${activeTab === 'set-template' ? 'active' : ''}" id="set-template" role="tabpanel">
        <div class="card-title">Exam Template</div>
        <div class="template-summary">
          <div>
            <div class="section-title">Print-ready answer sheet</div>
            <div class="muted-text mt-8">Includes student fields and 20 standardized item rows for handwritten objective answers.</div>
          </div>
          <span class="badge badge-blue">HTML Template</span>
        </div>
        <div class="settings-actions">
          <button class="btn btn-primary" id="set-preview-template">Preview Template</button>
          <button class="btn btn-secondary" id="set-download-template">Download Template</button>
        </div>
      </section>

      <section class="tab-content settings-panel ${activeTab === 'set-export' ? 'active' : ''}" id="set-export" role="tabpanel">
        <div class="card-title">Export Preferences</div>
        <div class="settings-form-grid">
          <div class="form-group">
            <label class="form-label" for="set-export-folder">Download Location Label</label>
            <input type="text" id="set-export-folder" maxlength="80" value="${_esc(prefs.folder_label)}">
            <div class="muted-text mt-8">This label is saved for reference. The browser controls the actual download location.</div>
          </div>
          <div class="form-group">
            <label class="form-label" for="set-export-filename">Filename Format</label>
            <input type="text" id="set-export-filename" value="${_esc(prefs.filename_format)}">
            <div class="muted-text mt-8">Tokens: {session}, {date}, {answer_key}, {subject}, {section}</div>
          </div>
        </div>
        <fieldset class="preference-group">
          <legend>Included data</legend>
          ${_prefCheckbox('set-pref-student', 'Student name and section', prefs.include_student_info)}
          ${_prefCheckbox('set-pref-items', 'Item-level details and scores', prefs.include_item_scores)}
          ${_prefCheckbox('set-pref-total', 'Total score and percentage', prefs.include_total_score)}
          ${_prefCheckbox('set-pref-flags', 'Flagged counts, status, and notes', prefs.include_flagged_notes)}
          ${_prefCheckbox('set-pref-types', 'Question type', prefs.include_question_type)}
        </fieldset>
        <div class="settings-actions">
          <button class="btn btn-primary" id="set-save-export">Save Preferences</button>
        </div>
      </section>

      <section class="tab-content settings-panel ${activeTab === 'set-theme' ? 'active' : ''}" id="set-theme" role="tabpanel">
        <div class="card-title">Application Theme</div>
        <div class="theme-row">
          ${Object.entries(PALETTES).map(([key, palette]) => _themeButton(key, palette, savedTheme)).join('')}
        </div>
      </section>

      <section class="tab-content settings-panel ${activeTab === 'set-about' ? 'active' : ''}" id="set-about" role="tabpanel">
        <div class="card-title">About</div>
        <div class="about-copy">Automated Grading System for Handwritten Objective Examinations Using Deep Learning<br><br>
Researchers: Bueta, Cosico, Lumalang<br>
Adviser: Prince Ross Andres<br>
Laguna State Polytechnic University - San Pablo City Campus<br>
A.Y. 2026-2027<br><br>
Web frontend with an intentional model-pending processing adapter.</div>
      </section>
    `;

    _attachTabs(el);
    _attachPasswordToggles(el);
    Auth.wirePwRules('set-newpw');
    _attachThemeButtons(el);
    el.querySelector('#set-save-acct')?.addEventListener('click', saveAccount);
    el.querySelector('#set-save-export')?.addEventListener('click', saveExportPreferences);
    el.querySelector('#set-preview-template')?.addEventListener('click', previewTemplate);
    el.querySelector('#set-download-template')?.addEventListener('click', downloadTemplate);
  }

  function _tabButton(id, label) {
    const selected = activeTab === id;
    return `<button class="tab-btn ${selected ? 'active' : ''}" data-tab="${id}" role="tab" aria-selected="${selected}">${label}</button>`;
  }

  function _passwordField(id, label, placeholder, withRules) {
    return `<div class="form-group">
      <label class="form-label" for="${id}">${label}</label>
      <div class="password-wrapper">
        <input type="password" id="${id}" autocomplete="new-password" placeholder="${placeholder}">
        <button type="button" class="password-toggle" data-target="${id}" aria-label="Show ${label.toLowerCase()}">Show</button>
      </div>
      ${withRules ? Auth.pwRulesHTML(id) : ''}
    </div>`;
  }

  function _prefCheckbox(id, label, checked) {
    return `<label class="checkbox-row"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> <span>${label}</span></label>`;
  }

  function _themeButton(key, palette, savedTheme) {
    const active = savedTheme === key;
    return `<button class="theme-swatch ${active ? 'active' : ''}" style="background:${palette.swatch};" data-theme="${key}" aria-pressed="${active}">${palette.label}</button>`;
  }

  function _attachTabs(el) {
    el.querySelectorAll('.tab-btn').forEach(button => {
      button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        el.querySelectorAll('.tab-btn').forEach(tab => {
          const selected = tab === button;
          tab.classList.toggle('active', selected);
          tab.setAttribute('aria-selected', String(selected));
        });
        el.querySelectorAll('.tab-content').forEach(panel => panel.classList.toggle('active', panel.id === activeTab));
      });
    });
  }

  function _attachPasswordToggles(el) {
    el.querySelectorAll('.password-toggle').forEach(button => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.target);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.textContent = showing ? 'Show' : 'Hide';
        button.setAttribute('aria-label', `${showing ? 'Show' : 'Hide'} ${input.previousElementSibling?.textContent || 'password'}`);
      });
    });
  }

  function _attachThemeButtons(el) {
    el.querySelectorAll('.theme-swatch').forEach(button => {
      button.addEventListener('click', () => {
        applyTheme(button.dataset.theme);
        el.querySelectorAll('.theme-swatch').forEach(swatch => {
          const active = swatch === button;
          swatch.classList.toggle('active', active);
          swatch.setAttribute('aria-pressed', String(active));
        });
      });
    });
  }

  async function saveAccount() {
    const user = App.state.currentUser;
    if (!user) {
      await App.showMessage('Not Signed In', 'Please sign in before changing account settings.');
      return;
    }

    const nameInput = document.getElementById('set-name');
    const oldInput = document.getElementById('set-oldpw');
    const newInput = document.getElementById('set-newpw');
    const confirmInput = document.getElementById('set-confirmpw');
    const name = nameInput?.value.trim() || '';
    const institution = document.getElementById('set-inst')?.value.trim() || '';
    const currentPassword = oldInput?.value || '';
    const newPassword = newInput?.value || '';
    const confirmPassword = confirmInput?.value || '';

    [nameInput, oldInput, newInput, confirmInput].forEach(input => input?.classList.remove('invalid'));
    if (!name) {
      nameInput?.classList.add('invalid');
      await App.showMessage('Teacher Name Required', 'Enter the teacher name before saving.');
      nameInput?.focus();
      return;
    }

    const changingPassword = Boolean(currentPassword || newPassword || confirmPassword);
    if (changingPassword && (!currentPassword || !newPassword || !confirmPassword)) {
      [oldInput, newInput, confirmInput].forEach(input => input?.classList.add('invalid'));
      await App.showMessage('Password Fields Required', 'Complete all three password fields to change the password.');
      return;
    }
    const newPwError = changingPassword ? DB.passwordError(newPassword) : null;
    if (newPwError) {
      newInput?.classList.add('invalid');
      Auth.paintPwRules('set-newpw');
      await App.showMessage('Weak Password', newPwError);
      return;
    }
    if (changingPassword && newPassword !== confirmPassword) {
      newInput?.classList.add('invalid');
      confirmInput?.classList.add('invalid');
      await App.showMessage('Passwords Do Not Match', 'The new password and confirmation must match.');
      return;
    }

    try {
      if (changingPassword && !DB.updateUserPassword(user.id, currentPassword, newPassword)) {
        oldInput?.classList.add('invalid');
        await App.showMessage('Incorrect Password', 'The current password is incorrect.');
        return;
      }
      App.state.currentUser = DB.updateUserProfile(user.id, name, institution);
      App.updateUserLabels();
      await App.showMessage('Settings Saved', changingPassword ? 'Profile and password changes were saved.' : 'Profile changes were saved.');
      refresh();
    } catch (error) {
      await App.showMessage('Save Failed', error.message || 'Account settings could not be saved.');
    }
  }

  async function saveExportPreferences() {
    const filenameInput = document.getElementById('set-export-filename');
    const filename = filenameInput?.value.trim() || '';
    filenameInput?.classList.remove('invalid');
    if (!filename) {
      filenameInput?.classList.add('invalid');
      await App.showMessage('Filename Required', 'Enter an export filename format before saving.');
      filenameInput?.focus();
      return;
    }

    DB.setExportPreferences({
      folder_label: document.getElementById('set-export-folder')?.value.trim() || 'Downloads',
      filename_format: filename,
      include_student_info: document.getElementById('set-pref-student')?.checked ?? true,
      include_item_scores: document.getElementById('set-pref-items')?.checked ?? true,
      include_total_score: document.getElementById('set-pref-total')?.checked ?? true,
      include_flagged_notes: document.getElementById('set-pref-flags')?.checked ?? true,
      include_question_type: document.getElementById('set-pref-types')?.checked ?? true,
    });
    await App.showMessage('Preferences Saved', 'Export filename and column preferences were saved.');
  }

  function previewTemplate() {
    const preview = window.open('', '_blank');
    if (!preview) {
      App.showMessage('Preview Blocked', 'Allow pop-ups for this page to preview the exam template.');
      return;
    }
    preview.document.open();
    preview.document.write(_templateHtml());
    preview.document.close();
  }

  function downloadTemplate() {
    const blob = new Blob([_templateHtml()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ags_exam_template.html';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function _templateHtml() {
    const rows = Array.from({ length: 20 }, (_, index) => `<tr><td>${index + 1}</td><td></td><td></td></tr>`).join('');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AGS Exam Template</title>
  <style>
    * { box-sizing: border-box; }
    body { max-width: 820px; margin: 28px auto; padding: 0 24px; font-family: Arial, sans-serif; color: #111827; }
    h1 { margin: 0 0 4px; text-align: center; font-size: 21px; }
    .subtitle { text-align: center; color: #4b5563; margin-bottom: 24px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 28px; }
    .line { min-height: 30px; padding-top: 8px; border-bottom: 1px solid #111827; }
    table { width: 100%; margin-top: 22px; border-collapse: collapse; }
    th, td { height: 34px; padding: 7px; border: 1px solid #111827; text-align: left; }
    th { background: #e5e7eb; }
    th:first-child, td:first-child { width: 70px; text-align: center; }
    .print { margin: 0 0 18px; padding: 8px 14px; border: 0; background: #1f6fb2; color: white; cursor: pointer; }
    @media print { body { margin: 0; max-width: none; } .print { display: none; } }
  </style>
</head>
<body>
  <button class="print" onclick="window.print()">Print Template</button>
  <h1>Automated Grading System Answer Sheet</h1>
  <div class="subtitle">Handwritten Objective Examination Template</div>
  <div class="fields">
    <div>Name:<div class="line"></div></div>
    <div>Section:<div class="line"></div></div>
    <div>Date:<div class="line"></div></div>
    <div>Subject:<div class="line"></div></div>
  </div>
  <table>
    <thead><tr><th>Item #</th><th>Question Type</th><th>Answer</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
  }

  function applyTheme(key) {
    const palette = PALETTES[key] || PALETTES.ocean;
    const root = document.documentElement;
    root.style.setProperty('--sidebar-bg', palette.sidebar);
    root.style.setProperty('--sidebar-hover', palette.sidebarHover);
    root.style.setProperty('--primary', palette.primary);
    root.style.setProperty('--primary-hover', palette.primaryHover);
    root.style.setProperty('--success', palette.success);
    root.style.setProperty('--hero-bg', palette.heroBg);
    root.style.setProperty('--progress-fill', palette.primary);
    root.style.setProperty('--input-focus', palette.primary);
    root.style.setProperty('--tab-active-text', palette.primary);
    DB.setSetting('theme', key);
  }

  function loadSavedTheme() {
    const saved = DB.getSettings().theme;
    applyTheme(PALETTES[saved] ? saved : 'ocean');
  }

  function _esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { render, refresh, applyTheme, loadSavedTheme };
})();
