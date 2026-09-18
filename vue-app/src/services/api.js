/* ============================================================
   api.js — HTTP client for the FastAPI backend (backend/app)

   Drop-in replacement for services/database.js's `DB` object: same
   function names, same parameter order, same return shapes. The one
   unavoidable difference is that every function here is async (it's
   a network call), so call sites need `await` where database.js's
   synchronous calls didn't need one — see backend plan's "Wiring the
   demo slice" for exactly which files that applies to.

   Session auth: the backend sets a signed session cookie on login
   (see backend/app/security.py) — every request below sends
   `credentials: 'include'` so that cookie rides along. There is no
   token to store client-side.
   ============================================================ */

const BASE = '/api'

/* A 401 from any real (already-authenticated) endpoint means this tab's
   session died server-side -- logged out in another tab, expired, or
   this is a stale tab left open from before a logout. The router guard
   alone doesn't catch this: it only checks this tab's in-memory
   store.isSignedIn, which still says "signed in" from before the
   cookie went bad, so it never re-asks the server. Without this, a
   page just silently keeps whatever default/empty state it started
   with (e.g. Dashboard's stats sitting at 0) instead of bouncing to
   login. /auth/login and /auth/me are excluded by callers: a 401 from
   those is an expected, normal outcome (wrong password; not-yet-signed-
   in probe), not a dead session. Returns true if it handled the
   response (a reload is already underway, so the caller should stop). */
function handleIfSessionExpired(res, path) {
  if (res.status !== 401 || path === '/auth/login' || path === '/auth/me') return false
  window.location.hash = '#/login?status=expired'
  window.location.reload()
  return true
}

/* fetch() itself throws (a bare "TypeError: Failed to fetch", not an
   HTTP error response) when the request never reaches a server at all --
   backend down, no network, a dropped wifi connection, CORS rejecting it
   outright. Left unwrapped, that raw browser string is what a teacher
   would see verbatim in a dialog, with no idea what it means or what to
   do about it. This turns it into an actionable message instead. */
async function safeFetch(url, opts) {
  try {
    return await fetch(url, opts)
  } catch {
    throw new Error('Could not reach the server. Check that it is running and your internet connection is working, then try again.')
  }
}

async function request(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  const res = await safeFetch(BASE + path, opts)
  if (res.status === 204) return null
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    if (handleIfSessionExpired(res, path)) return new Promise(() => {}) // navigation is already happening
    const message = (data && data.detail) || `Request failed: ${method} ${path} (${res.status})`
    const error = new Error(typeof message === 'string' ? message : JSON.stringify(message))
    // 429s from the resend-code cooldown carry a standard Retry-After
    // header (see backend/app/routers/auth.py's _require_not_cooling_down)
    // so callers can drive a countdown instead of treating this as a
    // real failure.
    const retryAfter = res.status === 429 ? Number(res.headers.get('Retry-After')) : null
    if (retryAfter) error.retryAfterSeconds = retryAfter
    throw error
  }
  return data
}

const get = (path) => request('GET', path)
const post = (path, body) => request('POST', path, body ?? {})
const patch = (path, body) => request('PATCH', path, body ?? {})
const put = (path, body) => request('PUT', path, body ?? {})
const del = (path) => request('DELETE', path)

/* ---------- Password rules (identical to database.js — pure client-side
   validation, no storage involved, so nothing about a backend changes it) --------- */
const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { id: 'letter', label: 'At least 1 letter', test: (pw) => /[A-Za-z]/.test(pw) },
  { id: 'number', label: 'At least 1 number', test: (pw) => /[0-9]/.test(pw) },
  { id: 'special', label: 'At least 1 special character', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
]

function checkPassword(password) {
  password = password || ''
  const results = PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, ok: rule.test(password) }))
  return { valid: results.every((r) => r.ok), failed: results.filter((r) => !r.ok), results }
}

function passwordError(password) {
  const { valid, failed } = checkPassword(password)
  if (valid) return null
  return 'Password must have: ' + failed.map((r) => r.label.toLowerCase()).join(', ') + '.'
}

export const API = {
  PASSWORD_RULES,
  checkPassword,
  passwordError,

  /* ---------- Users / auth ---------- */
  async hasUser() {
    const { has_user } = await get('/setup-state')
    return has_user
  },
  async createUser(fullName, institution, username, password, email) {
    const pwError = passwordError(password)
    if (pwError) throw new Error(pwError)
    // Returns the full signed-in user (same shape as verifyUser()) --
    // registering also establishes the session server-side, so the
    // caller can go straight into signIn() without a separate login.
    return post('/auth/register', {
      full_name: fullName,
      institution,
      username,
      password,
      email,
    })
  },
  async verifyUser(username, password) {
    try {
      return await post('/auth/login', { username, password })
    } catch (e) {
      // A 429 here means the account is rate-limited, not that the
      // password was wrong -- let the caller tell those apart instead
      // of collapsing every failure into "invalid credentials".
      if (e.retryAfterSeconds) throw e
      return null
    }
  },
  async getCurrentUser() {
    try {
      return await get('/auth/me')
    } catch {
      return null
    }
  },
  async logout() {
    await post('/auth/logout')
  },
  async getUserPublicById() {
    // With cookie-session auth the backend derives identity from the
    // session, not a client-held id — use getCurrentUser() instead.
    return API.getCurrentUser()
  },
  async updateUserProfile(userId, fullName, institution) {
    return patch('/account/profile', { full_name: fullName, institution })
  },
  async updateUserPassword(userId, currentPassword, newPassword) {
    const pwError = passwordError(newPassword)
    if (pwError) throw new Error(pwError)
    const { ok } = await post('/account/password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
    return ok
  },

  /* ---------- Email verification ---------- */
  async updateEmail(email) {
    return post('/account/email', { email })
  },
  async sendVerificationCode() {
    const { ok } = await post('/account/email/send-code')
    return ok
  },
  async verifyEmailCode(code) {
    const { ok } = await post('/account/email/verify', { code })
    return ok
  },

  /* ---------- Forgot password (email-code based) ---------- */
  async forgotSendCode(username) {
    // Throws with the backend's specific message (e.g. "email not
    // verified") on failure -- the caller shows it via showMessage.
    const { ok } = await post('/auth/forgot/send-code', { username })
    return ok
  },
  async forgotReset(username, code, newPassword) {
    const pwError = passwordError(newPassword)
    if (pwError) throw new Error(pwError)
    const { ok } = await post('/auth/forgot/reset', { username, code, new_password: newPassword })
    return ok
  },

  /* ---------- Answer keys ---------- */
  async createAnswerKey(name, subject) {
    const { id } = await post('/answer-keys', { name, subject })
    return id
  },
  async updateAnswerKey(keyId, name, subject) {
    await patch(`/answer-keys/${keyId}`, { name, subject })
  },
  async deleteAnswerKey(keyId) {
    await del(`/answer-keys/${keyId}`)
  },
  async answerKeys() {
    return get('/answer-keys')
  },
  async answerKeyItems(keyId) {
    return get(`/answer-keys/${keyId}/items`)
  },
  async replaceAnswerKeyItems(keyId, items) {
    await put(`/answer-keys/${keyId}/items`, { items })
  },

  /* ---------- Sessions ---------- */
  async createSession(answerKeyId, folder) {
    const { id } = await post('/sessions', { answer_key_id: answerKeyId, folder })
    return id
  },
  async updateSessionStatus(sessionId, status) {
    await patch(`/sessions/${sessionId}`, { status })
  },
  async failInterruptedSessions() {
    // The database version needed this because localStorage has no
    // transactions; a real commit either happens or it doesn't, so
    // there is nothing to sweep. Kept as a no-op for call-site parity.
    return false
  },
  async sessions() {
    return get('/sessions')
  },
  async latestSessionId() {
    const rows = await get('/sessions')
    return rows.length ? rows[0].id : null
  },
  async clearSession(sessionId) {
    await del(`/sessions/${sessionId}`)
  },
  async uploadSheetGroup(sessionId, files, consentConfirmed) {
    // Not part of database.js's surface -- there was no equivalent
    // concept when grading was a client-side placeholder. `files` is
    // every page of ONE student's submission, in page order (page 1
    // first -- the only one expected to carry a Name/Section header;
    // see backend/app/inference/pipeline.py's run_sheet_group). One
    // group per request (rather than the whole queue in one request)
    // is what lets the Processing page show real per-student progress,
    // since this blocks until that submission's real YOLO+TrOCR
    // grading has committed server-side.
    //
    // consentConfirmed is the teacher's own attestation, made once on
    // the Upload page, that paper consent was already collected for
    // this whole queue -- sent with every group so it's what
    // student_info.consent_status actually records per submission.
    const formData = new FormData()
    for (const file of files) formData.append('files', file)
    formData.append('consent_confirmed', consentConfirmed ? 'true' : 'false')
    const res = await safeFetch(`${BASE}/sessions/${sessionId}/sheets`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) {
      const path = `/sessions/${sessionId}/sheets`
      if (handleIfSessionExpired(res, path)) return new Promise(() => {}) // navigation is already happening
      const message = (data && data.detail) || `Upload failed (${res.status})`
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
    }
    return data
  },

  /* ---------- Student results ---------- */
  async studentResults(sessionId) {
    if (sessionId) return get(`/sessions/${sessionId}/results`)
    // No backend route lists every result across all sessions today
    // (no page currently calls studentResults() without a sessionId
    // except DashboardView's "recent" list, which reads sessions()
    // instead) — return [] rather than guess an endpoint shape.
    return []
  },
  async getStudentResultById(id) {
    try {
      return await get(`/sheets/${id}`)
    } catch {
      return null
    }
  },
  async updateStudentResult() {
    // The database version patches score/total/etc. directly. The
    // backend never stores those columns — v_sheet_result derives them
    // from grading_result rows — so there is nothing to write here.
    return null
  },
  async recalculateStudentResult(resultId) {
    // Same reasoning as updateStudentResult: nothing to recompute,
    // nothing to drift. Just hand back the current derived totals.
    return API.getStudentResultById(resultId)
  },

  /* ---------- Result items ---------- */
  async addResultItem() {
    // Result items are created server-side as part of the sheet-upload
    // transaction (POST /sessions/<id>/sheets) — see backend/app/routers/sessions.py.
    throw new Error('addResultItem is not called directly against the API — sheets are graded server-side.')
  },
  async resultItems(studentResultId) {
    return get(`/sheets/${studentResultId}/items`)
  },
  async updateResultItem(itemId, updates) {
    const action =
      updates.override_action ||
      (updates.status === 'Wrong' ? 'marked_incorrect' : updates.manual_override ? 'manual_answer_override' : 'accepted_correct')
    await post(`/results/${itemId}/review`, {
      action,
      corrected_answer: updates.student_answer ?? null,
    })
  },
  async getFirstFlaggedItem(studentResultId, sessionId) {
    const query = studentResultId ? `?prefer_result_id=${studentResultId}` : ''
    return get(`/sessions/${sessionId}/next-flagged${query}`)
  },

  /* ---------- Dashboard ---------- */
  async dashboardStats() {
    return get('/dashboard')
  },

  /* ---------- Settings ---------- */
  async getSettings() {
    return get('/settings')
  },
  async setSetting(key, value) {
    await put(`/settings/${encodeURIComponent(key)}`, { value })
  },
  async getExportPreferences() {
    const settings = await get('/settings')
    return (
      settings.export_preferences || {
        folder_label: 'Downloads',
        filename_format: 'grading_session_{session}_{date}.xlsx',
        include_student_info: true,
        include_item_scores: true,
        include_total_score: true,
        include_flagged_notes: true,
        include_question_type: true,
      }
    )
  },
  async setExportPreferences(preferences) {
    await put('/settings/export_preferences', { value: preferences })
    return preferences
  },
}
