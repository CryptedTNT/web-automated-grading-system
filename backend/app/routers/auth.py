"""Auth endpoints. See database/INTEGRATION_CONTRACT.md section 4
"Authentication" for the SQL most of these implement; email
verification and password reset (added in V005) aren't in that
original contract but follow the same shape.

Never SELECT * from faculty in a response -- it carries password and
security-answer hashes. Every response below names its columns.
"""

import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.email_sender import send_code_email
from app.models import EmailVerificationCode, Faculty
from app.schemas import (
    ForgotResetRequest,
    ForgotSendCodeRequest,
    LoginRequest,
    RegisterRequest,
    UpdateEmailRequest,
    UpdatePasswordRequest,
    UpdateProfileRequest,
    VerifyEmailCodeRequest,
)
from app.rate_limit import check_rate_limit, reset_rate_limit
from app.security import (
    generate_numeric_code,
    get_current_faculty,
    hash_password,
    verify_and_maybe_migrate,
)
from werkzeug.security import check_password_hash

router = APIRouter(tags=["auth"])

CODE_LIFETIME = datetime.timedelta(minutes=10)
RESEND_COOLDOWN = datetime.timedelta(minutes=5)


def _public_shape(f: Faculty) -> dict:
    return {
        "id": f.faculty_id,
        "full_name": f.full_name,
        "institution": f.institution,
        "username": f.username,
        "email": f.email,
        "email_verified": bool(f.email_verified),
        "created_at": f.created_at,
        "last_login": f.last_login_at,
    }


def _issue_code(faculty: Faculty, purpose: str, db: Session) -> str:
    """Generates, hashes, and stores a code for this faculty/purpose,
    then returns the raw code so the caller can email it. The raw code
    is never persisted -- only its hash, same principle as passwords."""
    code = generate_numeric_code()
    db.add(
        EmailVerificationCode(
            faculty_id=faculty.faculty_id,
            purpose=purpose,
            code_hash=hash_password(code),
            expires_at=datetime.datetime.utcnow() + CODE_LIFETIME,
            created_at=datetime.datetime.utcnow(),
        )
    )
    db.commit()
    return code


def _seconds_until_resend(faculty: Faculty, purpose: str, db: Session) -> int:
    """Seconds remaining before another code may be issued for this
    faculty/purpose, based on when the most recent one (used or not)
    was issued -- 0 once RESEND_COOLDOWN has elapsed, or if none exists
    yet. This caps how often Gmail sends go out per account, not just
    how often a code can be *checked*."""
    last = db.scalar(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.faculty_id == faculty.faculty_id,
            EmailVerificationCode.purpose == purpose,
        )
        .order_by(EmailVerificationCode.created_at.desc())
        .limit(1)
    )
    if not last:
        return 0
    remaining = RESEND_COOLDOWN - (datetime.datetime.utcnow() - last.created_at)
    return max(0, int(remaining.total_seconds()))


def _format_wait(seconds: int) -> str:
    minutes, secs = divmod(seconds, 60)
    if minutes and secs:
        return f"{minutes}m {secs}s"
    if minutes:
        return f"{minutes}m"
    return f"{secs}s"


def _require_not_cooling_down(faculty: Faculty, purpose: str, db: Session) -> None:
    """Raises 429 with a Retry-After header if a code was issued too
    recently. The frontend reads Retry-After to drive its own countdown
    rather than treating this as a real failure."""
    wait = _seconds_until_resend(faculty, purpose, db)
    if wait > 0:
        raise HTTPException(
            status_code=429,
            detail=f"Please wait before requesting another code. Try again in {_format_wait(wait)}.",
            headers={"Retry-After": str(wait)},
        )


def _check_code(faculty: Faculty, purpose: str, submitted_code: str, db: Session) -> bool:
    """True if `submitted_code` matches any unused, unexpired code
    issued for this faculty/purpose. Marks that row used on success so
    it can't be replayed."""
    now = datetime.datetime.utcnow()
    candidates = db.scalars(
        select(EmailVerificationCode).where(
            EmailVerificationCode.faculty_id == faculty.faculty_id,
            EmailVerificationCode.purpose == purpose,
            EmailVerificationCode.used_at.is_(None),
            EmailVerificationCode.expires_at > now,
        )
    )
    for row in candidates:
        if check_password_hash(row.code_hash, submitted_code):
            row.used_at = now
            db.add(row)
            db.commit()
            return True
    return False


@router.get("/setup-state")
def setup_state(db: Session = Depends(get_db)):
    count = db.scalar(select(Faculty).limit(1))
    return {"has_user": count is not None}


@router.post("/auth/register", status_code=201)
def register(body: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    existing = db.scalar(select(Faculty).where(Faculty.username == body.username))
    if existing:
        raise HTTPException(status_code=409, detail="That username is already taken.")

    # Only username uniqueness used to be enforced -- two accounts could
    # share one email. Login and forgot-password are both keyed by
    # username, not email, so that specific lookup was never actually
    # ambiguous; this is about ordinary data hygiene instead -- one
    # real inbox should mean one account, not silently let two
    # unrelated teacher accounts both claim (and separately verify)
    # the same address.
    existing_email = db.scalar(select(Faculty).where(Faculty.email == body.email))
    if existing_email:
        raise HTTPException(status_code=409, detail="That email is already registered to another account.")

    now = datetime.datetime.utcnow()
    faculty = Faculty(
        full_name=body.full_name,
        institution=body.institution,
        username=body.username,
        email=body.email,
        email_verified=0,
        password_hash=hash_password(body.password),
        password_salt=None,
        created_at=now,
        updated_at=now,
    )
    db.add(faculty)
    db.commit()
    db.refresh(faculty)

    # Auto-sign-in so the Verify Email step right after signup can reuse
    # the same authenticated /account/email/* endpoints Settings uses
    # later, instead of a separate public-by-username code path.
    request.session["faculty_id"] = faculty.faculty_id
    return _public_shape(faculty)


LOGIN_MAX_ATTEMPTS = 10
LOGIN_WINDOW_SECONDS = 15 * 60


@router.post("/auth/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    # Keyed on username, not IP: an IP-based limit is trivially spread
    # across many source addresses, but this is what actually stops a
    # single account being password-guessed regardless of where the
    # requests come from.
    rate_key = f"login:{body.username.strip().lower()}"
    check_rate_limit(rate_key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS)

    faculty = db.scalar(select(Faculty).where(Faculty.username == body.username))
    if not faculty or not verify_and_maybe_migrate(faculty, body.password, db):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    reset_rate_limit(rate_key)
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


# ---------------------------------------------------------------------
# Email verification -- used both right after signup and later from
# Settings. Same two endpoints either way.
# ---------------------------------------------------------------------


@router.post("/account/email")
def update_email(
    body: UpdateEmailRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    # Only a genuinely NEW email should lose its verified status -- this
    # used to reset it unconditionally, so re-saving the same address
    # (e.g. clicking "Save Email" without changing anything) silently
    # un-verified an already-verified account for no reason.
    if body.email != faculty.email:
        # Same uniqueness rule as register() -- otherwise a teacher could
        # register with a unique email, then change it here to collide
        # with another account, sidestepping that check entirely.
        existing_email = db.scalar(
            select(Faculty).where(Faculty.email == body.email, Faculty.faculty_id != faculty.faculty_id)
        )
        if existing_email:
            raise HTTPException(status_code=409, detail="That email is already registered to another account.")
        faculty.email = body.email
        faculty.email_verified = 0
        db.add(faculty)
        db.commit()
    return _public_shape(faculty)


@router.post("/account/email/send-code")
def send_email_verification_code(
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    if not faculty.email:
        raise HTTPException(status_code=400, detail="Add an email address first.")
    _require_not_cooling_down(faculty, "verify_email", db)
    code = _issue_code(faculty, "verify_email", db)
    try:
        send_code_email(faculty.email, code, "verify_email")
    except Exception:
        # SMTP misconfiguration or a transient failure on Google's end --
        # either way the teacher should see a clean message, not a 500.
        raise HTTPException(status_code=502, detail="Could not send the verification email right now. Please try again shortly.")
    return {"ok": True}


@router.post("/account/email/verify")
def verify_email_code(
    body: VerifyEmailCodeRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    rate_key = f"verify_email_code:{faculty.faculty_id}"
    check_rate_limit(rate_key, max_attempts=10, window_seconds=int(CODE_LIFETIME.total_seconds()))
    if not _check_code(faculty, "verify_email", body.code, db):
        return {"ok": False}
    reset_rate_limit(rate_key)
    faculty.email_verified = 1
    db.add(faculty)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------
# Forgot password -- public (no session yet). Requires a *verified*
# email, per the app's own rule: an unverified address was never proven
# to belong to the account holder, so it can't be trusted to recover it.
# ---------------------------------------------------------------------


@router.post("/auth/forgot/send-code")
def forgot_send_code(body: ForgotSendCodeRequest, db: Session = Depends(get_db)):
    """Always the same {"ok": True} shape whether the username doesn't
    exist, exists with no verified email, or exists and gets a real
    code -- previously the unverified case raised a distinct 400 with
    an explicit message, which let anyone confirm a username was
    registered (and unverified) in a single request without ever
    knowing the password. The frontend (AuthForgot.vue) already only
    ever displays a generic "if that account has a verified email..."
    message here, so this doesn't remove any real feedback the UI was
    relying on -- it just stops leaking through the status code.

    The one residual signal is the 429 below: a real, verified account
    that was just emailed a code will rate-limit a second rapid request
    while an unknown/unverified username never will. That's a much
    weaker leak (needs two requests within the resend cooldown, not
    one) and is the cost of the resend cooldown actually working --
    accepted deliberately rather than by oversight.
    """
    faculty = db.scalar(select(Faculty).where(Faculty.username == body.username))
    if not faculty or not faculty.email or not faculty.email_verified:
        return {"ok": True}

    _require_not_cooling_down(faculty, "reset_password", db)
    code = _issue_code(faculty, "reset_password", db)
    try:
        send_code_email(faculty.email, code, "reset_password")
    except Exception:
        raise HTTPException(status_code=502, detail="Could not send the reset email right now. Please try again shortly.")
    return {"ok": True}


@router.post("/auth/forgot/reset")
def forgot_reset(body: ForgotResetRequest, db: Session = Depends(get_db)):
    faculty = db.scalar(select(Faculty).where(Faculty.username == body.username))
    if not faculty:
        return {"ok": False}

    # Keyed on faculty_id, not IP, same reasoning as login: this is a
    # public, unauthenticated endpoint guarding a 6-digit code, so
    # without this an attacker who already knows/guessed the username
    # could brute-force the 1-in-a-million code within its 10-minute
    # lifetime. Resending a code (above) is separately cooled down;
    # this limits how many times an *already-issued* code can be
    # guessed against.
    rate_key = f"reset_guess:{faculty.faculty_id}"
    check_rate_limit(rate_key, max_attempts=10, window_seconds=int(CODE_LIFETIME.total_seconds()))

    if not _check_code(faculty, "reset_password", body.code, db):
        return {"ok": False}

    reset_rate_limit(rate_key)
    faculty.password_hash = hash_password(body.new_password)
    faculty.password_salt = None
    db.add(faculty)
    db.commit()
    return {"ok": True}
