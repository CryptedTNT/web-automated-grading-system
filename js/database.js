/* ============================================================
   database.js — localStorage CRUD (mirrors database.py)
   ============================================================ */

const DB = (() => {
  /* ---------- helpers ---------- */
  const _get = (key) => JSON.parse(localStorage.getItem(key) || '[]');
  const _set = (key, arr) => localStorage.setItem(key, JSON.stringify(arr));
  const _getObj = (key) => JSON.parse(localStorage.getItem(key) || '{}');
  const _setObj = (key, obj) => localStorage.setItem(key, JSON.stringify(obj));
  const _nextId = (key) => {
    const arr = _get(key);
    return arr.length ? Math.max(...arr.map(r => r.id)) + 1 : 1;
  };
  const _now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

  /* ---- self-contained, standard synchronous SHA-256 implementation ---- */
  function sha256(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    const lengthProperty = 'length';
    let i, j;
    let result = '';

    const words = [];
    const asciiLength = ascii[lengthProperty] * 8;
    
    let hash = sha256.h = sha256.h || [];
    let k = sha256.k = sha256.k || [];
    let primeCounter = k[lengthProperty];

    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) {
          isComposite[i] = 1;
        }
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    
    ascii += '\x80';
    while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return;
      words[i >> 2] |= j << ((3 - i % 4) * 8);
    }
    words[words[lengthProperty]] = ((asciiLength / maxWord) | 0);
    words[words[lengthProperty]] = (asciiLength | 0);
    
    let H0 = hash[0], H1 = hash[1], H2 = hash[2], H3 = hash[3], H4 = hash[4], H5 = hash[5], H6 = hash[6], H7 = hash[7];
    for (i = 0; i < words[lengthProperty]; i += 16) {
      const w = words.slice(i, i + 16);
      let oldH0 = H0, oldH1 = H1, oldH2 = H2, oldH3 = H3, oldH4 = H4, oldH5 = H5, oldH6 = H6, oldH7 = H7;
      for (j = 0; j < 64; j++) {
        if (j < 16) {
          // Already initialized
        } else {
          const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
          const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
          w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
        }
        const ch = (H4 & H5) ^ (~H4 & H6);
        const maj = (H0 & H1) ^ (H0 & H2) ^ (H1 & H2);
        const s0 = rightRotate(H0, 2) ^ rightRotate(H0, 13) ^ rightRotate(H0, 22);
        const s1 = rightRotate(H4, 6) ^ rightRotate(H4, 11) ^ rightRotate(H4, 25);
        const temp1 = (H7 + s1 + ch + k[j] + (w[j] || 0)) | 0;
        const temp2 = (s0 + maj) | 0;
        
        H7 = H6;
        H6 = H5;
        H5 = H4;
        H4 = (H3 + temp1) | 0;
        H3 = H2;
        H2 = H1;
        H1 = H0;
        H0 = (temp1 + temp2) | 0;
      }
      H0 = (H0 + oldH0) | 0;
      H1 = (H1 + oldH1) | 0;
      H2 = (H2 + oldH2) | 0;
      H3 = (H3 + oldH3) | 0;
      H4 = (H4 + oldH4) | 0;
      H5 = (H5 + oldH5) | 0;
      H6 = (H6 + oldH6) | 0;
      H7 = (H7 + oldH7) | 0;
    }
    
    const finalHashes = [H0, H1, H2, H3, H4, H5, H6, H7];
    for (i = 0; i < 8; i++) {
      const val = finalHashes[i];
      result += ((val >>> 24) & 0xff).toString(16).padStart(2, '0') +
                ((val >>> 16) & 0xff).toString(16).padStart(2, '0') +
                ((val >>> 8) & 0xff).toString(16).padStart(2, '0') +
                (val & 0xff).toString(16).padStart(2, '0');
    }
    return result;
  }

  function _hashSync(value, salt) {
    salt = salt || Math.random().toString(36).slice(2, 18);
    const hash = sha256(value + ':' + salt);
    return { hash, salt };
  }

  function _verifyHash(value, expectedHash, salt) {
    const { hash } = _hashSync(value, salt);
    return hash === expectedHash;
  }

  /* ======================== USERS ======================== */
  function hasUser() {
    return _get('ags_users').length > 0;
  }

  function createUser(fullName, institution, username, password, securityQuestion, securityAnswer) {
    fullName = (fullName || '').trim();
    institution = (institution || '').trim();
    username = (username || '').trim();
    securityQuestion = (securityQuestion || '').trim();
    securityAnswer = (securityAnswer || '').trim();
    if (!fullName) throw new Error('Full name is required.');
    if (!username) throw new Error('Username is required.');
    if (!password) throw new Error('Password is required.');
    if (password.length < 4) throw new Error('Password must be at least 4 characters.');
    if (!securityAnswer) throw new Error('Security answer is required.');

    const users = _get('ags_users');
    if (users.find(u => u.username === username)) {
      throw new Error('That username already exists. Choose another username.');
    }

    const pw = _hashSync(password);
    const sa = _hashSync(securityAnswer.toLowerCase());
    const user = {
      id: _nextId('ags_users'),
      full_name: fullName,
      institution,
      username,
      password_hash: pw.hash,
      salt: pw.salt,
      security_question: securityQuestion,
      security_answer_hash: sa.hash,
      security_answer_salt: sa.salt,
      created_at: _now(),
      last_login: ''
    };
    users.push(user);
    _set('ags_users', users);
    return user.id;
  }

  function verifyUser(username, password) {
    username = (username || '').trim();
    const users = _get('ags_users');
    const user = users.find(u => u.username === username);
    if (!user) return null;
    if (!_verifyHash(password || '', user.password_hash, user.salt)) return null;
    user.last_login = _now();
    _set('ags_users', users);
    return { id: user.id, full_name: user.full_name, institution: user.institution, username: user.username, created_at: user.created_at, last_login: user.last_login };
  }

  function getUserByUsername(username) {
    username = (username || '').trim();
    const users = _get('ags_users');
    const user = users.find(u => u.username === username);
    if (!user) return null;
    return { id: user.id, full_name: user.full_name, institution: user.institution, username: user.username, security_question: user.security_question };
  }

  function getUserPublicById(userId) {
    const users = _get('ags_users');
    const user = users.find(u => u.id === userId);
    if (!user) return null;
    return { id: user.id, full_name: user.full_name, institution: user.institution, username: user.username, created_at: user.created_at, last_login: user.last_login };
  }

  function updateUserProfile(userId, fullName, institution) {
    const users = _get('ags_users');
    const user = users.find(u => u.id === parseInt(userId));
    if (!user) throw new Error('Teacher account was not found.');
    fullName = (fullName || '').trim();
    institution = (institution || '').trim();
    if (!fullName) throw new Error('Teacher name is required.');
    user.full_name = fullName;
    user.institution = institution;
    _set('ags_users', users);
    return getUserPublicById(userId);
  }

  function updateUserPassword(userId, currentPassword, newPassword) {
    const users = _get('ags_users');
    const user = users.find(u => u.id === parseInt(userId));
    if (!user) throw new Error('Teacher account was not found.');
    if (!_verifyHash(currentPassword || '', user.password_hash, user.salt)) {
      return false;
    }
    if ((newPassword || '').length < 4) {
      throw new Error('New password must be at least 4 characters.');
    }
    const pw = _hashSync(newPassword);
    user.password_hash = pw.hash;
    user.salt = pw.salt;
    _set('ags_users', users);
    return true;
  }

  function resetPasswordWithSecurityAnswer(username, securityAnswer, newPassword) {
    username = (username || '').trim();
    const users = _get('ags_users');
    const user = users.find(u => u.username === username);
    if (!user) return false;
    if (!_verifyHash((securityAnswer || '').trim().toLowerCase(), user.security_answer_hash, user.security_answer_salt)) return false;
    if ((newPassword || '').length < 4) throw new Error('New password must be at least 4 characters.');
    const pw = _hashSync(newPassword);
    user.password_hash = pw.hash;
    user.salt = pw.salt;
    _set('ags_users', users);
    return true;
  }

  /* ======================== ANSWER KEYS ======================== */
  function createAnswerKey(name, subject) {
    const keys = _get('ags_answer_keys');
    const key = { id: _nextId('ags_answer_keys'), name: name || 'Untitled', subject: subject || '', created_at: _now() };
    keys.push(key);
    _set('ags_answer_keys', keys);
    return key.id;
  }

  function updateAnswerKey(keyId, name, subject) {
    const keys = _get('ags_answer_keys');
    const key = keys.find(k => k.id === keyId);
    if (key) { key.name = name; key.subject = subject || ''; }
    _set('ags_answer_keys', keys);
  }

  function deleteAnswerKey(keyId) {
    let keys = _get('ags_answer_keys');
    keys = keys.filter(k => k.id !== keyId);
    _set('ags_answer_keys', keys);
    // Also delete items
    let items = _get('ags_answer_key_items');
    items = items.filter(i => i.answer_key_id !== keyId);
    _set('ags_answer_key_items', items);
  }

  function answerKeys() {
    return _get('ags_answer_keys').sort((a, b) => b.id - a.id);
  }

  function answerKeyItems(keyId) {
    return _get('ags_answer_key_items')
      .filter(i => i.answer_key_id === keyId)
      .sort((a, b) => a.item_no - b.item_no);
  }

  function replaceAnswerKeyItems(keyId, items) {
    let all = _get('ags_answer_key_items');
    all = all.filter(i => i.answer_key_id !== keyId);
    let nextId = all.length ? Math.max(...all.map(r => r.id)) + 1 : 1;
    for (const item of items) {
      all.push({
        id: nextId++,
        answer_key_id: keyId,
        item_no: item.item_no,
        type: item.type,
        enum_group: item.enum_group || null,
        correct_answer: item.correct_answer,
        alternatives: item.alternatives || '',
        points: item.points || 1,
        fuzzy_threshold: item.fuzzy_threshold || 85,
      });
    }
    _set('ags_answer_key_items', all);
  }

  /* ======================== SESSIONS ======================== */
  function createSession(answerKeyId, folder) {
    const sessions = _get('ags_sessions');
    const session = {
      id: _nextId('ags_sessions'),
      answer_key_id: answerKeyId,
      name: `Session ${_now()}`,
      folder: folder || '',
      status: 'Processing',
      created_at: _now()
    };
    sessions.push(session);
    _set('ags_sessions', sessions);
    return session.id;
  }

  function updateSessionStatus(sessionId, status) {
    const sessions = _get('ags_sessions');
    const s = sessions.find(s => s.id === sessionId);
    if (s) s.status = status;
    _set('ags_sessions', sessions);
  }

  function sessions() {
    const sess = _get('ags_sessions');
    const keys = _get('ags_answer_keys');
    return sess.sort((a, b) => b.id - a.id).map(s => {
      const key = keys.find(k => k.id === s.answer_key_id);
      return { ...s, answer_key_name: key ? key.name : 'No key' };
    });
  }

  function latestSessionId() {
    const sess = _get('ags_sessions');
    if (!sess.length) return null;
    return Math.max(...sess.map(s => s.id));
  }

  function clearSession(sessionId) {
    let sess = _get('ags_sessions');
    sess = sess.filter(s => s.id !== sessionId);
    _set('ags_sessions', sess);
    // Also delete results and items
    let results = _get('ags_student_results');
    const rids = results.filter(r => r.session_id === sessionId).map(r => r.id);
    results = results.filter(r => r.session_id !== sessionId);
    _set('ags_student_results', results);
    let items = _get('ags_result_items');
    items = items.filter(i => !rids.includes(i.student_result_id));
    _set('ags_result_items', items);
  }

  /* ======================== STUDENT RESULTS ======================== */
  function addStudentResult(sessionId, studentName, section, imagePath, score, total, percentage, flaggedCount, status) {
    const results = _get('ags_student_results');
    const result = {
      id: _nextId('ags_student_results'),
      session_id: sessionId,
      student_name: studentName,
      section: section || '',
      image_path: imagePath || '',
      score, total, percentage,
      flagged_count: flaggedCount,
      status,
      created_at: _now()
    };
    results.push(result);
    _set('ags_student_results', results);
    return result.id;
  }

  function studentResults(sessionId) {
    let results = _get('ags_student_results');
    if (sessionId) results = results.filter(r => r.session_id === sessionId);
    return results.sort((a, b) => sessionId ? a.id - b.id : b.id - a.id);
  }

  /* ======================== RESULT ITEMS ======================== */
  function addResultItem(studentResultId, item) {
    const items = _get('ags_result_items');
    const autoStatus = item.auto_status || item.status || 'OK';
    const finalStatus = item.status || autoStatus;
    items.push({
      id: _nextId('ags_result_items'),
      student_result_id: studentResultId,
      item_no: item.item_no,
      type: item.type,
      enum_group: item.enum_group || null,
      student_answer: item.student_answer || '',
      correct_answer: item.correct_answer || '',
      alternatives: item.alternatives || '',
      match_score: item.match_score || 0,
      points: item.points || 1,
      earned: item.earned || 0,
      status: finalStatus,
      auto_status: autoStatus,
      manual_override: item.manual_override ? 1 : 0,
      override_action: item.override_action || '',
      remarks: item.remarks || '',
      model_used: item.model_used || '',
      confidence: item.confidence || 0,
      crop_path: item.crop_path || ''
    });
    _set('ags_result_items', items);
  }

  function resultItems(studentResultId) {
    return _get('ags_result_items')
      .filter(i => i.student_result_id === studentResultId)
      .sort((a, b) => a.item_no - b.item_no);
  }

  function updateResultItem(itemId, updates) {
    const items = _get('ags_result_items');
    const item = items.find(i => i.id === itemId);
    if (item) Object.assign(item, updates);
    _set('ags_result_items', items);
  }

  function updateStudentResult(resultId, updates) {
    const results = _get('ags_student_results');
    const r = results.find(r => r.id === resultId);
    if (r) Object.assign(r, updates);
    _set('ags_student_results', results);
  }

  function getStudentResultById(id) {
    return _get('ags_student_results').find(r => r.id === id) || null;
  }

  function recalculateStudentResult(resultId) {
    const items = resultItems(resultId);
    const score = items.reduce((s, x) => s + (parseFloat(x.earned) || 0), 0);
    const total = items.reduce((s, x) => s + (parseFloat(x.points) || 0), 0);
    const flagged = items.filter(x => x.status === 'Flagged').length;
    const pct = total ? Math.round((score / total) * 10000) / 100 : 0;
    const status = flagged ? 'Flagged' : 'OK';
    updateStudentResult(resultId, { score, total, percentage: pct, flagged_count: flagged, status });
    return { score, total, percentage: pct, flagged_count: flagged, status };
  }

  function getFirstFlaggedItem(studentResultId, sessionId) {
    const items = _get('ags_result_items').sort((a, b) => (a.item_no - b.item_no) || (a.id - b.id));
    if (studentResultId) {
      const found = items.find(i => i.student_result_id === parseInt(studentResultId) && i.status === 'Flagged');
      if (found) return found;
    }
    if (sessionId) {
      const results = _get('ags_student_results')
        .filter(r => r.session_id === parseInt(sessionId))
        .sort((a, b) => a.id - b.id);
      for (const r of results) {
        const found = items.find(i => i.student_result_id === r.id && i.status === 'Flagged');
        if (found) return found;
      }
    }
    return null;
  }

  /* ======================== DASHBOARD STATS ======================== */
  function dashboardStats() {
    const results = _get('ags_student_results');
    const sess = _get('ags_sessions');
    const sheets = results.length;
    const sessCount = sess.length;
    const flagged = results.reduce((s, r) => s + (r.flagged_count || 0), 0);
    const avg = sheets ? Math.round(results.reduce((s, r) => s + (r.percentage || 0), 0) / sheets * 100) / 100 : 0;
    return { sheets, sessions: sessCount, flagged, average: avg };
  }

  /* ======================== SETTINGS ======================== */
  function getSettings() { return _getObj('ags_settings'); }
  function setSetting(key, value) {
    const s = _getObj('ags_settings');
    s[key] = value;
    _setObj('ags_settings', s);
  }

  const DEFAULT_EXPORT_PREFERENCES = {
    folder_label: 'Downloads',
    filename_format: 'grading_session_{session}_{date}.xlsx',
    include_student_info: true,
    include_item_scores: true,
    include_total_score: true,
    include_flagged_notes: true,
    include_question_type: true,
  };

  function getExportPreferences() {
    const settings = getSettings();
    const saved = settings.export_preferences || {};
    return {
      folder_label: String(saved.folder_label || DEFAULT_EXPORT_PREFERENCES.folder_label),
      filename_format: String(saved.filename_format || DEFAULT_EXPORT_PREFERENCES.filename_format),
      include_student_info: typeof saved.include_student_info === 'boolean' ? saved.include_student_info : DEFAULT_EXPORT_PREFERENCES.include_student_info,
      include_item_scores: typeof saved.include_item_scores === 'boolean' ? saved.include_item_scores : DEFAULT_EXPORT_PREFERENCES.include_item_scores,
      include_total_score: typeof saved.include_total_score === 'boolean' ? saved.include_total_score : DEFAULT_EXPORT_PREFERENCES.include_total_score,
      include_flagged_notes: typeof saved.include_flagged_notes === 'boolean' ? saved.include_flagged_notes : DEFAULT_EXPORT_PREFERENCES.include_flagged_notes,
      include_question_type: typeof saved.include_question_type === 'boolean' ? saved.include_question_type : DEFAULT_EXPORT_PREFERENCES.include_question_type,
    };
  }

  function setExportPreferences(preferences) {
    const incoming = preferences || {};
    const next = {
      folder_label: String(incoming.folder_label || DEFAULT_EXPORT_PREFERENCES.folder_label).trim() || DEFAULT_EXPORT_PREFERENCES.folder_label,
      filename_format: String(incoming.filename_format || DEFAULT_EXPORT_PREFERENCES.filename_format).trim() || DEFAULT_EXPORT_PREFERENCES.filename_format,
      include_student_info: incoming.include_student_info !== false,
      include_item_scores: incoming.include_item_scores !== false,
      include_total_score: incoming.include_total_score !== false,
      include_flagged_notes: incoming.include_flagged_notes !== false,
      include_question_type: incoming.include_question_type !== false,
    };
    const settings = getSettings();
    settings.export_preferences = next;
    _setObj('ags_settings', settings);
    return next;
  }

  return {
    hasUser, createUser, verifyUser, getUserByUsername, getUserPublicById,
    updateUserProfile, updateUserPassword, resetPasswordWithSecurityAnswer,
    createAnswerKey, updateAnswerKey, deleteAnswerKey, answerKeys, answerKeyItems, replaceAnswerKeyItems,
    createSession, updateSessionStatus, sessions, latestSessionId, clearSession,
    addStudentResult, studentResults, addResultItem, resultItems,
    updateResultItem, updateStudentResult, recalculateStudentResult, getStudentResultById, getFirstFlaggedItem,
    dashboardStats,
    getSettings, setSetting, getExportPreferences, setExportPreferences,
  };
})();
