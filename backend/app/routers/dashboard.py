"""The four Dashboard tiles. See INTEGRATION_CONTRACT.md section 4
"Results and review" (dashboardStats row) / APP_MAPPING.md section 3.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Faculty, VDashboardStats
from app.security import get_current_faculty

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def dashboard_stats(faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    row = db.scalar(select(VDashboardStats).where(VDashboardStats.faculty_id == faculty.faculty_id))
    if not row:
        return {"sheets": 0, "sessions": 0, "flagged": 0, "average": 0}
    return {
        "sheets": row.sheets,
        "sessions": row.sessions,
        "flagged": row.flagged,
        "average": float(row.average),
    }
