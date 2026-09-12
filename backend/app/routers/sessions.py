"""Session endpoints, including the sheet-upload transaction.
See INTEGRATION_CONTRACT.md sections 4 "Sessions and processing" and 5
"Grading one sheet -- all or nothing".
"""

import asyncio
import datetime
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.inference import pipeline as inference_pipeline
from app.models import (
    AnswerKey,
    AnswerKeyItem,
    ExamSheet,
    ExamSheetPage,
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


def _safe_filename(name: str | None, fallback: str = "sheet.jpg") -> str:
    """Strips any directory components from a client-supplied filename
    before it's used to build a save path. `upload.filename` is just
    multipart metadata the client sets -- a browser file picker won't
    put slashes in it, but nothing stops a raw HTTP client from sending
    a filename like `../../../../etc/cron.d/evil`, which pathlib's `/`
    operator would otherwise happily fold into the path (each `/` in
    the string becomes a new path segment when it's joined below)."""
    candidate = PurePosixPath(str(name or "").replace("\\", "/")).name
    return candidate if candidate and candidate not in (".", "..") else fallback


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
    files: list[UploadFile] = File(...),
    consent_confirmed: bool = Form(False),
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    """One transaction PER SUBMISSION (V006), per INTEGRATION_CONTRACT.md
    section 5's "all or nothing": a crash halfway must leave no trace of
    that submission rather than a half-graded one. `files` is every page
    of ONE student's submission, in page order -- page 1 is the only one
    expected to carry a recognisable Name/Section header, since
    continuation pages are blank by design. The frontend calls this
    endpoint once per student (see api.js's uploadSheetGroup), not once
    per raw image.

    `consent_confirmed` is the teacher's own attestation (a checkbox on
    the Upload page, required before the queue can be submitted) that
    consent for every student in this batch was already collected on
    paper -- see SettingsView.vue's consent form and TermsView.vue
    section 3. It is what student_info.consent_status actually records;
    it used to be hardcoded to "consented" unconditionally, which made
    the column meaningless as an audit trail.

    Detection/recognition/grading runs through app.inference.pipeline's
    run_sheet_group (YOLOv11-seg + TrOCR) -- see that module's docstring
    for how each page's detections are pooled in page order before being
    matched to specific answer_key_item rows. A model failure marks
    every page of this submission 'error' and moves on rather than
    failing the whole batch of students.
    """
    gs = _owned_session(session_id, faculty, db)
    items = db.scalars(
        select(AnswerKeyItem).where(AnswerKeyItem.answer_key_id == gs.answer_key_id).order_by(AnswerKeyItem.item_no)
    ).all()
    if not items:
        raise HTTPException(status_code=400, detail="This session's answer key has no items yet.")
    if not files:
        raise HTTPException(status_code=400, detail="No pages were uploaded.")

    sheets_so_far = db.query(ExamSheet).filter(ExamSheet.session_id == session_id).count()
    seq = sheets_so_far + 1
    crop_dir = settings.crop_dir / f"session_{session_id}"
    sheet_code = make_sheet_code(session_id, seq)
    now = datetime.datetime.utcnow()

    sheet = ExamSheet(
        session_id=session_id,
        answer_key_id=gs.answer_key_id,  # from the session, never from the client
        sheet_code=sheet_code,
        upload_date=now,
    )
    db.add(sheet)
    db.flush()  # need sheet.sheet_id

    saved_paths: list[str] = []
    pages: list[ExamSheetPage] = []
    for page_no, upload in enumerate(files, start=1):
        raw = await upload.read()
        safe_name = _safe_filename(upload.filename)
        saved_path = settings.upload_dir / f"session_{session_id}" / f"{sheet_code}_p{page_no}_{safe_name}"
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(raw)
        saved_paths.append(str(saved_path))

        page = ExamSheetPage(
            sheet_id=sheet.sheet_id,
            page_no=page_no,
            original_filename=upload.filename,
            image_path=str(saved_path.relative_to(settings.upload_dir.parent)),
            processing_status="preprocessing",
            uploaded_at=now,
        )
        db.add(page)
        pages.append(page)
    db.commit()

    try:
        # Detection + recognition is CPU/GPU-bound and synchronous --
        # run it off the event loop so one submission's model calls
        # don't stall every other request this server is handling.
        result = await asyncio.to_thread(
            inference_pipeline.run_sheet_group, saved_paths, items, crop_dir, sheet_code
        )
    except Exception as exc:  # noqa: BLE001 -- a model failure must not corrupt the batch
        for page in pages:
            page.processing_status = "error"
            page.error_message = str(exc)[:255]
            db.add(page)
        db.commit()
        return {"sheet_ids": [sheet.sheet_id]}

    identity = result["identity"]
    db.add(
        StudentInfo(
            sheet_id=sheet.sheet_id,
            name=identity.get("name"),
            section=identity.get("section"),
            consent_status="consented" if consent_confirmed else "not_consented",
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

    for page in pages:
        page.processing_status = "completed"
        db.add(page)
    gs.processed_sheets += 1
    db.commit()  # this submission's transaction ends here -- the next one is independent

    return {"sheet_ids": [sheet.sheet_id]}
