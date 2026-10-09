"""Session endpoints, including the sheet-upload transaction.
See INTEGRATION_CONTRACT.md sections 4 "Sessions and processing" and 5
"Grading one sheet -- all or nothing".
"""

import asyncio
import datetime
import logging
import shutil
from pathlib import Path, PurePosixPath
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.grading_progress import report_progress, read_progress
from app.image_formats import ImageFormatError, SUPPORTED_IMAGE_EXTENSIONS, heif_to_jpeg, is_heif_filename
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
from app.roster import find_duplicate_sheet, resolve_identity
from app.sections import canonical_section
from app.utils import SESSION_STATUS_TO_CODE, SESSION_STATUS_TO_LABEL, make_sheet_code

router = APIRouter(prefix="/sessions", tags=["sessions"])

# uvicorn's own logger, so these lines show up in `journalctl -u ags-backend`
# without any extra logging configuration (an app-named logger would be
# dropped: nothing configures handlers or a level for it).
logger = logging.getLogger("uvicorn.error")

# Sessions the teacher cancelled. The Processing page's Cancel button aborts
# its in-flight upload and then PATCHes the session to 'Cancelled'; recording
# that here is what lets a submission that is ALREADY being graded stop at
# its next checkpoint (see pipeline.run_sheet_group's should_stop) instead of
# grinding on for minutes on a CPU-only server. In memory is enough: the
# deployment is a single uvicorn process, and a cancelled session is never
# resumed (Restart Processing always creates a new session).
#
# Deliberately NOT keyed off the HTTP connection closing: Azure's public IP
# drops idle connections after 4 minutes by default, and a submission can
# legitimately take longer than that -- a dropped connection must not throw
# away a sheet that is about to finish.
_cancelled_sessions: set[int] = set()

# Sessions with an upload request being handled right now (saving its pages
# or grading them), as a count per session id. A session must not be deleted
# out from under that work, so clear_session() refuses while this is non-empty
# for its id.
_uploads_in_flight: dict[int, int] = {}

# A phone photo or flatbed scan of one page is a few MB at most; this is
# generous headroom above that. Uploads have no size limit otherwise --
# nothing between the browser and this handler (no reverse proxy in the
# thesis deployment) caps request body size, so without this a signed-in
# account could fill the server's disk with a handful of huge requests.
MAX_PAGE_BYTES = 20 * 1024 * 1024


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
        "failed_sheets": row.failed_sheets,
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


def _remove_session_files(session_id: int) -> None:
    """Removes every uploaded page and crop belonging to one discarded run."""
    for root in (settings.upload_dir, settings.crop_dir):
        shutil.rmtree(root / f"session_{session_id}", ignore_errors=True)


def _remove_sheet_files(session_id: int, sheet_code: str) -> None:
    """Removes one submission's page photos and answer crops, leaving the
    rest of the session (and its other students' files) untouched -- unlike
    _remove_session_files, which discards the whole run's folder."""
    for page in (settings.upload_dir / f"session_{session_id}").glob(f"{sheet_code}_p*"):
        page.unlink(missing_ok=True)
    for crop in (settings.crop_dir / f"session_{session_id}").glob(f"{sheet_code}_item*"):
        crop.unlink(missing_ok=True)


def _discard_cancelled_session_if_idle(session_id: int, db: Session) -> bool:
    """Deletes a cancelled run once no upload handler can still be using it.

    Cancelling means the teacher does not want a grading session at all. A
    completed earlier submission must not leave a partial run in Reports or
    consume a visible session number. The active upload is allowed to reach
    its cancellation checkpoint first; its ``finally`` block calls this
    helper after the in-flight counter reaches zero.
    """
    if _uploads_in_flight.get(session_id, 0):
        return False
    # populate_existing=True: this `db` is the SAME Session object that
    # loaded this row earlier in the request (_owned_session, above), before
    # the PATCH that set status='cancelled' committed on a DIFFERENT request's
    # Session. Without it, db.get() returns that stale cached object -- its
    # .status still reads whatever it was when THIS request first loaded it,
    # so this always fell through here without ever discarding: verified by
    # a real cancel-after-partial-success run that graded one sheet, patched
    # the session to Cancelled while a second sheet was mid-grading, and
    # confirmed the row and its files were still on disk afterward.
    session = db.get(GradingSession, session_id, populate_existing=True)
    if not session or session.status != "cancelled":
        return False
    db.delete(session)  # sheets, answers and grading rows cascade
    db.commit()
    _cancelled_sessions.discard(session_id)
    _remove_session_files(session_id)
    logger.info("Cancelled session %s discarded with its partial results", session_id)
    return True


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
        .where(
            VSessionSummary.faculty_id == faculty.faculty_id,
            VSessionSummary.status != "cancelled",
        )
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
    if gs.status == "cancelled":
        _cancelled_sessions.add(session_id)
    db.add(gs)
    db.commit()
    discarded = _discard_cancelled_session_if_idle(session_id, db) if gs.status == "cancelled" else False
    return {"ok": True, "discarded": discarded}


@router.delete("/{session_id}", status_code=204)
def clear_session(session_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    gs = _owned_session(session_id, faculty, db)
    if _uploads_in_flight.get(session_id):
        raise HTTPException(
            status_code=409,
            detail="This session is still grading a submission. Cancel it on the Processing page, "
            "wait a few seconds for it to stop, then delete it.",
        )
    db.delete(gs)  # sheets, answers, results cascade (fk_sheet_session ON DELETE CASCADE)
    db.commit()
    _cancelled_sessions.discard(session_id)
    # The database cascade does not cover page photos and answer crops.
    _remove_session_files(session_id)


@router.get("/{session_id}/progress/{progress_token}")
def submission_progress(
    session_id: int, progress_token: UUID,
    faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db),
):
    _owned_session(session_id, faculty, db)
    return read_progress(session_id, progress_token)


@router.post("/{session_id}/sheets", status_code=201)
async def upload_sheets(
    session_id: int,
    files: list[UploadFile] = File(...),
    consent_confirmed: bool = Form(False),
    progress_token: UUID | None = Form(None),
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    """Grades one student's submission -- see _grade_submission."""
    _uploads_in_flight[session_id] = _uploads_in_flight.get(session_id, 0) + 1
    try:
        _owned_session(session_id, faculty, db)
        notify = lambda fraction, stage: report_progress(session_id, progress_token, fraction, stage)
        notify(0.01, 'Preparing pages')
        result = await _grade_submission(session_id, files, consent_confirmed, faculty, db, notify)
        notify(1, 'Cancelled' if result.get('cancelled') else 'Submission finished')
        return result
    finally:
        remaining = _uploads_in_flight.get(session_id, 1) - 1
        if remaining > 0:
            _uploads_in_flight[session_id] = remaining
        else:
            _uploads_in_flight.pop(session_id, None)
            _discard_cancelled_session_if_idle(session_id, db)


async def _grade_submission(
    session_id: int,
    files: list[UploadFile],
    consent_confirmed: bool,
    faculty: Faculty,
    db: Session,
    on_progress=None,
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
    run_sheet_group (YOLOv26n-seg + TrOCR) -- see that module's docstring
    for how each page's detections are pooled in page order before being
    matched to specific answer_key_item rows. A model failure marks
    every page of this submission 'error' and moves on rather than
    failing the whole batch of students.
    """
    gs = _owned_session(session_id, faculty, db)
    if session_id in _cancelled_sessions:
        raise HTTPException(status_code=409, detail="This session was cancelled.")
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
        if len(raw) > MAX_PAGE_BYTES:
            # Nothing has been committed yet (the sheet row above is only
            # flushed, not committed) -- roll back the transaction and
            # remove any earlier pages of THIS submission already written
            # to disk, so a rejected upload leaves no partial trace.
            db.rollback()
            for saved in saved_paths:
                Path(saved).unlink(missing_ok=True)
            raise HTTPException(
                status_code=413,
                detail=f"Page {page_no} is larger than the {MAX_PAGE_BYTES // (1024 * 1024)}MB limit per image.",
            )
        safe_name = _safe_filename(upload.filename)
        suffix = Path(safe_name).suffix.lower()
        if suffix not in SUPPORTED_IMAGE_EXTENSIONS:
            db.rollback()
            for saved in saved_paths:
                Path(saved).unlink(missing_ok=True)
            allowed = "JPG, JPEG, PNG, BMP, TIF, TIFF, HEIC, or HEIF"
            raise HTTPException(status_code=415, detail=f"Page {page_no} must be a {allowed} image.")

        stored_name = safe_name
        if is_heif_filename(safe_name):
            try:
                raw = heif_to_jpeg(raw)
            except ImageFormatError as exc:
                db.rollback()
                for saved in saved_paths:
                    Path(saved).unlink(missing_ok=True)
                raise HTTPException(status_code=415, detail=f"Page {page_no}: {exc}") from exc
            # YOLO/OpenCV gets the converted JPEG, while original_filename
            # below retains the teacher's HEIC filename for the audit trail.
            stored_name = f"{Path(safe_name).stem or 'sheet'}.jpg"

        saved_path = settings.upload_dir / f"session_{session_id}" / f"{sheet_code}_p{page_no}_{stored_name}"
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
        if on_progress:
            on_progress(0.05 * page_no / len(files), f'Prepared page {page_no} of {len(files)}')
    db.commit()

    try:
        # Detection + recognition is CPU/GPU-bound and synchronous --
        # run it off the event loop so one submission's model calls
        # don't stall every other request this server is handling.
        result = await asyncio.to_thread(
            inference_pipeline.run_sheet_group,
            saved_paths,
            items,
            crop_dir,
            sheet_code,
            lambda: session_id in _cancelled_sessions,
            on_progress,
        )
    except inference_pipeline.PipelineCancelled:
        # The teacher cancelled while this submission was being graded --
        # none of it should survive: not the sheet/page rows (committed
        # above, before grading started), the saved page images, or any
        # crops written so far.
        db.delete(sheet)  # pages cascade (fk_page_sheet ON DELETE CASCADE)
        db.commit()
        for saved in saved_paths:
            Path(saved).unlink(missing_ok=True)
        for crop in crop_dir.glob(f"{sheet_code}_item*"):
            crop.unlink(missing_ok=True)
        logger.info("Session %s cancelled: discarded in-progress submission %s", session_id, sheet_code)
        return {"cancelled": True}
    except Exception as exc:  # noqa: BLE001 -- a model failure must not corrupt the batch
        for page in pages:
            page.processing_status = "error"
            page.error_message = str(exc)[:255]
            db.add(page)
        db.commit()
        # This sheet produced no StudentInfo/GradingResult rows at all, so
        # reporting HTTP 200 here (as before) told the frontend the upload
        # "succeeded" -- the per-group failedCount in processing.js only
        # increments inside its catch block, which never ran, so a session
        # where every sheet failed this way was still marked Completed
        # instead of Failed, and the sheet surfaced in Results as a blank
        # "Unknown, 0/0, Status OK" row instead of a visible error.
        logger.error("Grading failed for sheet %s in session %s: %s", sheet_code, session_id, exc)
        raise HTTPException(
            status_code=502,
            detail=f"Grading failed for this submission: {exc}"[:500],
        ) from exc

    if on_progress:
        on_progress(0.97, 'Saving grades')
    identity = result["identity"]
    roster = resolve_identity(db, gs.faculty_id, identity.get("name"), identity.get("section"))
    # Same questionnaire, same apparent student, a different sheet already
    # on file -- very likely a re-upload rather than a second, real attempt.
    # This only flags it for the teacher; it never blocks or merges anything.
    duplicate_of_sheet_id = find_duplicate_sheet(
        db, gs.answer_key_id, roster["roster_id"], roster["name"], sheet.sheet_id
    )
    db.add(
        StudentInfo(
            sheet_id=sheet.sheet_id,
            name=roster["name"],
            detected_name=roster["detected_name"],
            section=roster["section"],
            section_id=roster["section_id"],
            roster_id=roster["roster_id"],
            roster_status=roster["roster_status"],
            roster_score=roster["roster_score"],
            duplicate_of_sheet_id=duplicate_of_sheet_id,
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
