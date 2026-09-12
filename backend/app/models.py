"""SQLAlchemy ORM models, one class per table in database/migrations/
V001-V005, plus read-only classes for the views in R__views.sql.

Column names/types mirror the migrations exactly -- this file has no
independent opinion about the schema, it just describes it to
SQLAlchemy. ENUM-like columns are typed as plain String and left for
MySQL's own CHECK/ENUM constraints to enforce; the label<->code mapping
lives in app/utils.py, not here.
"""

from __future__ import annotations

import datetime
import decimal

from sqlalchemy import JSON, DateTime, Numeric, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column
    
from app.db import Base


class Faculty(Base):
    __tablename__ = "faculty"

    faculty_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(150))
    institution: Mapped[str | None] = mapped_column(String(150))
    username: Mapped[str] = mapped_column(String(60), unique=True)
    email: Mapped[str | None] = mapped_column(String(255))
    email_verified: Mapped[int] = mapped_column(SmallInteger, default=0)
    password_hash: Mapped[str] = mapped_column(String(255))
    password_salt: Mapped[str | None] = mapped_column(String(64))
    security_question: Mapped[str | None] = mapped_column(String(255))
    security_answer_hash: Mapped[str | None] = mapped_column(String(255))
    security_answer_salt: Mapped[str | None] = mapped_column(String(64))
    is_active: Mapped[int] = mapped_column(SmallInteger, default=1)
    last_login_at: Mapped[datetime.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime)


class EmailVerificationCode(Base):
    __tablename__ = "email_verification_code"

    code_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    faculty_id: Mapped[int]
    purpose: Mapped[str] = mapped_column(String(20))  # verify_email|reset_password
    code_hash: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime)


class AnswerKey(Base):
    __tablename__ = "answer_key"

    answer_key_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    faculty_id: Mapped[int]
    title: Mapped[str] = mapped_column(String(150))
    subject: Mapped[str] = mapped_column(String(150))
    year_level: Mapped[str | None] = mapped_column(String(50))
    section: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime)


class AnswerKeyItem(Base):
    __tablename__ = "answer_key_item"

    item_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    answer_key_id: Mapped[int]
    item_no: Mapped[int]
    question_type: Mapped[str] = mapped_column(String(20))  # MC|TF|IDENTIFICATION|ENUMERATION
    enum_group: Mapped[int | None]
    question_text: Mapped[str | None] = mapped_column(Text)
    # none_as_null=True: SQLAlchemy's JSON type otherwise stores a Python
    # None as the JSON literal `null`, not a real SQL NULL -- which fails
    # V004's chk_item_choices (choices IS NULL OR question_type = 'MC')
    # for every non-MC item, since a JSON `null` value isn't SQL NULL.
    choices: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))  # {"a":"...","b":"...","c":"...","d":"..."}
    correct_answer: Mapped[str] = mapped_column(Text)
    alternative_answers: Mapped[str | None] = mapped_column(Text)
    fuzzy_threshold: Mapped[decimal.Decimal | None] = mapped_column(Numeric(5, 2))
    points: Mapped[decimal.Decimal] = mapped_column(Numeric(6, 2))


class GradingSession(Base):
    __tablename__ = "grading_session"

    session_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    faculty_id: Mapped[int]
    answer_key_id: Mapped[int]
    session_name: Mapped[str] = mapped_column(String(150))
    source_folder: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20))  # processing|completed|cancelled|failed
    total_sheets: Mapped[int] = mapped_column(default=0)
    processed_sheets: Mapped[int] = mapped_column(default=0)
    started_at: Mapped[datetime.datetime] = mapped_column(DateTime)
    finished_at: Mapped[datetime.datetime | None] = mapped_column(DateTime)


class ExamSheet(Base):
    """One row per student submission -- which may span several physical
    page images (see ExamSheetPage, added in V006). sheet_id is the
    aggregation point student_info/student_answer/grading_result already
    keyed off before V006; it simply used to mean "one image" and now
    means "one group of pages" instead."""

    __tablename__ = "exam_sheet"

    sheet_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int]
    answer_key_id: Mapped[int]
    sheet_code: Mapped[str] = mapped_column(String(50), unique=True)
    upload_date: Mapped[datetime.datetime] = mapped_column(DateTime)


class ExamSheetPage(Base):
    """One row per physical page image within a submission. page_no is
    1-based in upload/capture order -- only page 1 is expected to carry
    a recognisable Name/Section header; see app/inference/pipeline.py's
    run_sheet_group for how pages are pooled for grading without needing
    to know which items live on which page."""

    __tablename__ = "exam_sheet_page"

    page_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sheet_id: Mapped[int]
    page_no: Mapped[int] = mapped_column(SmallInteger)
    original_filename: Mapped[str | None] = mapped_column(String(255))
    image_path: Mapped[str] = mapped_column(String(255))
    processing_status: Mapped[str] = mapped_column(String(20))
    error_message: Mapped[str | None] = mapped_column(String(255))
    uploaded_at: Mapped[datetime.datetime] = mapped_column(DateTime)


class StudentInfo(Base):
    __tablename__ = "student_info"

    student_info_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sheet_id: Mapped[int] = mapped_column(unique=True)
    name: Mapped[str | None] = mapped_column(String(150))
    name_confidence: Mapped[decimal.Decimal | None] = mapped_column(Numeric(5, 4))
    section: Mapped[str | None] = mapped_column(String(50))
    exam_date: Mapped[datetime.date | None]
    consent_status: Mapped[str] = mapped_column(String(20))  # consented|not_consented
    participant_code: Mapped[str | None] = mapped_column(String(50))


class StudentAnswer(Base):
    __tablename__ = "student_answer"

    student_answer_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sheet_id: Mapped[int]
    item_id: Mapped[int]
    crop_path: Mapped[str | None] = mapped_column(String(255))
    recognized_text: Mapped[str | None] = mapped_column(Text)
    htr_confidence: Mapped[decimal.Decimal | None] = mapped_column(Numeric(5, 4))
    model_used: Mapped[str | None] = mapped_column(String(100))
    recognized_at: Mapped[datetime.datetime | None] = mapped_column(DateTime)


class GradingResult(Base):
    __tablename__ = "grading_result"

    result_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sheet_id: Mapped[int]
    item_id: Mapped[int]
    recognized_id: Mapped[int | None]
    score: Mapped[decimal.Decimal] = mapped_column(Numeric(6, 2), default=0)
    auto_score: Mapped[decimal.Decimal] = mapped_column(Numeric(6, 2), default=0)
    status: Mapped[str] = mapped_column(String(20))  # correct|incorrect|flagged
    auto_status: Mapped[str] = mapped_column(String(20))
    match_score: Mapped[decimal.Decimal | None] = mapped_column(Numeric(5, 2))
    is_manual_override: Mapped[int] = mapped_column(SmallInteger, default=0)
    remarks: Mapped[str | None] = mapped_column(String(255))
    graded_at: Mapped[datetime.datetime] = mapped_column(DateTime)


class ManualReview(Base):
    __tablename__ = "manual_review"

    review_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    result_id: Mapped[int] = mapped_column(unique=True)
    reviewed_by: Mapped[int | None]
    override_action: Mapped[str | None] = mapped_column(String(30))
    original_answer: Mapped[str | None] = mapped_column(Text)
    corrected_answer: Mapped[str | None] = mapped_column(Text)
    final_score: Mapped[decimal.Decimal | None] = mapped_column(Numeric(6, 2))
    review_status: Mapped[str] = mapped_column(String(20), default="pending")
    review_seconds: Mapped[int | None]
    reviewed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime)


class Report(Base):
    __tablename__ = "report"

    report_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    answer_key_id: Mapped[int]
    session_id: Mapped[int | None]
    generated_by: Mapped[int]
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(255))
    generated_at: Mapped[datetime.datetime] = mapped_column(DateTime)


class AppSetting(Base):
    __tablename__ = "app_setting"

    faculty_id: Mapped[int] = mapped_column(primary_key=True)
    setting_key: Mapped[str] = mapped_column(String(60), primary_key=True)
    setting_value: Mapped[dict | str | bool | None] = mapped_column(JSON)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime)


# ---------------------------------------------------------------------
# Views (R__views.sql) -- read-only. Never write through these; never
# recompute the totals they derive.
# ---------------------------------------------------------------------


class VSheetResult(Base):
    __tablename__ = "v_sheet_result"
    __mapper_args__ = {"eager_defaults": False}

    sheet_id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int]
    sheet_code: Mapped[str]
    participant_code: Mapped[str | None]
    student_name: Mapped[str | None]
    section: Mapped[str | None]
    consent_status: Mapped[str]
    original_filename: Mapped[str | None]
    image_path: Mapped[str]
    processing_status: Mapped[str]
    score: Mapped[decimal.Decimal]
    total: Mapped[decimal.Decimal]
    percentage: Mapped[decimal.Decimal]
    flagged_count: Mapped[int]
    correct_count: Mapped[int]
    incorrect_count: Mapped[int]
    status: Mapped[str]
    created_at: Mapped[datetime.datetime]


class VResultItem(Base):
    __tablename__ = "v_result_item"

    result_id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int]
    session_id: Mapped[int]
    sheet_code: Mapped[str]
    item_id: Mapped[int]
    item_no: Mapped[int]
    question_type: Mapped[str]
    question_type_label: Mapped[str]
    enum_group: Mapped[int | None]
    student_answer: Mapped[str | None]
    correct_answer: Mapped[str]
    alternatives: Mapped[str | None]
    fuzzy_threshold: Mapped[decimal.Decimal | None]
    match_score: Mapped[decimal.Decimal | None]
    points: Mapped[decimal.Decimal]
    earned: Mapped[decimal.Decimal]
    status: Mapped[str]
    auto_status: Mapped[str]
    auto_score: Mapped[decimal.Decimal]
    manual_override: Mapped[int]
    override_action: Mapped[str | None]
    review_status: Mapped[str | None]
    reviewed_at: Mapped[datetime.datetime | None]
    remarks: Mapped[str | None]
    model_used: Mapped[str | None]
    confidence: Mapped[decimal.Decimal | None]
    crop_path: Mapped[str | None]


class VFlaggedQueue(Base):
    __tablename__ = "v_flagged_queue"

    # Same shape as v_result_item; a separate class is needed only
    # because SQLAlchemy requires each mapped class to name its own
    # table, even when (as here) it is really a filtered view of another.
    result_id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int]
    session_id: Mapped[int]
    sheet_code: Mapped[str]
    item_id: Mapped[int]
    item_no: Mapped[int]
    question_type: Mapped[str]
    question_type_label: Mapped[str]
    enum_group: Mapped[int | None]
    student_answer: Mapped[str | None]
    correct_answer: Mapped[str]
    alternatives: Mapped[str | None]
    fuzzy_threshold: Mapped[decimal.Decimal | None]
    match_score: Mapped[decimal.Decimal | None]
    points: Mapped[decimal.Decimal]
    earned: Mapped[decimal.Decimal]
    status: Mapped[str]
    auto_status: Mapped[str]
    auto_score: Mapped[decimal.Decimal]
    manual_override: Mapped[int]
    override_action: Mapped[str | None]
    review_status: Mapped[str | None]
    reviewed_at: Mapped[datetime.datetime | None]
    remarks: Mapped[str | None]
    model_used: Mapped[str | None]
    confidence: Mapped[decimal.Decimal | None]
    crop_path: Mapped[str | None]


class VSessionSummary(Base):
    __tablename__ = "v_session_summary"

    session_id: Mapped[int] = mapped_column(primary_key=True)
    faculty_id: Mapped[int]
    answer_key_id: Mapped[int]
    answer_key_name: Mapped[str]
    subject: Mapped[str]
    session_name: Mapped[str]
    source_folder: Mapped[str | None]
    status: Mapped[str]
    queued_sheets: Mapped[int]
    graded_sheets: Mapped[int]
    flagged_items: Mapped[int]
    average_percentage: Mapped[decimal.Decimal | None]
    started_at: Mapped[datetime.datetime]
    finished_at: Mapped[datetime.datetime | None]


class VDashboardStats(Base):
    __tablename__ = "v_dashboard_stats"

    faculty_id: Mapped[int] = mapped_column(primary_key=True)
    sessions: Mapped[int]
    sheets: Mapped[int]
    flagged: Mapped[int]
    average: Mapped[decimal.Decimal]
