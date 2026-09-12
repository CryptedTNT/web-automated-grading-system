"""Answer matching/grading logic, run against real recognized text.

match_enumeration_answers() is a direct Python port of
matchEnumerationAnswers() in vue-app/src/services/grading.js -- see that
file's module docstring for the full rationale (order-invariant
matching, no double-counting a repeated answer, tolerant of the student
writing fewer/more answers than required). Keep the two in sync if the
algorithm changes; there is no shared module between the Python backend
and the JS frontend to do it once.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


def similarity(a: str | None, b: str | None) -> float:
    """Case/whitespace-insensitive Levenshtein similarity, 0-100."""
    s1 = (a or "").strip().lower()
    s2 = (b or "").strip().lower()
    if not s1 and not s2:
        return 100.0
    if not s1 or not s2:
        return 0.0
    if s1 == s2:
        return 100.0

    rows, cols = len(s1) + 1, len(s2) + 1
    dist = [[0] * cols for _ in range(rows)]
    for i in range(rows):
        dist[i][0] = i
    for j in range(cols):
        dist[0][j] = j
    for i in range(1, rows):
        for j in range(1, cols):
            cost = 0 if s1[i - 1] == s2[j - 1] else 1
            dist[i][j] = min(
                dist[i - 1][j] + 1,  # deletion
                dist[i][j - 1] + 1,  # insertion
                dist[i - 1][j - 1] + cost,  # substitution
            )

    edit_distance = dist[rows - 1][cols - 1]
    max_len = max(len(s1), len(s2))
    return round((1 - edit_distance / max_len) * 100, 2)


def _split_alternatives(alternatives: str | None) -> list[str]:
    if not alternatives:
        return []
    return [a.strip() for a in re.split(r"[,;\n]", alternatives) if a.strip()]


@dataclass
class GradeVerdict:
    status: str  # correct|incorrect|flagged
    score: float
    match_score: float
    remarks: str | None = None


def grade_exact(recognized: str | None, correct: str, alternatives: str | None, points: float) -> GradeVerdict:
    """True-or-False: exact match (case/whitespace-insensitive) against
    the correct answer or any listed alternative -- this type has a
    fixed set of valid values, so "close but not exact" is genuinely
    wrong, not a fuzzy-match candidate."""
    recognized_norm = (recognized or "").strip().lower()
    for candidate in [correct, *_split_alternatives(alternatives)]:
        if recognized_norm and recognized_norm == candidate.strip().lower():
            return GradeVerdict("correct", points, 100.0)
    return GradeVerdict(
        "incorrect", 0.0, 0.0, f'Recognized "{recognized}"; correct answer is "{correct}".'
    )


def _split_choice_letters(text: str | None) -> set[str]:
    """Splits an MC answer into a normalized set of single letters --
    "a", "A, B", "ABC", and "a b  c" all produce the same kind of set.
    A run of letters with no separator ("ABC") is treated as one letter
    per character, since MC choices here are always single letters
    (a/b/c/d): a student writing multiple selections together without
    spacing/commas is still selecting multiple letters, not one word."""
    if not text:
        return set()
    tokens = [t for t in re.split(r"[^a-zA-Z]+", text.strip()) if t]
    letters: set[str] = set()
    for token in tokens:
        letters.update(token.lower())
    return letters


def grade_multiple_choice(recognized: str | None, correct: str, alternatives: str | None, points: float) -> GradeVerdict:
    """Multiple Choice, including "select all that apply" items whose
    correct answer lists more than one letter (e.g. correct_answer
    "a,b,c"): correct only if the exact SET of letters the student
    wrote matches the correct set -- order doesn't matter, but nothing
    may be missing or extra (all-or-nothing, no partial credit). A
    single-letter correct answer behaves identically to a plain exact
    match, since comparing two one-element sets is the same thing --
    every existing single-answer MC item is unaffected by this.

    A single-answer item where the recognized text has MORE than one
    letter is not treated as a failed multi-select -- it's very likely
    a scratched-out answer with the correction written right next to
    it (e.g. a crossed-out "B" beside a clear "C"), which the OCR still
    reads as two characters even though a human can tell the intended
    final answer. Auto-grading that as wrong would silently sink an
    actually-correct answer, so it's flagged for a teacher to check
    instead of guessed at either way."""
    recognized_letters = _split_choice_letters(recognized)
    correct_letters = _split_choice_letters(correct)

    if len(correct_letters) == 1 and len(recognized_letters) > 1:
        return GradeVerdict(
            "flagged",
            0.0,
            0.0,
            f'Recognized "{recognized}" -- more than one letter for a single-answer item, '
            "likely a crossed-out/corrected answer; needs review.",
        )

    for candidate in [correct, *_split_alternatives(alternatives)]:
        if recognized_letters and recognized_letters == _split_choice_letters(candidate):
            return GradeVerdict("correct", points, 100.0)
    return GradeVerdict(
        "incorrect", 0.0, 0.0, f'Recognized "{recognized}"; correct answer is "{correct}".'
    )


def grade_fuzzy(
    recognized: str | None, correct: str, alternatives: str | None, threshold: float, points: float
) -> GradeVerdict:
    """Identification: best similarity against the correct answer or any
    alternative, compared against that item's own fuzzy_threshold."""
    candidates = [correct, *_split_alternatives(alternatives)]
    best = max((similarity(recognized, c) for c in candidates), default=0.0)
    if best >= 99.99:
        return GradeVerdict("correct", points, best)
    if best >= threshold:
        return GradeVerdict(
            "flagged", 0.0, best, f"Fuzzy match {best:.1f}% clears the {threshold:.0f}% threshold but is not exact; needs review."
        )
    return GradeVerdict(
        "incorrect", 0.0, best, f'Recognized "{recognized}"; best match {best:.1f}% is below threshold.'
    )


@dataclass
class EnumSlotResult:
    item_id: int
    matched_answer: str | None
    match_score: float
    matched: bool
    points: float
    earned: float


def match_enumeration_answers(items: list, detected_answers: list[str | None]) -> dict:
    """Matches detected answers against the correct answers for one
    Enumeration group (all `items` share one enum_group).

    `items` is a list of AnswerKeyItem ORM rows (needs .item_id,
    .correct_answer, .points, .fuzzy_threshold). `detected_answers` is
    whatever list of strings the HTR model read off that group's
    blanks, in whatever order detection happened to produce -- order is
    not assumed to correspond to `items`' order.
    """
    detected = [(i, str(t or "").strip()) for i, t in enumerate(detected_answers)]
    detected = [(i, t) for i, t in detected if t]
    detected_by_index = dict(detected)

    # Score every (item, detected-answer) pair, then assign greedily
    # best-score-first -- this is what makes matching set-based instead
    # of positional (fixes scrambled order) while guaranteeing each side
    # is claimed at most once (fixes double-counting a repeated answer).
    pairs: list[tuple[float, int, int]] = []
    for slot_index, item in enumerate(items):
        for detected_index, text in detected:
            pairs.append((similarity(item.correct_answer, text), slot_index, detected_index))
    pairs.sort(key=lambda p: p[0], reverse=True)

    used_slots: set[int] = set()
    used_detected: set[int] = set()
    assignment: dict[int, tuple[int, float]] = {}

    for score, slot_index, detected_index in pairs:
        if slot_index in used_slots or detected_index in used_detected:
            continue
        threshold = float(items[slot_index].fuzzy_threshold or 85)
        if score < threshold:
            continue
        used_slots.add(slot_index)
        used_detected.add(detected_index)
        assignment[slot_index] = (detected_index, score)

    total_earned = 0.0
    total_possible = 0.0
    per_slot: list[EnumSlotResult] = []
    for slot_index, item in enumerate(items):
        points = float(item.points)
        total_possible += points
        match = assignment.get(slot_index)
        earned = points if match else 0.0
        total_earned += earned
        per_slot.append(
            EnumSlotResult(
                item_id=item.item_id,
                matched_answer=detected_by_index.get(match[0]) if match else None,
                match_score=match[1] if match else 0.0,
                matched=bool(match),
                points=points,
                earned=earned,
            )
        )

    extra_answers = [t for i, t in detected if i not in used_detected]
    return {
        "per_slot": per_slot,
        "total_earned": total_earned,
        "total_possible": total_possible,
        "matched_count": len(assignment),
        "required_count": len(items),
        "extra_answers": extra_answers,
    }
