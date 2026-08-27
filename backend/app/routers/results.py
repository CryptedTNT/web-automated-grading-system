"""Results and review endpoints. See INTEGRATION_CONTRACT.md sections 4
"Results and review" and 5 "Saving a manual review -- two rows, one
commit".
"""

import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    AnswerKeyItem,
    Faculty,
    GradingResult,
    ManualReview,
    StudentAnswer,
    VFlaggedQueue,
    VResultItem,
    VSheetResult,
)
from app.schemas import ReviewRequest
from app.security import get_current_faculty

router = APIRouter(tags=["results"])


def _sheet_shape(row: VSheetResult) -> dict:
    return {
        "id": row.sheet_id,
        "session_id": row.session_id,
        "student_name": row.student_name,
        "section": row.section,
        "image_path": row.image_path,
        "score": float(row.score),
        "total": float(row.total),
        "percentage": float(row.percentage),
        "flagged_count": row.flagged_count,
        "status": row.status,
        "created_at": row.created_at,
    }


def _item_shape(row: VResultItem) -> dict:
    return {
        "id": row.result_id,
        "item_no": row.item_no,
        "type": row.question_type_label,
        "enum_group": row.enum_group,
        "student_answer": row.student_answer,
        "correct_answer": row.correct_answer,
        "alternatives": row.alternatives,
        "match_score": float(row.match_score) if row.match_score is not None else 0,
        "points": float(row.points),
        "earned": float(row.earned),
        "status": row.status,
        "auto_status": row.auto_status,
        "manual_override": row.manual_override,
        "override_action": row.override_action,
        "remarks": row.remarks,
        "model_used": row.model_used,
        "confidence": float(row.confidence) if row.confidence is not None else 0,
        "crop_path": row.crop_path,
    }


@router.get("/sessions/{session_id}/results")
def session_results(
    session_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)
):
    rows = db.scalars(
        select(VSheetResult).where(VSheetResult.session_id == session_id).order_by(VSheetResult.sheet_id)
    )
    return [_sheet_shape(r) for r in rows]


@router.get("/sheets/{sheet_id}")
def sheet_result(sheet_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    row = db.scalar(select(VSheetResult).where(VSheetResult.sheet_id == sheet_id))
    if not row:
        raise HTTPException(status_code=404, detail="Sheet not found.")
    return _sheet_shape(row)


@router.get("/sheets/{sheet_id}/items")
def sheet_items(sheet_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    rows = db.scalars(select(VResultItem).where(VResultItem.sheet_id == sheet_id).order_by(VResultItem.item_no))
    return [_item_shape(r) for r in rows]


@router.get("/sessions/{session_id}/next-flagged")
def next_flagged(
    session_id: int,
    prefer_result_id: int | None = None,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    query = select(VFlaggedQueue).where(VFlaggedQueue.session_id == session_id)
    if prefer_result_id is not None:
        # Stay on the sheet the teacher is already reviewing until it has
        # no flagged items left, then fall back to sweeping the session --
        # matches the old localStorage getFirstFlaggedItem(studentResultId, ...).
        query = query.order_by((VFlaggedQueue.sheet_id != prefer_result_id), VFlaggedQueue.sheet_id, VFlaggedQueue.item_no)
    else:
        query = query.order_by(VFlaggedQueue.sheet_id, VFlaggedQueue.item_no)
    row = db.scalar(query.limit(1))
    if not row:
        return None
    return {
        "id": row.result_id,
        "item_no": row.item_no,
        "type": row.question_type_label,
        "enum_group": row.enum_group,
        "student_answer": row.student_answer,
        "correct_answer": row.correct_answer,
        "alternatives": row.alternatives,
        "match_score": float(row.match_score) if row.match_score is not None else 0,
        "points": float(row.points),
        "student_result_id": row.sheet_id,
    }


@router.post("/results/{result_id}/review")
def review_result(
    result_id: int,
    body: ReviewRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    result = db.get(GradingResult, result_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not found.")
    item = db.get(AnswerKeyItem, result.item_id)

    original_answer = None
    if result.recognized_id:
        answer_row = db.get(StudentAnswer, result.recognized_id)
        original_answer = answer_row.recognized_text if answer_row else None

    if body.action == "accepted_correct":
        result.score, result.status = item.points, "correct"
    elif body.action == "marked_incorrect":
        result.score, result.status = 0, "incorrect"
    else:  # manual_answer_override
        result.score, result.status = item.points, "correct"
        result.match_score = 100
        if body.corrected_answer and result.recognized_id:
            answer_row = db.get(StudentAnswer, result.recognized_id)
            if answer_row:
                answer_row.recognized_text = body.corrected_answer
                db.add(answer_row)

    result.is_manual_override = 1
    # auto_status / auto_score are deliberately untouched here.
    db.add(result)

    review = db.scalar(select(ManualReview).where(ManualReview.result_id == result_id))
    if not review:
        review = ManualReview(result_id=result_id)
    review.reviewed_by = faculty.faculty_id
    review.override_action = body.action
    review.original_answer = original_answer
    review.corrected_answer = body.corrected_answer
    review.final_score = result.score
    review.review_status = "corrected" if body.corrected_answer else "reviewed"
    review.review_seconds = body.review_seconds
    review.reviewed_at = datetime.datetime.utcnow()
    db.add(review)

    db.commit()
    return {"ok": True}
