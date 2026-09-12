"""Runs one student's whole exam submission -- one or more page images --
through detection -> recognition -> grading. Called from
routers/sessions.py inside the per-sheet transaction described in
database/INTEGRATION_CONTRACT.md section 5.

Mapping detections to specific answer_key_item rows: the YOLO model's
classes already tell us the question TYPE of each detected region (see
detector.py's CLASS_TO_QUESTION_TYPE), so matching is done per type --
detections of one type are sorted top-to-bottom (y_center) and paired
positionally against that type's answer_key_item rows sorted by
item_no. This mirrors exactly how the printed questionnaire lays
sections out (see questionnaireHtml() in
vue-app/src/views/AnswerKeyView.vue: section I top to bottom, then II,
then III, then IV) -- the sheet a student writes on and the answer key
were generated from the same ordering, so position is a reliable key.

Multi-page submissions (V006's exam_sheet_page): a real exam can span
several photographed/scanned pages, only the first of which carries a
recognisable Name/Section header -- continuation pages are blank by
design (no QR code, no repeated header). Since the questionnaire is
always laid out in strictly increasing item_no order regardless of
where a page break happens to fall, pooling each page's per-type
detections **in page order** (page 1's top-to-bottom list, then page
2's, then page 3's...) before the same positional zip reconstructs
exactly the same global order as if every item were on one tall image.
That is the one thing that changed to support multiple pages -- no
need to track which items live on which page at all.

Enumeration is the one type needing an extra step: the answer key
stores several rows per group (enum_group), all sharing one prompt. The
group's blanks are consecutive in item_no order (see collectItems() in
AnswerKeyView.vue), so the sorted ENUMERATION detections (pooled across
pages the same way) are chunked by each group's blank count, in group
order, before handing that group's recognized text to
match_enumeration_answers() for set-based matching.

Recognition confidence below LOW_CONFIDENCE_THRESHOLD downgrades an
otherwise-decided MC/TF/Identification verdict to "flagged" rather than
trusting a match the recognizer itself wasn't confident about -- a
verdict is only as good as the text it was computed from. A verdict
that already landed on "correct" is never downgraded this way: an exact
match despite a low reported score is still an exact match.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from app.inference import recognizer
from app.inference.detector import Detection, detect_regions
from app.inference.grading import GradeVerdict, grade_exact, grade_fuzzy, grade_multiple_choice, match_enumeration_answers

MODEL_NAME = "YOLOv11-seg + TrOCR-custom"
LOW_CONFIDENCE_THRESHOLD = 0.5


def _crop(image: Image.Image, bbox: tuple[int, int, int, int]) -> Image.Image:
    x1, y1, x2, y2 = bbox
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(image.width, x2), min(image.height, y2)
    return image.crop((x1, y1, x2, y2))


def _maybe_flag_low_confidence(verdict: GradeVerdict, confidence: float) -> GradeVerdict:
    if verdict.status == "correct" or confidence >= LOW_CONFIDENCE_THRESHOLD:
        return verdict
    return GradeVerdict(
        "flagged",
        0.0,
        verdict.match_score,
        f"Recognition confidence {confidence:.0%} is low; needs review. {verdict.remarks or ''}".strip(),
    )


def run_sheet_group(image_paths: list[str], items: list, crop_dir: Path, sheet_code: str) -> dict:
    """
    image_paths: this submission's page images, in page order (page 1
    first -- the only one expected to carry the Name/Section header).
    items: AnswerKeyItem ORM rows for this sheet's answer key.
    Returns {
      "identity": {"name": str|None, "section": str|None},
      "answers": [{"item_id", "crop_path", "recognized_text", "confidence", "verdict"}],
    }
    """
    # Pooled per type across every page, in page order -- see the
    # module docstring for why this keeps positional pairing correct
    # across a page break. Each entry carries its own source image
    # since pages are separate files, unlike the single-image case.
    by_type: dict[str, list[tuple[Image.Image, Detection]]] = {}
    # First page that has a given header field wins -- only page 1 is
    # expected to have one, but nothing here assumes that.
    identity_boxes: dict[str, tuple[Image.Image, Detection]] = {}

    for image_path in image_paths:
        image = Image.open(image_path)
        detections = detect_regions(image_path)

        page_by_type: dict[str, list[Detection]] = {}
        for det in detections:
            if det.field_name:
                identity_boxes.setdefault(det.field_name, (image, det))
            elif det.question_type:
                page_by_type.setdefault(det.question_type, []).append(det)
        for group in page_by_type.values():
            group.sort(key=lambda d: d.y_center)

        for qtype, dets in page_by_type.items():
            by_type.setdefault(qtype, []).extend((image, det) for det in dets)

    items_by_type: dict[str, list] = {}
    for item in items:
        items_by_type.setdefault(item.question_type, []).append(item)
    for group in items_by_type.values():
        group.sort(key=lambda i: i.item_no)

    crop_dir.mkdir(parents=True, exist_ok=True)
    answers: list[dict] = []

    def recognize_and_save(image: Image.Image, det: Detection, item_id: int, suffix: str) -> tuple[str, float, str]:
        crop_img = _crop(image, det.bbox)
        crop_path = crop_dir / f"{sheet_code}_item{item_id}_{suffix}.png"
        crop_img.save(crop_path)
        text, confidence = recognizer.recognize_text(crop_img)
        return text, confidence, str(crop_path)

    # ---- MC / TF / Identification: one detection per item, positional pairing ----
    for qtype in ("MC", "TF", "IDENTIFICATION"):
        dets = by_type.get(qtype, [])
        its = items_by_type.get(qtype, [])
        for (image, det), item in zip(dets, its):
            text, confidence, crop_path = recognize_and_save(image, det, item.item_id, "a")
            if qtype == "IDENTIFICATION":
                verdict = grade_fuzzy(
                    text, item.correct_answer, item.alternative_answers, float(item.fuzzy_threshold or 85), float(item.points)
                )
            elif qtype == "MC":
                # Handles both a plain single-letter answer and a
                # "select all that apply" one with several correct
                # letters (e.g. "a,b,c") -- see grade_multiple_choice.
                verdict = grade_multiple_choice(text, item.correct_answer, item.alternative_answers, float(item.points))
            else:  # TF
                verdict = grade_exact(text, item.correct_answer, item.alternative_answers, float(item.points))
            verdict = _maybe_flag_low_confidence(verdict, confidence)
            answers.append(
                {"item_id": item.item_id, "crop_path": crop_path, "recognized_text": text, "confidence": confidence, "verdict": verdict}
            )
        # Items with no matching detection at all -- flagged, nothing to grade.
        for item in its[len(dets):]:
            answers.append(
                {
                    "item_id": item.item_id,
                    "crop_path": None,
                    "recognized_text": None,
                    "confidence": 0.0,
                    "verdict": GradeVerdict("flagged", 0.0, 0.0, "No answer region detected for this item."),
                }
            )

    # ---- Enumeration: chunk detections by each group's blank count, then set-match ----
    enum_dets = by_type.get("ENUMERATION", [])
    enum_items = items_by_type.get("ENUMERATION", [])
    groups: dict[int, list] = {}
    for item in enum_items:
        groups.setdefault(item.enum_group, []).append(item)

    cursor = 0
    for group_no in sorted(groups.keys()):
        group_items = groups[group_no]
        group_dets = enum_dets[cursor : cursor + len(group_items)]
        cursor += len(group_items)

        recognized_texts, crop_paths, confidences = [], [], []
        for (image, det), item in zip(group_dets, group_items):
            text, confidence, crop_path = recognize_and_save(image, det, item.item_id, "a")
            recognized_texts.append(text)
            crop_paths.append(crop_path)
            confidences.append(confidence)

        match_result = match_enumeration_answers(group_items, recognized_texts)
        slot_by_item_id = {slot.item_id: slot for slot in match_result["per_slot"]}
        for idx, item in enumerate(group_items):
            slot = slot_by_item_id[item.item_id]
            verdict = (
                GradeVerdict("correct", slot.earned, slot.match_score)
                if slot.matched
                else GradeVerdict("flagged", 0.0, slot.match_score, "No matching answer found within this enumeration group.")
            )
            answers.append(
                {
                    "item_id": item.item_id,
                    "crop_path": crop_paths[idx] if idx < len(crop_paths) else None,
                    "recognized_text": recognized_texts[idx] if idx < len(recognized_texts) else None,
                    "confidence": confidences[idx] if idx < len(confidences) else 0.0,
                    "verdict": verdict,
                }
            )

    # ---- Header fields (best-effort; not graded, just recognized) ----
    identity: dict[str, str] = {}
    for field_name in ("name_field", "section_field"):
        found = identity_boxes.get(field_name)
        if found:
            image, det = found
            text, _confidence, _crop_path = recognize_and_save(image, det, 0, field_name)
            identity[field_name.replace("_field", "")] = text

    return {"identity": identity, "answers": answers}
