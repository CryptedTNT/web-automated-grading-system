"""Class sections and student rosters. Every endpoint checks that the
section (or the student's section) belongs to the signed-in teacher.
"""

import asyncio
import datetime
import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.db import get_db
from app.image_formats import ImageFormatError, heif_to_jpeg, is_heif_filename
from app.inference import recognizer
from app.models import AnswerKey, ClassSection, Faculty, GradingSession, RosterStudent, StudentInfo, VSheetResult
from app.roster import backfill_roster_links, name_dedupe_key
from app.roster_import import RosterImportError, extract_names_from_excel, extract_names_from_image
from app.schemas import RosterStudentIn, SectionIn
from app.security import get_current_faculty
from app.sections import canonical_section

router = APIRouter(tags=["rosters"])

MAX_IMPORT_BYTES = 20 * 1024 * 1024
EXCEL_EXTENSIONS = (".xlsx",)


def _owned_section(section_id: int, faculty: Faculty, db: Session) -> ClassSection:
    section = db.scalar(
        select(ClassSection).where(
            ClassSection.section_id == section_id, ClassSection.faculty_id == faculty.faculty_id
        )
    )
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found.")
    return section


def _owned_student(roster_id: int, faculty: Faculty, db: Session) -> RosterStudent:
    student = db.scalar(
        select(RosterStudent)
        .join(ClassSection, ClassSection.section_id == RosterStudent.section_id)
        .where(RosterStudent.roster_id == roster_id, ClassSection.faculty_id == faculty.faculty_id)
    )
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")
    return student


def _student_shape(student: RosterStudent) -> dict:
    return {"roster_id": student.roster_id, "full_name": student.full_name, "position": student.position}


def _section_name_taken(faculty: Faculty, name: str, db: Session, exclude_id: int | None = None) -> bool:
    query = select(ClassSection.section_id).where(
        ClassSection.faculty_id == faculty.faculty_id, ClassSection.section_name == name
    )
    if exclude_id is not None:
        query = query.where(ClassSection.section_id != exclude_id)
    return db.scalar(query) is not None


def _name_taken(section_id: int, full_name: str, db: Session, exclude_id: int | None = None) -> bool:
    key = name_dedupe_key(full_name)
    rows = db.execute(
        select(RosterStudent.roster_id, RosterStudent.full_name).where(RosterStudent.section_id == section_id)
    )
    return any(name_dedupe_key(name) == key and roster_id != exclude_id for roster_id, name in rows)


def _append_students(section_id: int, names: list[str], db: Session) -> tuple[list[str], list[str]]:
    """Adds names in the given order, skipping any already on the list."""
    existing = {
        name_dedupe_key(name)
        for name in db.scalars(select(RosterStudent.full_name).where(RosterStudent.section_id == section_id))
    }
    next_position = (
        db.scalar(select(func.max(RosterStudent.position)).where(RosterStudent.section_id == section_id)) or 0
    )
    now = datetime.datetime.utcnow()
    added, skipped = [], []
    for raw in names:
        full_name = " ".join(raw.split())[:150]
        if not full_name:
            continue
        key = name_dedupe_key(full_name)
        if key in existing:
            skipped.append(full_name)
            continue
        existing.add(key)
        next_position += 1
        db.add(RosterStudent(section_id=section_id, full_name=full_name, position=next_position, created_at=now))
        added.append(full_name)
    db.flush()
    return added, skipped


@router.get("/sections")
def list_sections(faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    rows = db.execute(
        select(ClassSection.section_id, ClassSection.section_name, func.count(RosterStudent.roster_id))
        .outerjoin(RosterStudent, RosterStudent.section_id == ClassSection.section_id)
        .where(ClassSection.faculty_id == faculty.faculty_id)
        .group_by(ClassSection.section_id, ClassSection.section_name)
        .order_by(ClassSection.section_name)
    )
    return [{"section_id": sid, "name": name, "student_count": count} for sid, name, count in rows]


@router.post("/sections", status_code=201)
def create_section(body: SectionIn, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    name = canonical_section(body.name)
    if not name or len(name) > 50:
        raise HTTPException(status_code=422, detail="Enter a section name of up to 50 characters, such as BSCS 1-A.")
    if _section_name_taken(faculty, name, db):
        raise HTTPException(status_code=409, detail=f"{name} is already on your list of sections.")
    section = ClassSection(faculty_id=faculty.faculty_id, section_name=name, created_at=datetime.datetime.utcnow())
    db.add(section)
    db.commit()
    return {"section_id": section.section_id, "name": section.section_name, "student_count": 0}


@router.patch("/sections/{section_id}")
def rename_section(
    section_id: int,
    body: SectionIn,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    section = _owned_section(section_id, faculty, db)
    name = canonical_section(body.name)
    if not name or len(name) > 50:
        raise HTTPException(status_code=422, detail="Enter a section name of up to 50 characters, such as BSCS 1-A.")
    if _section_name_taken(faculty, name, db, exclude_id=section_id):
        raise HTTPException(status_code=409, detail=f"{name} is already on your list of sections.")
    section.section_name = name
    db.commit()
    return {"section_id": section.section_id, "name": section.section_name}


@router.delete("/sections/{section_id}", status_code=204)
def delete_section(section_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    _owned_section(section_id, faculty, db)
    roster_ids = list(db.scalars(select(RosterStudent.roster_id).where(RosterStudent.section_id == section_id)))
    # Sheets that were linked to this section or its students must be re-checked, not left
    # claiming a match that no longer exists.
    db.execute(
        update(StudentInfo)
        .where(
            (StudentInfo.section_id == section_id) | (StudentInfo.roster_id.in_(roster_ids or [-1])),
            StudentInfo.roster_status.is_not(None),
        )
        .values(roster_status="unmatched", roster_id=None, section_id=None, roster_score=None)
    )
    db.execute(delete(ClassSection).where(ClassSection.section_id == section_id))
    db.commit()


@router.get("/sections/{section_id}/students")
def list_students(section_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    _owned_section(section_id, faculty, db)
    rows = db.scalars(
        select(RosterStudent).where(RosterStudent.section_id == section_id).order_by(RosterStudent.position)
    )
    return [_student_shape(student) for student in rows]


@router.post("/sections/{section_id}/students", status_code=201)
def add_student(
    section_id: int,
    body: RosterStudentIn,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    _owned_section(section_id, faculty, db)
    if _name_taken(section_id, body.full_name, db):
        raise HTTPException(status_code=409, detail=f'"{body.full_name}" is already on this section\'s list.')
    added, _ = _append_students(section_id, [body.full_name], db)
    db.commit()
    # A sheet graded before this student was on any list can never be
    # re-checked on its own -- catch up now rather than leaving it
    # permanently unlinked (see roster.py's backfill_roster_links).
    backfill_roster_links(db, faculty.faculty_id)
    student = db.scalar(
        select(RosterStudent).where(RosterStudent.section_id == section_id).order_by(RosterStudent.roster_id.desc())
    )
    return _student_shape(student)


@router.patch("/students/{roster_id}")
def rename_student(
    roster_id: int,
    body: RosterStudentIn,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    student = _owned_student(roster_id, faculty, db)
    if _name_taken(student.section_id, body.full_name, db, exclude_id=roster_id):
        raise HTTPException(status_code=409, detail=f'"{body.full_name}" is already on this section\'s list.')
    student.full_name = body.full_name
    # Sheets already linked to this student show the roster spelling, so keep them in step.
    db.execute(
        update(StudentInfo)
        .where(StudentInfo.roster_id == roster_id, StudentInfo.roster_status.in_(["matched", "confirmed"]))
        .values(name=body.full_name)
    )
    db.commit()
    return _student_shape(student)


@router.delete("/students/{roster_id}", status_code=204)
def delete_student(roster_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    _owned_student(roster_id, faculty, db)
    db.execute(
        update(StudentInfo)
        .where(StudentInfo.roster_id == roster_id)
        .values(roster_id=None, roster_status="unmatched", roster_score=None)
    )
    db.execute(delete(RosterStudent).where(RosterStudent.roster_id == roster_id))
    db.commit()


@router.get("/students/{roster_id}/results")
def roster_student_results(roster_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    """Every graded sheet linked to this roster student -- matched by
    roster_id, so it only includes sheets the teacher actually confirmed
    (or that matched automatically), not every OCR-read name that merely
    looks similar. Newest first."""
    _owned_student(roster_id, faculty, db)
    rows = db.execute(
        select(VSheetResult, AnswerKey.title)
        .join(StudentInfo, StudentInfo.sheet_id == VSheetResult.sheet_id)
        .join(GradingSession, GradingSession.session_id == VSheetResult.session_id)
        .join(AnswerKey, AnswerKey.answer_key_id == GradingSession.answer_key_id)
        .where(StudentInfo.roster_id == roster_id)
        .order_by(VSheetResult.created_at.desc())
    ).all()
    return [
        {
            "sheet_id": sheet.sheet_id,
            "session_id": sheet.session_id,
            "answer_key_name": title,
            "score": float(sheet.score),
            "total": float(sheet.total),
            "percentage": float(sheet.percentage),
            "flagged_count": sheet.flagged_count,
            "status": sheet.status,
            "created_at": sheet.created_at,
        }
        for sheet, title in rows
    ]


def _read_upload(raw: bytes) -> bytes:
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 20MB.")
    return raw


@router.post("/sections/{section_id}/students/import-image")
async def import_students_from_image(
    section_id: int,
    file: UploadFile = File(...),
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    _owned_section(section_id, faculty, db)
    raw = _read_upload(await file.read())
    try:
        if is_heif_filename(file.filename or ""):
            raw = heif_to_jpeg(raw)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (ImageFormatError, UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, BMP, TIFF, HEIC, or HEIF photo of the list.") from exc

    names = await asyncio.to_thread(extract_names_from_image, image, recognizer.recognize_text)
    if not names:
        raise HTTPException(
            status_code=422,
            detail="No names could be read from this photo. Retake it with the list flat, in good light, and filling the frame.",
        )
    added, skipped = _append_students(section_id, names, db)
    db.commit()
    backfill_roster_links(db, faculty.faculty_id)
    return {"added": added, "skipped_duplicates": skipped, "lines_read": len(names)}


@router.post("/sections/{section_id}/students/import-excel")
async def import_students_from_excel(
    section_id: int,
    file: UploadFile = File(...),
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    _owned_section(section_id, faculty, db)
    if not (file.filename or "").lower().endswith(EXCEL_EXTENSIONS):
        raise HTTPException(status_code=415, detail="Upload an Excel file (.xlsx).")
    raw = _read_upload(await file.read())
    try:
        names, column = extract_names_from_excel(raw)
    except RosterImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    added, skipped = _append_students(section_id, names, db)
    db.commit()
    backfill_roster_links(db, faculty.faculty_id)
    return {"added": added, "skipped_duplicates": skipped, "column": column, "rows_read": len(names)}
