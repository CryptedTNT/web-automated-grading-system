/* ============================================================
   services/sessionNumbers.js — the "Session #" a teacher sees

   A number is a plain running count of THEIR successfully finished
   sessions, oldest = #1, the same on every page. It is not the
   database id: every session that is created and later deleted
   permanently burns an id, so ids show gaps (#3, #4, #9...) that look
   like sessions are going missing.

   Only a session with status "Completed" is numbered. A cancelled or
   failed run did not produce a finished session, so it must not use
   up a number -- otherwise cancelling and restarting showed #6, then
   #7, for what is really the teacher's fifth finished session. A run
   still in progress shows the number it will get if it finishes (the
   next one), so a cancelled attempt and its restart both read "#5".
   Cancelled runs are discarded and omitted from session lists. Failed
   runs remain visible with a status instead of a number.

   GET /sessions returns the signed-in teacher's sessions newest-first
   and never paginates, so the whole history is always here.

   Call refreshSessionNumbers() whenever the session list is loaded
   (pass the rows you already fetched to avoid a second request), and
   again after creating, finishing, cancelling or deleting a session --
   a session's number depends on the statuses of all the others.
   ============================================================ */

import { computed, ref } from 'vue'
import { API } from '@/services/api.js'

/* Every existing session as { id, status }, newest first. */
const sessionList = ref([])

export async function refreshSessionNumbers(rows) {
  try {
    const list = rows ?? (await API.sessions())
    sessionList.value = list.map((session) => ({ id: session.id, status: session.status }))
  } catch {
    /* Keep the last known list: a failed refresh should not blank every number. */
  }
}

/* Completed sessions numbered oldest-first, plus the number the next
   one to finish will get. */
const numbering = computed(() => {
  const numbers = new Map()
  let finished = 0
  for (let i = sessionList.value.length - 1; i >= 0; i -= 1) {
    const { id, status } = sessionList.value[i]
    if (status === 'Completed') numbers.set(id, (finished += 1))
  }
  return { numbers, next: finished + 1 }
})

function statusOf(id) {
  return sessionList.value.find((session) => session.id === id)?.status
}

/* The number the next successfully finished session will get. */
export function nextSessionNumber() {
  return numbering.value.next
}

/* A session's number, or null when it has none: cancelled and failed
   sessions never get one. A run in progress gets the next number, but
   only the newest session can be the live run -- an older session stuck
   on "Processing" (an interrupted run) would otherwise show the same
   provisional number as the real one. */
export function sessionNumber(id) {
  const { numbers, next } = numbering.value
  if (numbers.has(id)) return numbers.get(id)
  const newest = sessionList.value[0]
  return newest && newest.id === id && newest.status === 'Processing' ? next : null
}

/* Short form for table cells and dropdown options: "#5", or the status
   ("Cancelled", "Failed") when the session has no number. */
export function sessionTag(id) {
  const number = sessionNumber(id)
  if (number !== null) return `#${number}`
  const status = statusOf(id)
  return status === 'Cancelled' || status === 'Failed' ? status : '—'
}

/* Sentence form: "Session #5", "Cancelled session", "Failed session". */
export function sessionLabel(id) {
  const number = sessionNumber(id)
  if (number !== null) return `Session #${number}`
  const status = statusOf(id)
  return status === 'Cancelled' || status === 'Failed' ? `${status} session` : 'Session'
}
