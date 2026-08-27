"""Session endpoints, including the sheet-upload transaction.
See INTEGRATION_CONTRACT.md sections 4 "Sessions and processing" and 5
"Grading one sheet -- all or nothing".
"""

import asyncio
import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.inference import pipeline as inference_pipeline
from app.models import (
    AnswerKey,
    AnswerKeyItem,
    ExamSheet,
    Faculty,
    GradingResult,
    GradingSession,
    StudentAnswer,
    StudentInfo,
    VSessionSummary,
)
from app.schemas import CreateSessionRequest, UpdateSessionStatusRequest
from app.security import get_current_faculty
from app.utils import SESSION_STATUS_TO_CODE, SESSION_STATUS_TO_LABEL, make_sheet_code

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _session_shape(row: VSessionSummary) -> dict:
    return {
        "id": row.session_id,
        "answer_key_id": row.answer_key_id,
        "answer_key_name": row.answer_key_name,
        "name": row.session_name,
        "folder": row.source_folder,
        "status": SESSION_STATUS_TO_LABEL.get(row.status, row.status),
        "total_sheets": row.queued_sheets,
        "graded_sheets": row.graded_sheets,
        "flagged_items": row.flagged_items,
        "average_percentage": float(row.average_percentage) if row.average_percentage is not None else 0,
        "created_at": row.started_at,
        "finished_at": row.finished_at,
    }


def _owned_session(session_id: int, faculty: Faculty, db: Session) -> GradingSession:
    gs = db.scalar(
        select(GradingSession).where(
            GradingSession.session_id == session_id, GradingSession.faculty_id == faculty.faculty_id
        )
    )
    if not gs:
        raise HTTPException(status_code=404, detail="Session not found.")
    return gs


@router.get("")
def list_sessions(faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(VSessionSummary)
        .where(VSessionSummary.faculty_id == faculty.faculty_id)
        .order_by(VSessionSummary.session_id.desc())
    )
    return [_session_shape(r) for r in rows]


@router.post("", status_code=201)
def create_session(
    body: CreateSessionRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    key = db.scalar(
        select(AnswerKey).where(
            AnswerKey.answer_key_id == body.answer_key_id, AnswerKey.faculty_id == faculty.faculty_id
        )
    )
    if not key:
        raise HTTPException(status_code=404, detail="Answer key not found.")

    gs = GradingSession(
        faculty_id=faculty.faculty_id,
        answer_key_id=key.answer_key_id,
        session_name=body.session_name or f"Session {datetime.datetime.utcnow():%Y-%m-%d %H:%M:%S}",
        source_folder=body.folder,
        status="processing",
        total_sheets=body.total_sheets,
        started_at=datetime.datetime.utcnow(),
    )
    db.add(gs)
    db.commit()
    db.refresh(gs)
    return {"id": gs.session_id}


@router.patch("/{session_id}")
def update_session_status(
    session_id: int,
    body: UpdateSessionStatusRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    gs = _owned_session(session_id, faculty, db)
    gs.status = SESSION_STATUS_TO_CODE.get(body.status, body.status.lower())
    if gs.status in ("completed", "cancelled", "failed"):
        gs.finished_at = datetime.datetime.utcnow()
    db.add(gs)
    db.commit()
    return {"ok": True}


@router.delete("/{session_id}", status_code=204)
def clear_session(session_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    gs = _owned_session(session_id, faculty, db)
    db.delete(gs)  # sheets, answers, results cascade (fk_sheet_session ON DELETE CASCADE)
    db.commit()


@router.post("/{session_id}/sheets", status_code=201)
async def upload_sheets(
    session_id: int,
    files: list[UploadFile],
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    """One transaction PER SHEET, per INTEGRATION_CONTRACT.md section 5:
    a crash halfway must leave no trace of that sheet rather than a
    half-graded one. Detection/recognition/grading runs through
    app.inference.pipeline (YOLOv11-seg + TrOCR) -- see that module's
    docstring for how detected regions are matched to specific
    answer_key_item rows. A per-sheet model failure marks that one
    sheet 'error' and moves on rather than failing the whole batch.
    """
    gs = _owned_session(session_id, faculty, db)
    items = db.scalars(
        select(AnswerKeyItem).where(AnswerKeyItem.answer_key_id == gs.answer_key_id).order_by(AnswerKeyItem.item_no)
    ).all()
    if not items:
        raise HTTPException(status_code=400, detail="This session's answer key has no items yet.")

    sheets_so_far = db.query(ExamSheet).filter(ExamSheet.session_id == session_id).count()
    next_seq = sheets_so_far + 1
    crop_dir = settings.crop_dir / f"session_{session_id}"

    created_ids = []
    for offset, upload in enumerate(files):
        seq = next_seq + offset
        raw = await upload.read()
        saved_path = settings.upload_dir / f"session_{session_id}" / (upload.filename or f"sheet_{seq}.jpg")
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(raw)

        sheet_code = make_sheet_code(session_id, seq)
        sheet = ExamSheet(
            session_id=session_id,
            answer_key_id=gs.answer_key_id,  # from the session, never from the client
            sheet_code=sheet_code,
            original_filename=upload.filename,
            image_path=str(saved_path.relative_to(settings.upload_dir.parent)),
            upload_date=datetime.datetime.utcnow(),
            processing_status="preprocessing",
        )
        db.add(sheet)
        db.flush()  # need sheet.sheet_id

        try:
            # Detection + recognition is CPU/GPU-bound and synchronous --
            # run it off the event loop so one sheet's model calls don't
            # stall every other request this server is handling.
            result = await asyncio.to_thread(
                inference_pipeline.run_sheet, str(saved_path), items, crop_dir, sheet_code
            )
        except Exception as exc:  # noqa: BLE001 -- a model failure must not corrupt the batch
            sheet.processing_status = "error"
            sheet.error_message = str(exc)[:255]
            db.add(sheet)
            db.commit()
            created_ids.append(sheet.sheet_id)
            continue

        identity = result["identity"]
        db.add(
            StudentInfo(
                sheet_id=sheet.sheet_id,
                name=identity.get("name"),
                section=identity.get("section"),
                consent_status="consented",
            )
        )

        for answer_data in result["answers"]:
            verdict = answer_data["verdict"]
            answer = StudentAnswer(
                sheet_id=sheet.sheet_id,
                item_id=answer_data["item_id"],
                crop_path=answer_data["crop_path"],
                recognized_text=answer_data["recognized_text"],
                htr_confidence=answer_data["confidence"],
                model_used=inference_pipeline.MODEL_NAME,
                recognized_at=datetime.datetime.utcnow(),
            )
            db.add(answer)
            db.flush()  # need answer.student_answer_id

            db.add(
                GradingResult(
                    sheet_id=sheet.sheet_id,
                    item_id=answer_data["item_id"],
                    recognized_id=answer.student_answer_id,
                    score=verdict.score,
                    auto_score=verdict.score,
                    status=verdict.status,
                    auto_status=verdict.status,
                    match_score=verdict.match_score,
                    remarks=verdict.remarks,
                    graded_at=datetime.datetime.utcnow(),
                )
            )

        sheet.processing_status = "completed"
        gs.processed_sheets += 1
        created_ids.append(sheet.sheet_id)
        db.commit()  # this sheet's transaction ends here -- next sheet is independent

    return {"sheet_ids": created_ids}
