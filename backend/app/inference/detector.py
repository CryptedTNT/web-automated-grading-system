"""YOLO segmentation wrapper -- detects answer-region blanks and
header fields on a scanned exam sheet.

Model classes, read directly off models/yolo/best.pt via YOLO(...).names
(there is no second copy of this list anywhere -- if the model is
retrained with a different class set, only HEADER_FIELD_CLASSES below
needs updating):
    0 answer  -- any answer region, regardless of question type; which
                 answer_key_item it belongs to and which grading
                 function applies is resolved positionally in
                 pipeline.py from the answer key's own item_no and
                 question_type column, not from this class
    1 date
    2 name
    3 section
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ultralytics import YOLO

_WEIGHTS_PATH = Path(__file__).resolve().parent.parent.parent / "models" / "yolo" / "best.pt"

HEADER_FIELD_CLASSES = {"name", "date", "section"}

MODEL_NAME = "YOLOv26n-seg (backend/models/yolo/best.pt)"

# The weights were trained and evaluated at 1024 px. Ultralytics' predict()
# default is 640, which on a whole-page photo shrinks the thin answer
# underlines and handwriting enough to drop detections (one test sheet:
# 17 regions at 640 vs 24 at 1024).
INFERENCE_IMGSZ = 1024

# Two detections whose boxes overlap this much (intersection / the smaller
# box) are the same blank found twice, not two neighbouring answers: on the
# test sheets true duplicates scored 0.94-1.00, adjacent answers <= 0.44.
DUPLICATE_CONTAINMENT = 0.85

# An "answer" found within this fraction of the page height below the lowest
# detected header field (name/section/date) is almost certainly another
# header row the model mislabelled as an answer.
HEADER_BAND_FRACTION = 0.03

_model: YOLO | None = None


def get_detector() -> YOLO:
    """Loads the model once per process -- loading it per-request would
    make every upload pay the weight-loading cost."""
    global _model
    if _model is None:
        _model = YOLO(str(_WEIGHTS_PATH))
    return _model


@dataclass
class Detection:
    field_name: str | None  # name|date|section, or None for an answer region
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2 in pixel coordinates
    confidence: float  # the detector's own confidence, 0-1
    y_center: float  # used to sort into top-to-bottom reading order
    # Segmentation outline in pixel coordinates. The recognizer was trained on
    # crops with everything outside this outline blanked to white, so the
    # crop must be masked the same way (a plain rectangle drags in the
    # printed question text sitting next to the blank).
    polygon: tuple[tuple[float, float], ...] | None = None


def _area(b: tuple[int, int, int, int]) -> int:
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def _containment(a: Detection, b: Detection) -> float:
    """Intersection area divided by the SMALLER box's area (1.0 = one box sits inside the other)."""
    w = min(a.bbox[2], b.bbox[2]) - max(a.bbox[0], b.bbox[0])
    h = min(a.bbox[3], b.bbox[3]) - max(a.bbox[1], b.bbox[1])
    if w <= 0 or h <= 0:
        return 0.0
    return (w * h) / max(1, min(_area(a.bbox), _area(b.bbox)))


def _prefer(a: Detection, b: Detection) -> Detection:
    """Which of two duplicate detections to keep: a header class beats
    'answer' (the model sometimes labels the same line both ways); otherwise
    the tighter (smaller) box, since the looser one is the one that swallows
    printed text; then the more confident."""
    if (a.field_name is None) != (b.field_name is None):
        return a if a.field_name else b
    if _area(a.bbox) != _area(b.bbox):
        return a if _area(a.bbox) < _area(b.bbox) else b
    return a if a.confidence >= b.confidence else b


def suppress_duplicates(detections: list[Detection]) -> list[Detection]:
    """Drops the redundant one of every pair that is the same blank detected twice."""
    kept: list[Detection] = []
    for det in sorted(detections, key=lambda d: -d.confidence):
        for i, other in enumerate(kept):
            if _containment(det, other) >= DUPLICATE_CONTAINMENT:
                kept[i] = _prefer(det, other)
                break
        else:
            kept.append(det)
    return kept


def drop_header_rows(detections: list[Detection], page_height: int) -> list[Detection]:
    """Removes 'answer' detections that are really the rest of the header
    block (e.g. the Section or Date line labelled as an answer), which would
    otherwise be paired with question 1 and shift every later answer."""
    headers = [d for d in detections if d.field_name]
    if not headers:
        return detections
    limit = max(d.bbox[3] for d in headers) + HEADER_BAND_FRACTION * page_height
    return [d for d in detections if d.field_name or d.y_center > limit]


def detect_regions(image_path: str, confidence_threshold: float = 0.25) -> list[Detection]:
    """Runs the detector on one sheet image. Returns every detected
    answer region and header field; ordering them into reading order
    and matching them to specific answer_key_item rows is pipeline.py's
    job, not this module's -- this module only knows about pixels.
    """
    model = get_detector()
    results = model.predict(image_path, imgsz=INFERENCE_IMGSZ, conf=confidence_threshold, verbose=False)
    result = results[0]

    detections: list[Detection] = []
    if result.boxes is None:
        return detections

    polygons = result.masks.xy if result.masks is not None else None
    names = model.names
    for i, box in enumerate(result.boxes):
        class_name = names[int(box.cls[0])]
        field_name = class_name if class_name in HEADER_FIELD_CLASSES else None

        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
        polygon = None
        if polygons is not None and len(polygons[i]) >= 3:
            polygon = tuple((float(x), float(y)) for x, y in polygons[i])
        detections.append(
            Detection(
                field_name=field_name,
                bbox=(int(x1), int(y1), int(x2), int(y2)),
                confidence=float(box.conf[0]),
                y_center=(y1 + y2) / 2,
                polygon=polygon,
            )
        )
    detections = suppress_duplicates(detections)
    return drop_header_rows(detections, int(result.orig_shape[0]))
