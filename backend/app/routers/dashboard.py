"""Dashboard summary tiles. See INTEGRATION_CONTRACT.md section 4
"Results and review" (dashboardStats row) / APP_MAPPING.md section 3.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Faculty, GradingSession, VDashboardStats, VSheetResult
from app.security import get_current_faculty

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def dashboard_stats(faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    row = db.scalar(select(VDashboardStats).where(VDashboardStats.faculty_id == faculty.faculty_id))
    # `flagged` is the number of individual answers awaiting review. The
    # dashboard also needs the more teacher-actionable number of papers that
    # are not complete yet, so count each sheet once if it has any flag.
    # This is computed here rather than adding a database-view column, which
    # keeps the deployed application backwards-compatible until migrations
    # are next applied.
    needs_review = db.scalar(
        select(func.count())
        .select_from(VSheetResult)
        .join(GradingSession, GradingSession.session_id == VSheetResult.session_id)
        .where(
            GradingSession.faculty_id == faculty.faculty_id,
            GradingSession.status != "cancelled",
            VSheetResult.flagged_count > 0,
        )
    ) or 0
    if not row:
        return {"sheets": 0, "sessions": 0, "flagged": 0, "needs_review": int(needs_review), "average": 0}
    return {
        "sheets": row.sheets,
        "sessions": row.sessions,
        "flagged": row.flagged,
        "needs_review": int(needs_review),
        "average": float(row.average),
    }
