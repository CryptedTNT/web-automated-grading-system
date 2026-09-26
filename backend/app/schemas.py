"""Pydantic request bodies for every mutating endpoint. Responses are
returned as plain dicts shaped to match what vue-app/src/services/
database.js already returns (see each router) -- Pydantic response
models were left out to avoid maintaining two parallel shape
definitions (ORM column list + response schema) for a thesis-scope
backend; the dict shapes are the source of truth and are exercised by
the verification steps in the plan."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

# Loose but real email-shape check (local@domain.tld) -- not a full RFC 5322
# parser, just enough to reject obvious garbage. Every registration/change
# path used to accept ANY string here, including one with embedded
# newlines, which email_sender.py then hands straight to EmailMessage's
# "To" header -- a value never actually shaped like an email address is
# the more likely everyday bug this catches, header injection is the
# defense-in-depth reason for the \s exclusion specifically.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email_format(value: str) -> str:
    value = value.strip()
    if not _EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address.")
    return value


def _validate_password_strength(value: str) -> str:
    # Mirrors vue-app/src/services/api.js's PASSWORD_RULES exactly -- that
    # check was frontend-only, so posting straight to /api/auth/register
    # (or any of the other password-setting endpoints) bypassed it
    # entirely and let a caller set an empty/blank password.
    if (
        len(value) < 8
        or not re.search(r"[A-Za-z]", value)
        or not re.search(r"[0-9]", value)
        or not re.search(r"[^A-Za-z0-9]", value)
    ):
        raise ValueError(
            "Password must be at least 8 characters long and include a letter, a number, and a special character."
        )
    return value


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    institution: str | None = Field(default=None, max_length=150)
    username: str = Field(min_length=1, max_length=60)
    password: str
    email: str = Field(max_length=255)

    _check_email = field_validator("email")(_validate_email_format)
    _check_password = field_validator("password")(_validate_password_strength)


class LoginRequest(BaseModel):
    username: str
    password: str


class VerifyEmailCodeRequest(BaseModel):
    code: str


class UpdateEmailRequest(BaseModel):
    email: str = Field(max_length=255)

    _check_email = field_validator("email")(_validate_email_format)


class ForgotSendCodeRequest(BaseModel):
    username: str


class ForgotResetRequest(BaseModel):
    username: str
    code: str
    new_password: str

    _check_password = field_validator("new_password")(_validate_password_strength)


class UpdateProfileRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    institution: str | None = Field(default=None, max_length=150)


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    _check_password = field_validator("new_password")(_validate_password_strength)


class AnswerKeyCreateRequest(BaseModel):
    name: str = Field(max_length=150)
    subject: str = Field(default="", max_length=150)


class AnswerKeyUpdateRequest(BaseModel):
    name: str = Field(max_length=150)
    subject: str = Field(default="", max_length=150)


class AnswerKeyItemIn(BaseModel):
    # Bounds match what the builder (AnswerKeyView.vue's collectItems())
    # always produces -- gt=0/ge=1 exist for the API caller that isn't
    # that page: without them, a negative points value would silently
    # corrupt every SUM() total in R__views.sql for that item's sheet.
    item_no: int = Field(ge=1)
    type: str  # UI label, e.g. "Multiple Choice"
    enum_group: int | None = None
    question_text: str = ""
    choices: dict | None = None
    correct_answer: str
    alternatives: str = ""
    points: float = Field(default=1.0, gt=0)
    fuzzy_threshold: float = Field(default=85.0, ge=0, le=100)


class ReplaceAnswerKeyItemsRequest(BaseModel):
    items: list[AnswerKeyItemIn]


class CreateSessionRequest(BaseModel):
    answer_key_id: int
    folder: str | None = Field(default=None, max_length=255)
    session_name: str | None = Field(default=None, max_length=150)
    total_sheets: int = 0


class UpdateSessionStatusRequest(BaseModel):
    status: str  # UI label: Processing|Completed|Cancelled|Failed


class ReviewRequest(BaseModel):
    action: str = Field(pattern="^(accepted_correct|marked_incorrect|manual_answer_override)$")
    corrected_answer: str | None = None
    review_seconds: int | None = None


class SetSettingRequest(BaseModel):
    value: object


class ExportPreferencesRequest(BaseModel):
    folder_label: str = "Downloads"
    filename_format: str = "grading_session_{session}_{date}.xlsx"
    include_student_info: bool = True
    include_item_scores: bool = True
    include_total_score: bool = True
    include_flagged_notes: bool = True
    include_question_type: bool = True
