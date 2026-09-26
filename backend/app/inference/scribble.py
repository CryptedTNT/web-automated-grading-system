"""Ignore crossed-out / scribbled-over writing so only the clear final answer is read.

A student who crosses an answer out and writes the correct one beside it leaves a dense black
blob (or loops) next to the real answer, and TrOCR happily reads the blob as text
("INFORMATION TECHNOLOGYOS" for a scribbled word next to a clean "OS"). This finds regions of
overwritten ink, whites them out, and lets the recognizer re-read what is left.

Ink density alone can't tell a scribble from bold handwriting (a heavy "TRUE" is as dense as a
small scribble), so removal is only ever *accepted* when both guards agree (see accept_cleaned):
a large dense area really was removed, and the recognizer is clearly more confident in what
remains. On 46 clean crops from two test sheets neither guard alone was enough -- the second one
is what stops a bold clean word from being "cleaned" into a different word -- and together they
changed none of them.
"""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

WINDOW_PX = 13  # local ink-density window
DENSITY_THRESHOLD = 0.55  # fraction of ink in the window above which ink counts as overwritten
MIN_COMPONENT_PX = 80  # ignore specks
GROW_PX = 3  # widen the removed area slightly so scribble edges go too
MIN_REMOVED_PX = 4000  # guard 1: a real scribble removes a lot of ink
MIN_CONFIDENCE_GAIN = 0.05  # guard 2: the recognizer must be clearly more confident afterwards


def scribble_mask(crop: Image.Image) -> np.ndarray:
    """1 where the crop holds overwritten (scribbled) ink, else 0."""
    rgb = np.asarray(crop.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    # paper brightness = grayscale closing (fills in dark strokes narrower than the kernel)
    paper = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)))
    ink = ((paper.astype(np.int16) - gray.astype(np.int16)) > 45).astype(np.uint8)
    density = cv2.boxFilter(ink.astype(np.float32), -1, (WINDOW_PX, WINDOW_PX), normalize=True)
    seed = cv2.dilate(((density > DENSITY_THRESHOLD) & (ink > 0)).astype(np.uint8), np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(seed, connectivity=8)
    mask = np.zeros_like(seed)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_COMPONENT_PX:
            mask[labels == i] = 1
    return cv2.dilate(mask, np.ones((2 * GROW_PX + 1, 2 * GROW_PX + 1), np.uint8))


def blank_out(crop: Image.Image, mask: np.ndarray) -> Image.Image:
    pixels = np.array(crop.convert("RGB"))
    pixels[mask > 0] = 255
    return Image.fromarray(pixels)


def candidate(crop: Image.Image) -> tuple[Image.Image, int] | None:
    """The crop with scribbles whited out, and how many pixels that removed --
    or None when the removed area is too small to be a scribble (guard 1)."""
    mask = scribble_mask(crop)
    removed = int(mask.sum())
    if removed < MIN_REMOVED_PX:
        return None
    return blank_out(crop, mask), removed


def accept_cleaned(original_confidence: float, cleaned_text: str, cleaned_confidence: float) -> bool:
    """Guard 2: keep the cleaned reading only if it is non-empty and clearly more confident."""
    return bool(cleaned_text.strip()) and cleaned_confidence >= original_confidence + MIN_CONFIDENCE_GAIN
