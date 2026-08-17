/* ============================================================
   services/grading.js — Enumeration answer matching

   Pure, framework-free matching logic for Enumeration-type answer
   key groups. Independent of any OCR/HTR model: it takes whatever
   list of "detected answers" the future HTR pipeline produces for
   a blank group and matches them against that group's correct
   answers from the answer key.

   Enumeration is the one question type where a naive "does the
   correct answer appear anywhere in what the student wrote" check
   goes wrong in three specific ways this module exists to prevent:

   1. Double-counting — a student who accidentally writes the same
      answer twice must not get credit for it twice. Each detected
      answer can satisfy at most one correct-answer slot.
   2. Scrambled order — Enumeration doesn't ask for a specific
      answer in a specific blank, so answers are matched as a set,
      not compared position-by-position like the other 3 question
      types.
   3. Different count — the student may write fewer or more answers
      than the key expects. Unmatched required slots simply score 0
      (no extra penalty); answers beyond what's required are
      reported back as `extraAnswers` rather than silently dropped
      or crashing, so the caller can decide whether to flag them
      for teacher review.
   ============================================================ */

/* Case/whitespace-insensitive similarity, 0-100, via Levenshtein
   edit distance. Lets each correct answer's own fuzzy_threshold
   (already part of the answer key schema, previously unused)
   tolerate small HTR misreads without an exact-string requirement. */
export function similarity(a, b) {
  const s1 = String(a ?? '').trim().toLowerCase()
  const s2 = String(b ?? '').trim().toLowerCase()
  if (!s1 && !s2) return 100
  if (!s1 || !s2) return 0
  if (s1 === s2) return 100

  const rows = s1.length + 1
  const cols = s2.length + 1
  const dist = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i += 1) dist[i][0] = i
  for (let j = 0; j < cols; j += 1) dist[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1, // deletion
        dist[i][j - 1] + 1, // insertion
        dist[i - 1][j - 1] + cost, // substitution
      )
    }
  }
  const editDistance = dist[rows - 1][cols - 1]
  const maxLen = Math.max(s1.length, s2.length)
  return Math.round((1 - editDistance / maxLen) * 100)
}

/**
 * Matches detected answers against the correct answers for one
 * Enumeration group.
 *
 * @param {Array<{item_no:number, correct_answer:string, points?:number, fuzzy_threshold?:number}>} correctItems
 *   the group's answer-key rows (all rows sharing one enum_group)
 * @param {Array<string>} detectedAnswers
 *   strings read off the student's blanks for that group, in
 *   whatever order the HTR model produced them — order is not
 *   assumed to line up with correctItems
 * @returns {{
 *   perSlot: Array<{item_no:number, correct_answer:string, matched_answer:?string, match_score:number, matched:boolean, points:number, earned:number}>,
 *   totalEarned: number,
 *   totalPossible: number,
 *   matchedCount: number,
 *   requiredCount: number,
 *   extraAnswers: Array<string>,
 * }}
 */
export function matchEnumerationAnswers(correctItems, detectedAnswers) {
  const detected = (detectedAnswers || [])
    .map((text, index) => ({ index, text: String(text ?? '').trim() }))
    .filter((d) => d.text)
  const detectedByIndex = new Map(detected.map((d) => [d.index, d.text]))

  // Score every (correct slot, detected answer) pair, then assign
  // greedily best-score-first. This is what makes matching set-based
  // instead of positional (fixes scrambled order) while guaranteeing
  // each side is claimed at most once (fixes double-counting).
  const pairs = []
  correctItems.forEach((item, slotIndex) => {
    detected.forEach((d) => {
      pairs.push({ slotIndex, detectedIndex: d.index, score: similarity(item.correct_answer, d.text) })
    })
  })
  pairs.sort((a, b) => b.score - a.score)

  const usedSlots = new Set()
  const usedDetected = new Set()
  const assignment = new Map() // slotIndex -> {detectedIndex, score}

  pairs.forEach(({ slotIndex, detectedIndex, score }) => {
    if (usedSlots.has(slotIndex) || usedDetected.has(detectedIndex)) return
    const threshold = correctItems[slotIndex].fuzzy_threshold ?? 85
    if (score < threshold) return
    usedSlots.add(slotIndex)
    usedDetected.add(detectedIndex)
    assignment.set(slotIndex, { detectedIndex, score })
  })

  let totalEarned = 0
  let totalPossible = 0
  const perSlot = correctItems.map((item, slotIndex) => {
    const points = Number(item.points) || 0
    totalPossible += points
    const match = assignment.get(slotIndex)
    const earned = match ? points : 0
    totalEarned += earned
    return {
      item_no: item.item_no,
      correct_answer: item.correct_answer,
      matched_answer: match ? detectedByIndex.get(match.detectedIndex) : null,
      match_score: match ? match.score : 0,
      matched: Boolean(match),
      points,
      earned,
    }
  })

  const extraAnswers = detected
    .filter((d) => !usedDetected.has(d.index))
    .map((d) => d.text)

  return {
    perSlot,
    totalEarned,
    totalPossible,
    matchedCount: assignment.size,
    requiredCount: correctItems.length,
    extraAnswers,
  }
}
