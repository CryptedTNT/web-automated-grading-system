"""Reads a list of student names from an Excel workbook or a photographed
list. Both return names in the order they appear in the source.
"""

from __future__ import annotations

import io
import re
from collections.abc import Callable

import cv2
import numpy as np
from openpyxl import load_workbook
from PIL import Image

MAX_NAMES = 1000

HEADER_WORDS = {
    "name", "names", "student", "students", "student name", "student names", "full name",
    "fullname", "complete name", "pangalan", "last name", "first name", "surname", "given name",
    "learner", "learners", "no", "no.", "#",
}
_HEADER_PREFIXES = {"student", "full", "last", "first", "given"}

_NAME_CHARS = re.compile(r"^[^\W\d_](?:[^\W\d_]|[ .,'\-])*$")
_MIN_NAME_LETTERS = 2
_MAX_NAME_WORDS = 6
_LEADING_NUMBER = re.compile(r"^\s*\d{1,3}\s*[.,)\]:\-]\s*|^\s*\d{1,3}\s+")


class RosterImportError(Exception):
    """Carries a message the teacher can act on."""


def _is_header(text: str) -> bool:
    key = re.sub(r"\s+", " ", text.strip().casefold())
    if key in HEADER_WORDS:
        return True
    words = key.split()
    return len(words) <= 3 and words[-1] == "name" and words[0] in _HEADER_PREFIXES


def _looks_like_name(text: str) -> bool:
    value = text.strip()
    if not value or len(value) > 150 or _is_header(value):
        return False
    if not _NAME_CHARS.match(value):
        return False
    if sum(ch.isalpha() for ch in value) < _MIN_NAME_LETTERS:
        return False
    return len(value.split()) <= _MAX_NAME_WORDS


def _column_letter(index: int) -> str:
    letters = ""
    n = index
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def extract_names_from_excel(data: bytes) -> tuple[list[str], str]:
    """Returns (names, column_label) from the first sheet of an .xlsx.

    The names column is the one column whose entries (after an optional
    header) all look like person names, and it must be the only such
    column. Several candidates (for example separate first and last name
    columns) or none is refused with the reason, so a wrong column is
    never imported silently."""
    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 -- any unreadable file gets the same message
        raise RosterImportError("This file could not be read as an Excel workbook (.xlsx).") from exc

    try:
        sheet = workbook.worksheets[0]
        columns: dict[int, list[str]] = {}
        for row_index, row in enumerate(sheet.iter_rows(values_only=True), start=1):
            if row_index > 5000:
                break
            for col_index, cell in enumerate(row, start=1):
                if cell is None:
                    continue
                text = str(cell).strip()
                if text:
                    columns.setdefault(col_index, []).append(text)
    finally:
        workbook.close()

    candidates: list[tuple[int, list[str]]] = []
    for col_index, entries in columns.items():
        header = bool(entries) and _is_header(entries[0])
        values = entries[1:] if header else entries
        if not values or (len(values) < 2 and not header):
            continue
        if all(_looks_like_name(text) for text in values):
            candidates.append((col_index, values))

    if not candidates:
        found = "; ".join(
            f"column {_column_letter(i)} starts with \"{entries[0][:30]}\"" for i, entries in sorted(columns.items())
        ) or "no text"
        raise RosterImportError(
            "No column in this file looks like a list of student names. "
            f"Found: {found}. Put the names alone in one column, with an optional header row."
        )
    if len(candidates) > 1:
        names = ", ".join(f"column {_column_letter(i)}" for i, _ in candidates)
        raise RosterImportError(
            f"More than one column looks like student names ({names}). "
            "Keep only the full-name column in the file, then import again."
        )

    col_index, values = candidates[0]
    if len(values) > MAX_NAMES:
        raise RosterImportError(f"The file has more than {MAX_NAMES} names. Split it into smaller files.")
    return values, f"column {_column_letter(col_index)}"


def _clean_line_text(text: str) -> str:
    stripped = _LEADING_NUMBER.sub("", text or "").strip(" \t.,;:|")
    return re.sub(r"\s+", " ", stripped)


def _erase_rules(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Returns (ink mask, grayscale picture) with long horizontal and
    vertical strokes -- table rules and borders -- erased. Without this
    every text row would join into one band through the table lines."""
    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    height, width = ink.shape
    h_len = max(60, width // 6)
    v_len = max(60, height // 6)
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (h_len, 1)))
    vertical = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_len)))
    rules = cv2.bitwise_or(horizontal, vertical)
    cleaned = gray.copy()
    cleaned[rules > 0] = 255
    return cv2.bitwise_and(ink, cv2.bitwise_not(rules)), cleaned


def find_text_lines(ink: np.ndarray) -> list[tuple[int, int, int, int]]:
    """(x0, y0, x1, y1) boxes for each text line, top to bottom."""
    height, width = ink.shape
    row_ink = (ink > 0).sum(axis=1)
    active = row_ink > max(2, int(0.003 * width))

    bands: list[tuple[int, int]] = []
    start = None
    for y, on in enumerate(active):
        if on and start is None:
            start = y
        elif not on and start is not None:
            bands.append((start, y))
            start = None
    if start is not None:
        bands.append((start, height))

    min_height = max(8, int(0.01 * height))
    boxes = []
    for y0, y1 in bands:
        if y1 - y0 < min_height:
            continue
        cols = np.where((ink[y0:y1] > 0).any(axis=0))[0]
        if cols.size:
            boxes.append((int(cols[0]), y0, int(cols[-1]) + 1, y1))
    return boxes


def extract_names_from_image(
    image: Image.Image, recognize: Callable[[Image.Image], tuple[str, float]]
) -> list[str]:
    """One name per text line, top to bottom. Each line is cut from the
    cleaned picture and read with the same handwriting model used for
    answers. Lines that read as a header or contain no letters are dropped."""
    gray = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2GRAY)
    if gray.mean() < 128:
        gray = 255 - gray
    ink, cleaned = _erase_rules(gray)

    names: list[str] = []
    pad = 6
    for x0, y0, x1, y1 in find_text_lines(ink):
        crop = cleaned[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad]
        text, _confidence = recognize(Image.fromarray(crop).convert("RGB"))
        cleaned_text = _clean_line_text(text)
        if not cleaned_text or _is_header(cleaned_text):
            continue
        if sum(ch.isalpha() for ch in cleaned_text) < _MIN_NAME_LETTERS:
            continue
        names.append(cleaned_text)
        if len(names) >= MAX_NAMES:
            break
    return names
