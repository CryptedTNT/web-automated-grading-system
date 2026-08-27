"""YOLOv11 segmentation wrapper -- detects answer-region blanks and
header fields on a scanned exam sheet.

Model classes, read directly off models/yolo/best.pt via YOLO(...).names
(there is no second copy of this list anywhere -- if the model is
retrained with a different class set, only CLASS_TO_QUESTION_TYPE and
HEADER_FIELD_CLASSES below need updating):
    0 handwritten-exam-answer-region-s  -- generic/unlabeled region, not
                                            mapped to anything, skipped
    1 date_field
    2 enumeration_answer
    3 identification_answer
    4 multiple_choice_answer
    5 name_field
    6 section_field
    7 true_false_answer
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ultralytics import YOLO

_WEIGHTS_PATH = Path(__file__).resolve().parent.parent.parent / "models" / "yolo" / "best.pt"

CLASS_TO_QUESTION_TYPE = {
    "multiple_choice_answer": "MC",
    "true_false_answer": "TF",
    "identification_answer": "IDENTIFICATION",
    "enumeration_answer": "ENUMERATION",
}
HEADER_FIELD_CLASSES = {"name_field", "date_field", "section_field"}

MODEL_NAME = "YOLOv11-seg (backend/models/yolo/best.pt)"

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
    question_type: str | None  # MC|TF|IDENTIFICATION|ENUMERATION, or None for a header field
    field_name: str | None  # name_field|date_field|section_field, or None for an answer region
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2 in pixel coordinates
    confidence: float  # the detector's own confidence, 0-1
    y_center: float  # used to sort into top-to-bottom reading order


def detect_regions(image_path: str, confidence_threshold: float = 0.25) -> list[Detection]:
    """Runs the detector on one sheet image. Returns every detected
    answer region and header field; ordering them into reading order
    and matching them to specific answer_key_item rows is pipeline.py's
    job, not this module's -- this module only knows about pixels.
    """
    model = get_detector()
    results = model.predict(image_path, conf=confidence_threshold, verbose=False)
    result = results[0]

    detections: list[Detection] = []
    if result.boxes is None:
        return detections

    names = model.names
    for box in result.boxes:
        class_name = names[int(box.cls[0])]
        question_type = CLASS_TO_QUESTION_TYPE.get(class_name)
        field_name = class_name if class_name in HEADER_FIELD_CLASSES else None
        if question_type is None and field_name is None:
            continue  # class 0, the unmapped generic region -- skip

        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
        detections.append(
            Detection(
                question_type=question_type,
                field_name=field_name,
                bbox=(int(x1), int(y1), int(x2), int(y2)),
                confidence=float(box.conf[0]),
                y_center=(y1 + y2) / 2,
            )
        )
    return detections
