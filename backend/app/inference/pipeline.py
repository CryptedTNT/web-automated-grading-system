"""Runs one student's whole exam submission -- one or more page images --
through detection -> recognition -> grading. Called from
routers/sessions.py inside the per-sheet transaction described in
database/INTEGRATION_CONTRACT.md section 5.

Mapping detections to specific answer_key_item rows: the YOLO model
detects answer regions generically -- one "answer" class covering
every question type, it does not tell us which type a given region
belongs to. So ALL of a page's answer detections (everything that
isn't a header field) are pooled in top-to-bottom (y_center) reading
order, pooled again across pages in page order, and paired
positionally, one-to-one, against every answer_key_item sorted by
item_no. This mirrors exactly how the printed questionnaire lays
sections out (see questionnaireHtml() in
vue-app/src/views/AnswerKeyView.vue: section I top to bottom, then II,
then III, then IV) -- the sheet a student writes on and the answer key
were generated from the same ordering, so global position is a
reliable key. Each matched item's own question_type column (not
anything from the model) then decides which grading function applies.

Trade-off worth knowing: since there's no per-type detection boundary
anymore, a single missed or spurious detection anywhere on a page
misaligns every item that follows it for the rest of the exam, not
just within one question type the way a type-aware model would have
contained it. This was a deliberate choice to avoid re-annotating the
training set with per-type classes; if misalignment from missed
detections turns out to be a real problem in practice, the fix is
either restoring per-type classes on the model or reintroducing some
type-agnostic boundary check (e.g. section item counts from the answer
key) before this positional zip.

Multi-page submissions (V006's exam_sheet_page): a real exam can span
several photographed/scanned pages, only the first of which carries a
recognisable Name/Section header -- continuation pages are blank by
design (no QR code, no repeated header). Since the questionnaire is
always laid out in strictly increasing item_no order regardless of
where a page break happens to fall, pooling each page's detections
**in page order** (page 1's top-to-bottom list, then page 2's, then
page 3's...) before the same positional zip reconstructs exactly the
same global order as if every item were on one tall image. That is the
one thing that changed to support multiple pages -- no need to track
which items live on which page at all.

Enumeration is the one type needing an extra step: the answer key
stores several rows per group (enum_group), all sharing one prompt. The
group's blanks are consecutive in item_no order (see collectItems() in
AnswerKeyView.vue), so once the global positional zip has paired every
detection with its item, the ENUMERATION-typed pairs are pulled out (in
the same order) and chunked by each group's blank count, in group
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

import re
from collections.abc import Callable
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from app.inference import recognizer
from app.inference.detector import Detection, detect_regions
from app.inference.grading import (
    GradeVerdict,
    grade_exact,
    grade_fuzzy,
    grade_multiple_choice,
    best_item_similarity,
    match_enumeration_answers,
)

MODEL_NAME = "YOLOv26n-seg + TrOCR-custom"
LOW_CONFIDENCE_THRESHOLD = 0.5


CROP_PAD_PX = 6  # room around the outline so ascenders/descenders are not clipped
MASK_DILATE_PX = 3  # grow the outline slightly so strokes right on its edge survive


def _crop(image: Image.Image, bbox: tuple[int, int, int, int], polygon: tuple | None = None) -> Image.Image:
    """The recognizer (TrOCR) was fine-tuned on crops cut out along the
    segmentation outline, with everything outside it painted white (same pad
    and dilation as above). Feeding it the plain bounding rectangle instead
    pulls in the printed question text next to the blank, which it then reads
    as part of the answer ("Platform Layer A. The level of ..."). So when the
    detector supplied an outline, crop exactly the way it was trained; the
    rectangle is only the fallback."""
    if polygon:
        xs = [p[0] for p in polygon]
        ys = [p[1] for p in polygon]
        x1, y1 = max(0, int(min(xs)) - CROP_PAD_PX), max(0, int(min(ys)) - CROP_PAD_PX)
        x2, y2 = min(image.width, int(max(xs)) + CROP_PAD_PX), min(image.height, int(max(ys)) + CROP_PAD_PX)
        if x2 > x1 and y2 > y1:
            crop = image.crop((x1, y1, x2, y2)).convert("RGB")
            mask = Image.new("L", crop.size, 0)
            ImageDraw.Draw(mask).polygon([(x - x1, y - y1) for x, y in polygon], outline=255, fill=255)
            mask = mask.filter(ImageFilter.MaxFilter(2 * MASK_DILATE_PX + 1))
            return Image.composite(crop, Image.new("RGB", crop.size, (255, 255, 255)), mask)
    x1, y1, x2, y2 = bbox
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(image.width, x2), min(image.height, y2)
    return image.crop((x1, y1, x2, y2))


def _true_false_word(text: str) -> str:
    """A True/False blank holds exactly one word. The recognizer can read a stray extra word next to it
    (a fragment of the printed question, a mark) -- "True Java" would grade as wrong. When exactly one of
    True / False is among the words read, that is the answer; any other reading is left as it is."""
    found = {w.lower() for w in re.split(r"[^A-Za-z]+", text) if w.lower() in ("true", "false")}
    if len(found) != 1:
        return text
    return next(w for w in re.split(r"[^A-Za-z]+", text) if w.lower() in found)


def _maybe_flag_low_confidence(verdict: GradeVerdict, confidence: float) -> GradeVerdict:
    if verdict.status == "correct" or confidence >= LOW_CONFIDENCE_THRESHOLD:
        return verdict
    return GradeVerdict(
        "flagged",
        0.0,
        verdict.match_score,
        f"Recognition confidence {confidence:.0%} is low; needs review. {verdict.remarks or ''}".strip(),
    )


class PipelineCancelled(Exception):
    """run_sheet_group's should_stop callback reported that nobody wants
    this submission's result any more."""


def run_sheet_group(
    image_paths: list[str],
    items: list,
    crop_dir: Path,
    sheet_code: str,
    should_stop: Callable[[], bool] | None = None,
    on_progress: Callable[[float, str], None] | None = None,
) -> dict:
    """
    image_paths: this submission's page images, in page order (page 1
    first -- the only one expected to carry the Name/Section header).
    items: AnswerKeyItem ORM rows for this sheet's answer key.
    should_stop: polled before every page detection and every crop
    recognition; when it returns True the run raises PipelineCancelled
    instead of finishing. On a CPU-only deployment a submission takes
    minutes (one recognition is ~9 s on a single core), so without this
    a cancelled submission kept the CPU busy long after the teacher
    clicked Cancel.
    Returns {
      "identity": {"name": str|None, "section": str|None},
      "answers": [{"item_id", "crop_path", "recognized_text", "confidence", "verdict"}],
    }
    """
    def check_stop() -> None:
        if should_stop is not None and should_stop():
            raise PipelineCancelled()

    # Pooled across every page, in page order -- see the module
    # docstring for why this keeps positional pairing correct across a
    # page break. Each entry carries its own source image since pages
    # are separate files, unlike the single-image case.
    all_dets: list[tuple[Image.Image, Detection]] = []
    # First page that has a given header field wins -- only page 1 is
    # expected to have one, but nothing here assumes that.
    identity_boxes: dict[str, tuple[Image.Image, Detection]] = {}

    for page_index, image_path in enumerate(image_paths):
        check_stop()
        image = Image.open(image_path)
        detections = detect_regions(image_path)

        page_dets: list[Detection] = []
        for det in detections:
            if det.field_name:
                identity_boxes.setdefault(det.field_name, (image, det))
            else:
                page_dets.append(det)
        page_dets.sort(key=lambda d: d.y_center)
        all_dets.extend((image, det) for det in page_dets)
        if on_progress:
            on_progress(0.05 + 0.15 * (page_index + 1) / len(image_paths), f'Detected page {page_index + 1} of {len(image_paths)}')

    sorted_items = sorted(items, key=lambda i: i.item_no)

    crop_dir.mkdir(parents=True, exist_ok=True)
    answers: list[dict] = []
    recognition_total = min(len(all_dets), len(items)) + sum(field in identity_boxes for field in ('name', 'section'))
    recognition_done = 0

    def recognize_and_save(image: Image.Image, det: Detection, item_id: int, suffix: str) -> tuple[str, float, str]:
        nonlocal recognition_done
        check_stop()
        crop_img = _crop(image, det.bbox, det.polygon)
        crop_path = crop_dir / f"{sheet_code}_item{item_id}_{suffix}.png"
        crop_img.save(crop_path)  # saved as-is so the teacher can see any crossed-out writing
        # Do not alter handwritten pixels before recognition. The former
        # automatic scribble-removal pass occasionally treated ordinary
        # handwriting as a correction and replaced a readable name with an
        # unrelated, higher-confidence word (for example, "DeepQA"). A
        # crossed-out or ambiguous answer remains visible for the teacher to
        # review instead of being changed by an unreliable preprocessor.
        text, confidence = recognizer.recognize_text(crop_img)
        recognition_done += 1
        if on_progress:
            on_progress(0.20 + 0.75 * recognition_done / max(1, recognition_total), f'Recognized region {recognition_done} of {recognition_total}')
        return text, confidence, str(crop_path)

    # ---- Global positional pairing: one detection per item, in exam order ----
    # `paired` is naturally shorter than `sorted_items` if fewer regions
    # were detected than the answer key expects -- see the module
    # docstring for why a shortfall anywhere pushes every later item
    # out of alignment rather than just the items in its own section.
    paired = list(zip(all_dets, sorted_items))
    missing_items = sorted_items[len(paired) :]

    for (image, det), item in paired:
        qtype = item.question_type
        if qtype == "ENUMERATION":
            continue  # handled as a group below, not one at a time
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
            text = _true_false_word(text)
            verdict = grade_exact(text, item.correct_answer, item.alternative_answers, float(item.points))
        verdict = _maybe_flag_low_confidence(verdict, confidence)
        answers.append(
            {"item_id": item.item_id, "crop_path": crop_path, "recognized_text": text, "confidence": confidence, "verdict": verdict}
        )

    # Items with no matching detection at all -- flagged, nothing to grade.
    for item in missing_items:
        if item.question_type == "ENUMERATION":
            continue  # handled as a group below, not one at a time
        answers.append(
            {
                "item_id": item.item_id,
                "crop_path": None,
                "recognized_text": None,
                "confidence": 0.0,
                "verdict": GradeVerdict("flagged", 0.0, 0.0, "No answer region detected for this item."),
            }
        )

    # ---- Enumeration: chunk the already-paired detections by each group's blank count, then set-match ----
    enum_det_pairs = [det_pair for det_pair, item in paired if item.question_type == "ENUMERATION"]
    groups: dict[int, list] = {}
    for item in sorted_items:
        if item.question_type == "ENUMERATION":
            groups.setdefault(item.enum_group, []).append(item)

    cursor = 0
    for group_no in sorted(groups.keys()):
        group_items = groups[group_no]
        group_dets = enum_det_pairs[cursor : cursor + len(group_items)]
        cursor += len(group_items)

        recognized_texts, crop_paths, confidences = [], [], []
        for (image, det), item in zip(group_dets, group_items):
            text, confidence, crop_path = recognize_and_save(image, det, item.item_id, "a")
            recognized_texts.append(text)
            crop_paths.append(crop_path)
            confidences.append(confidence)

        match_result = match_enumeration_answers(group_items, recognized_texts)
        slot_by_item_id = {slot.item_id: slot for slot in match_result["per_slot"]}

        # Answers the student wrote that matched no key entry. They were
        # detected and read fine -- they just are not (close enough to) any
        # correct answer -- but leaving them out of the results made the
        # unmatched rows look like nothing was detected and hid what the
        # student actually wrote. Show each one next to the unmatched slot it
        # is closest to. It is an incorrect answer when below that slot's
        # threshold; only a missing region remains flagged for review.
        used_detected = {s.detected_index for s in match_result["per_slot"] if s.matched}
        leftovers = [i for i, t in enumerate(recognized_texts) if i not in used_detected and (t or "").strip()]
        candidates = sorted(
            (
                (best_item_similarity(item, recognized_texts[i]), item.item_id, i)
                for item in group_items
                if not slot_by_item_id[item.item_id].matched
                for i in leftovers
            ),
            reverse=True,
        )
        shown_for_slot: dict[int, tuple[int, float]] = {}
        taken: set[int] = set()
        for score, item_id, i in candidates:
            if item_id not in shown_for_slot and i not in taken:
                shown_for_slot[item_id] = (i, score)
                taken.add(i)

        for item in group_items:
            slot = slot_by_item_id[item.item_id]
            # Matching is set-based -- a student's answers don't need to be
            # written in the same order as the answer key, that's the whole
            # point of match_enumeration_answers(). So the detection that
            # earns THIS slot's score is slot.detected_index, which is often
            # NOT this item's own positional index into recognized_texts/
            # crop_paths/confidences. Showing the positional entry instead
            # (the previous behavior) could display a "correct" row next to
            # an unrelated answer, or a "flagged" row next to text that
            # actually belongs to a different slot entirely.
            if slot.matched:
                if slot.is_exact:
                    verdict = GradeVerdict("correct", slot.earned, slot.match_score)
                else:
                    threshold = float(item.fuzzy_threshold or 85)
                    verdict = GradeVerdict(
                        "flagged",
                        0.0,
                        slot.match_score,
                        f'Recognized "{slot.matched_answer}" is a {slot.match_score:.0f}% match for '
                        f'"{item.correct_answer}". It meets the {threshold:.0f}% review threshold but is not exact.',
                    )
                answers.append(
                    {
                        "item_id": item.item_id,
                        "crop_path": crop_paths[slot.detected_index],
                        "recognized_text": slot.matched_answer,
                        "confidence": confidences[slot.detected_index],
                        "verdict": verdict,
                    }
                )
            elif item.item_id in shown_for_slot:
                i, score = shown_for_slot[item.item_id]
                threshold = float(item.fuzzy_threshold or 85)
                answers.append(
                    {
                        "item_id": item.item_id,
                        "crop_path": crop_paths[i],
                        "recognized_text": recognized_texts[i],
                        "confidence": confidences[i],
                        "verdict": GradeVerdict(
                            "incorrect",
                            0.0,
                            score,
                            f'Recognized "{recognized_texts[i]}"; the closest answer-key entry for this slot is '
                            f'"{item.correct_answer}" ({score:.0f}% match, below the {threshold:.0f}% threshold).',
                        ),
                    }
                )
            else:
                # Nothing left over to show for this slot (fewer answers were
                # detected/written than the key expects).
                answers.append(
                    {
                        "item_id": item.item_id,
                        "crop_path": None,
                        "recognized_text": None,
                        "confidence": 0.0,
                        "verdict": GradeVerdict(
                            "flagged", 0.0, slot.match_score, "No matching answer found within this enumeration group."
                        ),
                    }
                )

    # ---- Header fields (best-effort; not graded, just recognized) ----
    identity: dict[str, str] = {}
    for field_name in ("name", "section"):
        found = identity_boxes.get(field_name)
        if found:
            image, det = found
            text, _confidence, _crop_path = recognize_and_save(image, det, 0, field_name)
            identity[field_name] = text

    if on_progress:
        on_progress(0.95, 'Recognition and answer matching finished')
    return {"identity": identity, "answers": answers}
