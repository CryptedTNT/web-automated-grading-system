"""Checks a graded sheet's recognised section and name against the
teacher's class rosters. See database/migrations/V008 for the statuses.

Matching is deliberately conservative: a name is only ever auto-matched
when it is equal to exactly one roster name after normalisation. A close
spelling is offered as a suggestion for the teacher to confirm, never
applied silently. Sections are compared exactly (after canonical form),
because a similarity match would merge genuinely different sections such
as BSCS 1-A and BSCS 1-B.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from rapidfuzz.distance import Levenshtein
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ClassSection, ExamSheet, RosterStudent, StudentInfo
from app.sections import canonical_section

NAME_SUGGESTION_THRESHOLD = 70.0


def normalize_name(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^A-Za-z0-9]+", " ", text).strip().casefold()
    return re.sub(r"\s+", " ", text)


def _token_key(normalized: str) -> str:
    return " ".join(sorted(normalized.split()))


def same_name(left: str | None, right: str | None) -> bool:
    a, b = normalize_name(left), normalize_name(right)
    if not a or not b:
        return False
    return a == b or _token_key(a) == _token_key(b)


def name_similarity(left: str | None, right: str | None) -> float:
    """Percentage similarity (0-100). Word order is ignored, so
    "Race Jeremy" and "Jeremy Race" compare as identical."""
    a, b = normalize_name(left), normalize_name(right)
    if not a or not b:
        return 0.0
    direct = Levenshtein.normalized_similarity(a, b)
    token = Levenshtein.normalized_similarity(_token_key(a), _token_key(b))
    return round(max(direct, token) * 100, 2)


@dataclass(frozen=True)
class NameMatch:
    status: str  # matched | suggested | unmatched
    roster_id: int | None
    score: float | None


def match_name(detected: str | None, roster: list[tuple[int, str]]) -> NameMatch:
    if not normalize_name(detected) or not roster:
        return NameMatch("unmatched", None, None)

    exact = [roster_id for roster_id, full_name in roster if same_name(detected, full_name)]
    if len(exact) == 1:
        return NameMatch("matched", exact[0], 100.0)
    if len(exact) > 1:
        return NameMatch("unmatched", None, 100.0)

    scored = [(name_similarity(detected, full_name), roster_id) for roster_id, full_name in roster]
    close = [(score, roster_id) for score, roster_id in scored if score >= NAME_SUGGESTION_THRESHOLD]
    if len(close) == 1:
        score, roster_id = close[0]
        return NameMatch("suggested", roster_id, score)
    best = max(score for score, _ in scored)
    return NameMatch("unmatched", None, best)


def find_section_id(sections: list[tuple[int, str]], detected_section: str | None) -> int | None:
    key = canonical_section(detected_section)
    if not key:
        return None
    matches = [section_id for section_id, name in sections if canonical_section(name) == key]
    return matches[0] if len(matches) == 1 else None


def resolve_identity(
    db: Session, faculty_id: int, detected_name: str | None, detected_section: str | None
) -> dict:
    """Decides the roster link for one sheet. Returns the values that
    student_info stores. roster_status is None when the teacher has no
    sections at all, so teachers who do not use rosters see no flags.

    When the detected section is missing, unclear, or not on the teacher's
    list, the name is checked against every student across all sections,
    and the section of whichever student it matches is assigned."""
    name = (detected_name or "").strip() or None
    sections = [
        (row.section_id, row.section_name)
        for row in db.execute(
            select(ClassSection.section_id, ClassSection.section_name).where(
                ClassSection.faculty_id == faculty_id
            )
        )
    ]
    if not sections:
        return {"name": name, "detected_name": name, "section": canonical_section(detected_section) or None,
                "section_id": None, "roster_id": None, "roster_status": None, "roster_score": None}

    section_names = dict(sections)
    section_id = find_section_id(sections, detected_section)
    scope_section_ids = [section_id] if section_id is not None else list(section_names)
    roster_rows = list(
        db.execute(
            select(RosterStudent.roster_id, RosterStudent.full_name, RosterStudent.section_id)
            .where(RosterStudent.section_id.in_(scope_section_ids))
            .order_by(RosterStudent.section_id, RosterStudent.position)
        )
    )
    match = match_name(name, [(row.roster_id, row.full_name) for row in roster_rows])
    if match.roster_id is not None:
        matched_row = next(row for row in roster_rows if row.roster_id == match.roster_id)
        resolved_section_id = matched_row.section_id
        resolved_name = matched_row.full_name if match.status == "matched" else name
    else:
        resolved_section_id = section_id
        resolved_name = name
    return {
        "name": resolved_name,
        "detected_name": name,
        "section": section_names.get(resolved_section_id) or canonical_section(detected_section) or None,
        "section_id": resolved_section_id,
        "roster_id": match.roster_id,
        "roster_status": match.status,
        "roster_score": match.score,
    }


def find_duplicate_sheet(
    db: Session, answer_key_id: int, roster_id: int | None, name: str | None, exclude_sheet_id: int
) -> int | None:
    """Looks for an earlier sheet, on the same questionnaire, that
    appears to be the same student -- so a second upload of the same
    exam can be flagged rather than silently becoming a second record.

    Prefers the roster link when there is one (it is the more reliable
    identity), and only falls back to a normalised exact name match when
    there is no roster set up or the name did not resolve to one -- a
    name match alone is not strong enough to also try a close-spelling
    comparison here, unlike resolve_identity's own suggestions, since
    this result silently attaches to the new sheet rather than asking
    the teacher to confirm it first.
    """
    base = (
        select(StudentInfo.sheet_id, StudentInfo.name)
        .join(ExamSheet, ExamSheet.sheet_id == StudentInfo.sheet_id)
        .where(ExamSheet.answer_key_id == answer_key_id, ExamSheet.sheet_id != exclude_sheet_id)
        .order_by(ExamSheet.upload_date)
    )

    if roster_id is not None:
        match = db.scalar(base.where(StudentInfo.roster_id == roster_id).with_only_columns(StudentInfo.sheet_id))
        if match is not None:
            return match

    key = normalize_name(name)
    if not key:
        return None
    for sheet_id, candidate_name in db.execute(base):
        if normalize_name(candidate_name) == key:
            return sheet_id
    return None
