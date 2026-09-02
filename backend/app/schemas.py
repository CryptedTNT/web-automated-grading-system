"""Pydantic request bodies for every mutating endpoint. Responses are
returned as plain dicts shaped to match what vue-app/src/services/
database.js already returns (see each router) -- Pydantic response
models were left out to avoid maintaining two parallel shape
definitions (ORM column list + response schema) for a thesis-scope
backend; the dict shapes are the source of truth and are exercised by
the verification steps in the plan."""

from __future__ import annotations

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    full_name: str
    institution: str | None = None
    username: str
    password: str
    email: str


class LoginRequest(BaseModel):
    username: str
    password: str


class VerifyEmailCodeRequest(BaseModel):
    code: str


class UpdateEmailRequest(BaseModel):
    email: str


class ForgotSendCodeRequest(BaseModel):
    username: str


class ForgotResetRequest(BaseModel):
    username: str
    code: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    full_name: str
    institution: str | None = None


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AnswerKeyCreateRequest(BaseModel):
    name: str
    subject: str = ""


class AnswerKeyUpdateRequest(BaseModel):
    name: str
    subject: str = ""


class AnswerKeyItemIn(BaseModel):
    item_no: int
    type: str  # UI label, e.g. "Multiple Choice"
    enum_group: int | None = None
    question_text: str = ""
    choices: dict | None = None
    correct_answer: str
    alternatives: str = ""
    points: float = 1.0
    fuzzy_threshold: float = 85.0


class ReplaceAnswerKeyItemsRequest(BaseModel):
    items: list[AnswerKeyItemIn]


class CreateSessionRequest(BaseModel):
    answer_key_id: int
    folder: str | None = None
    session_name: str | None = None
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
