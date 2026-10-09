"""Detects a strikethrough in a cropped answer region.

A strikethrough is one thin, nearly horizontal stroke that spans most of
the written answer and runs through its letters, so the letters it
crosses have writing both above and below it. An underline has writing
only above it, and the crossbar of a single letter (the bar of an A)
spans no more than that letter. Both are rejected. A false positive only
sends the answer to teacher review, so the test errs toward flagging.

Strokes are found with a line detector rather than a fixed horizontal
kernel, because a photographed sheet is rarely perfectly level. The unit
of judgement is the letter, not the pixel column: T and E have their bars
at the top and bottom, so most of their columns have writing on one side
even when a strikethrough crosses them.
"""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

MIN_INK_PIXELS = 20
MIN_WIDTH = 24
MIN_HEIGHT = 10
STROKE_SPAN = 0.6
MAX_SLOPE = 0.14
MIDDLE_BAND = (0.3, 0.7)
MIN_LETTERS = 2
CROSSED_LETTER_RATIO = 0.75
CROSS_POSITION = (0.2, 0.8)


def _near_horizontal_lines(ink: np.ndarray, width: int) -> list[tuple[int, float, int, float]]:
    """Each line as (left x, y at left x, right x, slope)."""
    segments = cv2.HoughLinesP(
        ink,
        rho=1,
        theta=np.pi / 720,
        threshold=max(20, int(0.5 * width)),
        minLineLength=int(STROKE_SPAN * width),
        maxLineGap=max(4, int(0.04 * width)),
    )
    lines = []
    if segments is None:
        return lines
    for x1, y1, x2, y2 in segments.reshape(-1, 4):
        if x2 == x1:
            continue
        slope = (y2 - y1) / (x2 - x1)
        if abs(slope) <= MAX_SLOPE:
            lines.append((int(min(x1, x2)), float(y1 if x1 < x2 else y2), int(max(x1, x2)), float(slope)))
    return lines


def _y_at(line: tuple[int, float, int, float], x: float) -> float:
    x1, y1, _x2, slope = line
    return y1 + slope * (x - x1)


def _letter_groups(ink: np.ndarray) -> list[tuple[int, int]]:
    has_ink = ink.any(axis=0)
    groups = []
    start = None
    for x, on in enumerate(has_ink):
        if on and start is None:
            start = x
        elif not on and start is not None:
            groups.append((start, x))
            start = None
    if start is not None:
        groups.append((start, len(has_ink)))
    return groups


def _crossed_letters(
    letters: np.ndarray, line: tuple[int, float, int, float], band: int
) -> tuple[int, int]:
    """(letters crossed, letters the line spans)."""
    height = letters.shape[0]
    x1, _y1, x2, _slope = line
    spanned = [(a, b) for a, b in _letter_groups(letters) if b > x1 and a < x2]
    crossed = 0
    for a, b in spanned:
        rows = np.where(letters[:, a:b].any(axis=1))[0]
        if rows.size == 0:
            continue
        centre_y = _y_at(line, (a + b) / 2)
        letter_height = int(rows[-1]) - int(rows[0])
        if letter_height <= 0:
            continue
        position = (centre_y - int(rows[0])) / letter_height
        if not (CROSS_POSITION[0] <= position <= CROSS_POSITION[1]):
            continue
        top = int(centre_y) - band
        bottom = int(centre_y) + band + 1
        above = letters[: max(0, top), a:b].any()
        below = letters[min(height, bottom):, a:b].any()
        if above and below:
            crossed += 1
    return crossed, len(spanned)


def _erase_lines(ink: np.ndarray, lines: list[tuple[int, float, int, float]], band: int) -> np.ndarray:
    cleaned = ink.copy()
    height = ink.shape[0]
    for line in lines:
        x1, _y1, x2, _slope = line
        for x in range(max(0, x1), min(ink.shape[1], x2)):
            centre_y = int(round(_y_at(line, x)))
            cleaned[max(0, centre_y - band):min(height, centre_y + band + 1), x] = 0
    return cleaned


def has_strikethrough(crop: Image.Image) -> bool:
    gray = cv2.cvtColor(np.array(crop.convert("RGB")), cv2.COLOR_RGB2GRAY)
    ink = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    ys, xs = np.nonzero(ink)
    if xs.size < MIN_INK_PIXELS:
        return False

    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    width, height = x1 - x0, y1 - y0
    if width < MIN_WIDTH or height < MIN_HEIGHT:
        return False

    body = ink[y0:y1, x0:x1]
    lines = _near_horizontal_lines(body, width)
    band = max(2, int(0.04 * height))
    low, high = MIDDLE_BAND[0] * height, MIDDLE_BAND[1] * height
    letters = _erase_lines(body, lines, band)

    for line in lines:
        centre_y = float(np.mean([_y_at(line, x) for x in (line[0], line[2])]))
        if not (low <= centre_y <= high):
            continue
        crossed, total = _crossed_letters(letters, line, band)
        if total >= MIN_LETTERS and crossed / total >= CROSSED_LETTER_RATIO:
            return True
    return False
