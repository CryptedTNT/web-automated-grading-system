"""Auth endpoints. See database/INTEGRATION_CONTRACT.md section 4
"Authentication" for the SQL each of these implements.

Never SELECT * from faculty in a response -- it carries password and
security-answer hashes. Every response below names its columns.
"""

import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Faculty
from app.schemas import (
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UpdatePasswordRequest,
    UpdateProfileRequest,
)
from app.security import get_current_faculty, hash_password, verify_and_maybe_migrate

router = APIRouter(tags=["auth"])


def _public_shape(f: Faculty) -> dict:
    return {
        "id": f.faculty_id,
        "full_name": f.full_name,
        "institution": f.institution,
        "username": f.username,
        "created_at": f.created_at,
        "last_login": f.last_login_at,
    }


@router.get("/setup-state")
def setup_state(db: Session = Depends(get_db)):
    count = db.scalar(select(Faculty).limit(1))
    return {"has_user": count is not None}


@router.post("/auth/register", status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.scalar(select(Faculty).where(Faculty.username == body.username))
    if existing:
        raise HTTPException(status_code=409, detail="That username is already taken.")

    now = datetime.datetime.utcnow()
    faculty = Faculty(
        full_name=body.full_name,
        institution=body.institution,
        username=body.username,
        password_hash=hash_password(body.password),
        password_salt=None,
        security_question=body.security_question,
        security_answer_hash=hash_password(body.security_answer.strip().lower()),
        security_answer_salt=None,
        created_at=now,
        updated_at=now,
    )
    db.add(faculty)
    db.commit()
    db.refresh(faculty)
    return {"id": faculty.faculty_id}


@router.post("/auth/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    faculty = db.scalar(select(Faculty).where(Faculty.username == body.username))
    if not faculty or not verify_and_maybe_migrate(faculty, body.password, db):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    faculty.last_login_at = datetime.datetime.utcnow()
    db.add(faculty)
    db.commit()

    request.session["faculty_id"] = faculty.faculty_id
    return _public_shape(faculty)


@router.post("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/auth/me")
def me(faculty: Faculty = Depends(get_current_faculty)):
    return _public_shape(faculty)


@router.get("/auth/security-question")
def security_question(username: str, db: Session = Depends(get_db)):
    faculty = db.scalar(select(Faculty).where(Faculty.username == username))
    if not faculty:
        raise HTTPException(status_code=404, detail="No account with that username.")
    return {"security_question": faculty.security_question}


@router.post("/auth/reset")
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    faculty = db.scalar(select(Faculty).where(Faculty.username == body.username))
    if not faculty:
        return {"ok": False}

    answer_matches = (
        verify_and_maybe_migrate_answer(faculty, body.security_answer, db)
        if faculty.security_answer_salt
        else _check_answer_hash(faculty, body.security_answer)
    )
    if not answer_matches:
        return {"ok": False}

    faculty.password_hash = hash_password(body.new_password)
    faculty.password_salt = None
    db.add(faculty)
    db.commit()
    return {"ok": True}


def _check_answer_hash(faculty: Faculty, answer: str) -> bool:
    from werkzeug.security import check_password_hash

    return check_password_hash(faculty.security_answer_hash, answer.strip().lower())


def verify_and_maybe_migrate_answer(faculty: Faculty, answer: str, db: Session) -> bool:
    import hashlib

    legacy = hashlib.sha256(
        f"{answer.strip().lower()}:{faculty.security_answer_salt}".encode("utf-8")
    ).hexdigest()
    if legacy != faculty.security_answer_hash:
        return False
    faculty.security_answer_hash = hash_password(answer.strip().lower())
    faculty.security_answer_salt = None
    db.add(faculty)
    db.commit()
    return True


@router.patch("/account/profile")
def update_profile(
    body: UpdateProfileRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    faculty.full_name = body.full_name
    faculty.institution = body.institution
    db.add(faculty)
    db.commit()
    return _public_shape(faculty)


@router.post("/account/password")
def update_password(
    body: UpdatePasswordRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    if not verify_and_maybe_migrate(faculty, body.current_password, db):
        return {"ok": False}
    faculty.password_hash = hash_password(body.new_password)
    faculty.password_salt = None
    db.add(faculty)
    db.commit()
    return {"ok": True}
