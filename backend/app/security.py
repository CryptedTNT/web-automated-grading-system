"""Password hashing and the session-based auth dependency.

Session, not JWT: Starlette's SessionMiddleware (added in main.py) gives
every request a signed cookie the app can read/write like Flask's
`session[...]`, which is all a single-teacher-account app needs -- see
database/INTEGRATION_CONTRACT.md section 2.

Password hashing is a dual path so the seeded demo account (and any
account a browser created before this backend existed) keeps working:
  - password_salt IS NOT NULL -> verify with the legacy scheme the old
    front end and database/seed/demo_data.sql both use:
    SHA256(password + ':' + salt). On success, re-hash to werkzeug and
    clear the salt (migrate-on-login), per INTEGRATION_CONTRACT.md's
    "re-hash the demo account" note.
  - password_salt IS NULL -> werkzeug.security.check_password_hash.
New accounts always go straight to werkzeug, salt NULL.
"""

import hashlib
import secrets

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash, generate_password_hash

from app.db import get_db
from app.models import Faculty


def generate_numeric_code() -> str:
    """A 6-digit code for email verification/password reset. Zero-padded
    so it's always 6 characters (e.g. '004821'), generated with `secrets`
    (not `random`) since it's a short-lived credential, same reasoning
    as password hashing."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _legacy_hash(password: str, salt: str) -> str:
    return hashlib.sha256(f"{password}:{salt}".encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_and_maybe_migrate(faculty: Faculty, password: str, db: Session) -> bool:
    """Returns True/False for whether `password` matches. On a
    successful legacy-scheme verification, upgrades the stored hash to
    werkzeug in the same call so the account never needs re-seeding."""
    if faculty.password_salt:
        if _legacy_hash(password, faculty.password_salt) != faculty.password_hash:
            return False
        faculty.password_hash = hash_password(password)
        faculty.password_salt = None
        db.add(faculty)
        db.commit()
        return True
    return check_password_hash(faculty.password_hash, password)


def get_current_faculty(request: Request, db: Session = Depends(get_db)) -> Faculty:
    faculty_id = request.session.get("faculty_id")
    if not faculty_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in.")
    faculty = db.get(Faculty, faculty_id)
    if not faculty:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in.")
    return faculty
