/* ============================================================
   services/backup.js — download and read whole-app backup files

   The validation and storage rules live in database.js, which owns
   STORAGE_KEYS. This module is only the file plumbing — the same
   split as services/export.js, so the Settings view stays thin.
   ============================================================ */

import { DB } from './database.js'

/** Filename for today's backup: ags_backup_2026-08-02.json */
function backupFilename() {
  return `ags_backup_${new Date().toISOString().slice(0, 10)}.json`
}

/**
 * Serialize every stored key and hand it to the browser as a download.
 * Returns the filename so the caller can name it in a dialog.
 */
export function downloadBackup() {
  const payload = DB.exportAllData()
  const filename = backupFilename()

  // Same Blob + object-URL + revoke dance as downloadCsv() in export.js.
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)

  return filename
}

/**
 * Read a picked file and parse it. Structural validation is left to
 * DB.importAllData — this only turns a File into an object, and turns
 * a parse failure into a message a teacher can act on.
 */
export async function readBackupFile(file) {
  let text
  try {
    text = await file.text()
  } catch {
    throw new Error('That file could not be read. Try choosing it again.')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON, so it is not a backup file.')
  }
}

/** Counts quoted in the restore confirmation, so the teacher can see
    what they are about to overwrite their browser with. */
export function summarize(payload) {
  const data = (payload && payload.data) || {}
  const count = (key) => (Array.isArray(data[key]) ? data[key].length : 0)
  return {
    accounts: count('ags_users'),
    answerKeys: count('ags_answer_keys'),
    sessions: count('ags_sessions'),
    studentResults: count('ags_student_results'),
    exportedAt: payload?.exported_at || 'an unknown date',
  }
}

/** One-line description of a backup for the confirm dialog. */
export function describe(payload) {
  const s = summarize(payload)
  return (
    `This backup was made on ${s.exportedAt} and contains ` +
    `${s.accounts} account(s), ${s.answerKeys} answer key(s), ` +
    `${s.sessions} session(s), and ${s.studentResults} student record(s).`
  )
}
