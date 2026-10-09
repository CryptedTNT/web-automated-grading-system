"""Small, shared helpers for presenting class sections consistently.

The handwriting model can reasonably return harmless spacing variants such
as ``BSCS 1A`` and ``BSCS 1 - A``.  They mean the same class, but treating
them as different values makes filtering and student history confusing.
This helper keeps the original program name while using one display form for
the year/letter suffix: ``PROGRAM 1-A``.
"""

from __future__ import annotations

import re


# Confirmed school-program aliases written by OCR/teachers with and without
# internal spaces. Keep this intentionally small: unknown program titles must
# not be guessed into a potentially wrong degree program.
_PROGRAM_ALIASES = {
    "BSINFOTECH": "BS INFOTECH",
}


def _canonical_program(value: str) -> str:
    program = re.sub(r"\s+", " ", value).strip()
    compact = re.sub(r"[^A-Z0-9]", "", program)
    return _PROGRAM_ALIASES.get(compact, program)


def canonical_section(value: str | None) -> str:
    """Return a stable display/filter value for a class section.

    This intentionally only normalizes the common ``year + letter`` suffix.
    A genuinely different section, such as ``BSCS 2-A`` versus ``BSCS 1-A``,
    remains distinct instead of being guessed or merged.
    """
    raw = str(value or "").strip()
    if not raw:
        return ""

    text = re.sub(r"[\u2013\u2014_]", "-", raw.upper())
    text = re.sub(r"\s+", " ", text).strip()
    match = re.fullmatch(r"(.+?)\s*(\d+)\s*[- ]?\s*([A-Z])", text)
    if match:
        program = _canonical_program(match.group(1))
        return f"{program} {match.group(2)}-{match.group(3)}"

    # Senior-high-style sections have no year digit at all (e.g. "STEM-A"),
    # so the branch above never applies to them -- without this, "STEM A"
    # and "STEM-A" canonicalize to two different strings (space kept vs.
    # hyphen kept) and show up as two separate sections everywhere.
    match = re.fullmatch(r"(.+?)\s*[- ]\s*([A-Z])", text)
    if match:
        program = _canonical_program(match.group(1))
        return f"{program}-{match.group(2)}"

    return re.sub(r"\s*-\s*", "-", text)
