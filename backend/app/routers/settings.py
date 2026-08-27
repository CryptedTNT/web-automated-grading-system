"""Settings endpoints. One row per (faculty_id, setting_key), value
stored as JSON -- see database/migrations/V003, app_setting table.
"""

import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AppSetting, Faculty
from app.schemas import SetSettingRequest
from app.security import get_current_faculty

router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULT_EXPORT_PREFERENCES = {
    "folder_label": "Downloads",
    "filename_format": "grading_session_{session}_{date}.xlsx",
    "include_student_info": True,
    "include_item_scores": True,
    "include_total_score": True,
    "include_flagged_notes": True,
    "include_question_type": True,
}


@router.get("")
def get_settings(faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    rows = db.scalars(select(AppSetting).where(AppSetting.faculty_id == faculty.faculty_id))
    result = {row.setting_key: row.setting_value for row in rows}
    result.setdefault("export_preferences", DEFAULT_EXPORT_PREFERENCES)
    return result


@router.put("/{key}")
def set_setting(
    key: str,
    body: SetSettingRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    row = db.get(AppSetting, {"faculty_id": faculty.faculty_id, "setting_key": key})
    if row:
        row.setting_value = body.value
        row.updated_at = datetime.datetime.utcnow()
    else:
        row = AppSetting(
            faculty_id=faculty.faculty_id,
            setting_key=key,
            setting_value=body.value,
            updated_at=datetime.datetime.utcnow(),
        )
    db.add(row)
    db.commit()
    return {"ok": True}
