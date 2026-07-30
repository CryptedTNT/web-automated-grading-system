/* ============================================================
   auth.js — Setup, Login, Forgot Password pages
   ============================================================ */

const Auth = (() => {
  /* ---------- Helpers ---------- */
  function _heroHTML(footerText) {
    return `
      <div class="hero-panel">
        <div class="hero-icon">▣</div>
        <div class="hero-title"><span>Automated</span> <span>Grading System</span></div>
        <div class="hero-subtitle"><span>For Handwritten Objective</span> <span>Examinations</span></div>
        <div class="hero-footer">${footerText || 'Web-based prototype'}</div>
      </div>`;
  }

  function _reqLabel(text) {
    return `<span class="form-label">${text} <span class="required">*</span></span>`;
  }

  const EYE_OPEN = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const EYE_CLOSED = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  function _pwField(id, placeholder, tooltip) {
    return `
      <div class="password-wrapper">
        <input type="password" id="${id}" placeholder="${placeholder}" title="${tooltip}">
        <button type="button" class="password-toggle" data-target="${id}" title="Show password">${EYE_OPEN}</button>
      </div>`;
  }

  const PW_HINT = 'At least 8 characters, with a letter, a number, and a special character.';

  function _pwRulesHTML(inputId) {
    const items = DB.PASSWORD_RULES.map(
      rule => `<li data-rule="${rule.id}">${rule.label}</li>`
    ).join('');
    return `<ul class="pw-rules" id="${inputId}-rules" aria-live="polite">${items}</ul>`;
  }

  function _paintPwRules(inputId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(inputId + '-rules');
    if (!input || !list) return;
    const value = input.value;
    DB.checkPassword(value).results.forEach(result => {
      const li = list.querySelector(`li[data-rule="${result.id}"]`);
      if (!li) return;
      li.classList.remove('ok', 'bad');
      if (result.ok) li.classList.add('ok');
      else if (value) li.classList.add('bad');
    });
  }

  function _wirePwRules(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', () => _paintPwRules(inputId));
    _paintPwRules(inputId);
  }

  function _attachToggles(container) {
    container.querySelectorAll('.password-toggle').forEach(btn => {
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

  function _clearInvalid(container) {
    container.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => inp.classList.remove('invalid'));
    });
  }

  function _markBlanks(fields) {
    let blanks = [];
    fields.forEach(f => {
      const el = typeof f === 'string' ? document.getElementById(f) : f;
      if (!el) return;
      if (!el.value.trim()) { el.classList.add('invalid'); blanks.push(el); }
      else { el.classList.remove('invalid'); }
    });
    if (blanks.length) blanks[0].focus();
    return blanks;
  }

  /* ---------- Setup Page ---------- */
  function renderSetup() {
    const el = document.getElementById('auth-setup');
    el.innerHTML = `<div class="auth-container">
      ${_heroHTML()}
      <div class="auth-card">
        <div class="page-title">Set up your account</div>
        <div class="muted-text">Create your teacher account to get started.</div>
        <div class="form-group">${_reqLabel('Full Name')}
          <input type="text" id="setup-fullname" placeholder="Full name" title="Enter the full name of the teacher account owner."></div>
        <div class="form-group">${_reqLabel('Institution')}
          <input type="text" id="setup-institution" placeholder="Institution" title="Enter the school or institution name."></div>
        <div class="form-group">${_reqLabel('Username')}
          <input type="text" id="setup-username" placeholder="Username" title="Create a local username for signing in."></div>
        <div class="form-group">${_reqLabel('Password')}
          ${_pwField('setup-password', 'Password', 'Create a password. ' + PW_HINT)}
          ${_pwRulesHTML('setup-password')}</div>
        <div class="form-group">${_reqLabel('Confirm Password')}
          ${_pwField('setup-confirm', 'Confirm password', 'Re-type the password to confirm.')}</div>
        <div class="form-group">${_reqLabel('Security Question')}
          <select id="setup-question" title="Choose a security question for password reset.">
            <option>What personal word can you remember?</option>
            <option>What is your favorite teacher's nickname?</option>
            <option>What memorable place do you remember?</option>
          </select></div>
        <div class="form-group">${_reqLabel('Security Answer')}
          ${_pwField('setup-answer', 'Security answer', 'Enter the answer for password reset.')}</div>
        <div class="muted-text" id="setup-status"></div>
        <button class="btn btn-primary w-full" id="setup-btn" title="Create the local teacher account and proceed to login.">Create Account</button>
        <div class="spacer"></div>
      </div>
    </div>`;
    _attachToggles(el);
    _clearInvalid(el);
    _wirePwRules('setup-password');
    document.getElementById('setup-btn').addEventListener('click', submitSetup);
  }

  function submitSetup() {
    const fields = ['setup-fullname', 'setup-institution', 'setup-username', 'setup-password', 'setup-confirm', 'setup-answer'];
    if (_markBlanks(fields).length) {
      App.showMessage('Incomplete Setup', 'Please fill out all required fields.');
      return;
    }
    const pw = document.getElementById('setup-password').value;
    const confirm = document.getElementById('setup-confirm').value;
    const pwError = DB.passwordError(pw);
    if (pwError) {
      document.getElementById('setup-password').classList.add('invalid');
      _paintPwRules('setup-password');
      App.showMessage('Weak Password', pwError);
      return;
    }
    if (pw !== confirm) {
      document.getElementById('setup-password').classList.add('invalid');
      document.getElementById('setup-confirm').classList.add('invalid');
      App.showMessage('Password Mismatch', 'Password and confirm password do not match.');
      return;
    }
    try {
      DB.createUser(
        document.getElementById('setup-fullname').value,
        document.getElementById('setup-institution').value,
        document.getElementById('setup-username').value,
        pw,
        document.getElementById('setup-question').value,
        document.getElementById('setup-answer').value,
      );
    } catch (e) {
      App.showMessage('Account Setup Failed', e.message);
      return;
    }
    // Prefill login
    renderLogin();
    const loginUser = document.getElementById('login-username');
    if (loginUser) loginUser.value = document.getElementById('setup-username').value;
    setLoginStatus('Account created. Log in to continue.');
    App.showView('auth-login');
  }

  /* ---------- Login Page ---------- */
  function renderLogin() {
    const el = document.getElementById('auth-login');
    el.innerHTML = `<div class="auth-container">
      ${_heroHTML()}
      <div class="auth-card">
        <div class="page-title">Welcome back, Teacher!</div>
        <div class="muted-text">Please sign in to continue.</div>
        <div class="form-group">${_reqLabel('Username')}
          <input type="text" id="login-username" placeholder="Enter your username" title="Enter your local teacher account username."></div>
        <div class="form-group">${_reqLabel('Password')}
          ${_pwField('login-password', 'Enter your password', 'Enter your password.')}</div>
        <div class="flex items-center justify-between mb-8">
          <label class="checkbox-row"><input type="checkbox" id="login-remember" title="When checked, the app opens the dashboard directly next time."> Remember me</label>
          <button class="btn btn-secondary" id="login-forgot-btn" title="Reset your password using the saved security answer.">Forgot password?</button>
        </div>
        <div class="muted-text" id="login-status"></div>
        <button class="btn btn-primary w-full" id="login-btn" title="Sign in using the local teacher account.">Login</button>
        <div class="spacer"></div>
        <div class="muted-text text-center">© 2027 AGS. Web-based application.</div>
      </div>
    </div>`;
    _attachToggles(el);
    _clearInvalid(el);
    document.getElementById('login-btn').addEventListener('click', submitLogin);
    document.getElementById('login-forgot-btn').addEventListener('click', showForgot);
    document.getElementById('login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitLogin();
    });
    document.getElementById('login-username').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('login-password').focus();
    });
  }

  function submitLogin() {
    if (_markBlanks(['login-username', 'login-password']).length) {
      App.showMessage('Login Required', 'Please enter your username and password.');
      return;
    }
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('login-remember').checked;
    const user = DB.verifyUser(username, password);
    if (!user) {
      document.getElementById('login-username').classList.add('invalid');
      document.getElementById('login-password').classList.add('invalid');
      setLoginStatus('Invalid username or password.');
      App.showMessage('Login Failed', 'Invalid username or password.');
      return;
    }
    DB.setSetting('remember_me', remember ? 'true' : 'false');
    DB.setSetting('remembered_user_id', remember ? user.id : '');
    App.state.currentUser = user;
    App.clearRuntimeSelection();
    App.updateUserLabels();
    App.enterApp();
  }

  function setLoginStatus(msg) {
    const el = document.getElementById('login-status');
    if (el) el.textContent = msg;
  }

  function setSetupStatus(msg) {
    const el = document.getElementById('setup-status');
    if (el) el.textContent = msg;
  }

  /* ---------- Forgot Password Page ---------- */
  function showForgot() {
    const username = (document.getElementById('login-username') || {}).value || '';
    renderForgot(username);
    App.showView('auth-forgot');
  }

  function renderForgot(prefillUsername) {
    prefillUsername = prefillUsername || '';
    let questionText = 'Security question will be checked from the saved local account.';
    if (prefillUsername) {
      const u = DB.getUserByUsername(prefillUsername);
      if (u && u.security_question) questionText = u.security_question;
    }
    const el = document.getElementById('auth-forgot');
    el.innerHTML = `<div class="auth-container">
      ${_heroHTML()}
      <div class="auth-card">
        <div class="page-title">Reset Password</div>
        <div class="muted-text">Answer your security question. No email required.</div>
        <div class="form-group">${_reqLabel('Username')}
          <input type="text" id="forgot-username" placeholder="Username" value="${prefillUsername}" title="Enter the username of the local teacher account."></div>
        <div class="section-title mb-8" id="forgot-question-label">${questionText}</div>
        <div class="form-group">${_reqLabel('Security Answer')}
          ${_pwField('forgot-answer', 'Security answer', 'Enter the saved security answer.')}</div>
        <div class="form-group">${_reqLabel('New Password')}
          ${_pwField('forgot-newpw', 'New password', PW_HINT)}
          ${_pwRulesHTML('forgot-newpw')}</div>
        <div class="form-group">${_reqLabel('Confirm New Password')}
          ${_pwField('forgot-confirm', 'Confirm new password', 'Re-type the new password.')}</div>
        <div class="muted-text" id="forgot-status">Enter your username, security answer, and new password.</div>
        <div class="flex gap-8">
          <button class="btn btn-secondary" id="forgot-cancel-btn" title="Return to login.">Cancel</button>
          <button class="btn btn-primary" id="forgot-save-btn" title="Save new password after verifying security answer.">Save New Password</button>
        </div>
        <div class="spacer"></div>
      </div>
    </div>`;
    _attachToggles(el);
    _clearInvalid(el);
    _wirePwRules('forgot-newpw');
    // Update question when username changes
    document.getElementById('forgot-username').addEventListener('blur', () => {
      const u = DB.getUserByUsername(document.getElementById('forgot-username').value);
      if (u && u.security_question) {
        document.getElementById('forgot-question-label').textContent = u.security_question;
      }
    });
    document.getElementById('forgot-cancel-btn').addEventListener('click', () => {
      App.showView('auth-login');
    });
    document.getElementById('forgot-save-btn').addEventListener('click', submitForgot);
  }

  function submitForgot() {
    if (_markBlanks(['forgot-username', 'forgot-answer', 'forgot-newpw', 'forgot-confirm']).length) {
      App.showMessage('Incomplete Reset', 'Please fill out all required fields.');
      return;
    }
    const newPw = document.getElementById('forgot-newpw').value;
    const confirm = document.getElementById('forgot-confirm').value;
    const newPwError = DB.passwordError(newPw);
    if (newPwError) {
      document.getElementById('forgot-newpw').classList.add('invalid');
      _paintPwRules('forgot-newpw');
      App.showMessage('Weak Password', newPwError);
      return;
    }
    if (newPw !== confirm) {
      document.getElementById('forgot-newpw').classList.add('invalid');
      document.getElementById('forgot-confirm').classList.add('invalid');
      App.showMessage('Password Mismatch', 'New password and confirmation do not match.');
      return;
    }
    const username = document.getElementById('forgot-username').value.trim();
    const answer = document.getElementById('forgot-answer').value.trim();
    let ok = false;
    try {
      ok = DB.resetPasswordWithSecurityAnswer(username, answer, newPw);
    } catch (e) {
      App.showMessage('Reset Failed', e.message);
      return;
    }
    if (!ok) {
      document.getElementById('forgot-username').classList.add('invalid');
      document.getElementById('forgot-answer').classList.add('invalid');
      document.getElementById('forgot-status').textContent = 'Username or security answer is incorrect.';
      App.showMessage('Reset Failed', 'Username or security answer is incorrect.');
      return;
    }
    renderLogin();
    const loginUser = document.getElementById('login-username');
    if (loginUser) loginUser.value = username;
    setLoginStatus('Password reset. Log in using your new password.');
    App.showView('auth-login');
  }

  return {
    renderSetup, renderLogin, renderForgot, setLoginStatus, setSetupStatus,
    PW_HINT, pwRulesHTML: _pwRulesHTML, wirePwRules: _wirePwRules, paintPwRules: _paintPwRules
  };
})();
