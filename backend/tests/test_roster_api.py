import io
import unittest
from types import SimpleNamespace

from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import ClassSection, ExamSheet, GradingSession, RosterStudent, StudentInfo
from app.security import get_current_faculty


def _xlsx(rows):
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


class RosterApiTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        # ExamSheet/GradingSession are needed too: adding or importing
        # roster students now also runs backfill_roster_links(), which
        # joins student_info through them to re-check already-graded,
        # still-unlinked sheets against the roster (see app/roster.py).
        Base.metadata.create_all(
            engine,
            tables=[
                ClassSection.__table__,
                RosterStudent.__table__,
                StudentInfo.__table__,
                ExamSheet.__table__,
                GradingSession.__table__,
            ],
        )
        Local = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)

        def override_db():
            db = Local()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_faculty] = lambda: SimpleNamespace(faculty_id=1)
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_section_lifecycle_uses_canonical_names(self):
        created = self.client.post("/api/sections", json={"name": "bscs 1A"})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["name"], "BSCS 1-A")
        section_id = created.json()["section_id"]

        self.assertEqual(self.client.post("/api/sections", json={"name": "BSCS 1 - A"}).status_code, 409)

        renamed = self.client.patch(f"/api/sections/{section_id}", json={"name": "BSCS 1-B"})
        self.assertEqual(renamed.json()["name"], "BSCS 1-B")

        listing = self.client.get("/api/sections").json()
        self.assertEqual(listing, [{"section_id": section_id, "name": "BSCS 1-B", "student_count": 0}])

    def test_students_are_added_in_order_and_duplicates_are_refused(self):
        section_id = self.client.post("/api/sections", json={"name": "BSCS 1-A"}).json()["section_id"]
        self.client.post(f"/api/sections/{section_id}/students", json={"full_name": "Maria Santos"})
        self.client.post(f"/api/sections/{section_id}/students", json={"full_name": "Juan Dela Cruz"})

        duplicate = self.client.post(f"/api/sections/{section_id}/students", json={"full_name": "  maria   SANTOS "})
        self.assertEqual(duplicate.status_code, 409)

        students = self.client.get(f"/api/sections/{section_id}/students").json()
        self.assertEqual([s["full_name"] for s in students], ["Maria Santos", "Juan Dela Cruz"])
        self.assertEqual([s["position"] for s in students], [1, 2])

    def test_excel_import_appends_names_and_skips_duplicates(self):
        section_id = self.client.post("/api/sections", json={"name": "BSCS 1-A"}).json()["section_id"]
        self.client.post(f"/api/sections/{section_id}/students", json={"full_name": "Maria Santos"})
        data = _xlsx([["No", "Name"], [1, "Juan Dela Cruz"], [2, "Maria Santos"], [3, "Jeremy Race"]])
        response = self.client.post(
            f"/api/sections/{section_id}/students/import-excel",
            files={"file": ("list.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["added"], ["Juan Dela Cruz", "Jeremy Race"])
        self.assertEqual(body["skipped_duplicates"], ["Maria Santos"])
        self.assertEqual(body["column"], "column B")

    def test_excel_import_refuses_ambiguous_file_with_reason(self):
        section_id = self.client.post("/api/sections", json={"name": "BSCS 1-A"}).json()["section_id"]
        data = _xlsx([["First name", "Last name"], ["Juan", "Dela Cruz"], ["Maria", "Santos"]])
        response = self.client.post(
            f"/api/sections/{section_id}/students/import-excel",
            files={"file": ("list.xlsx", data, "application/octet-stream")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("More than one column", response.json()["detail"])

    def test_excel_import_rejects_non_xlsx_upload(self):
        section_id = self.client.post("/api/sections", json={"name": "BSCS 1-A"}).json()["section_id"]
        response = self.client.post(
            f"/api/sections/{section_id}/students/import-excel",
            files={"file": ("list.csv", b"Name\nJuan", "text/csv")},
        )
        self.assertEqual(response.status_code, 415)

    def test_deleting_a_section_removes_its_students(self):
        section_id = self.client.post("/api/sections", json={"name": "BSCS 1-A"}).json()["section_id"]
        self.client.post(f"/api/sections/{section_id}/students", json={"full_name": "Maria Santos"})
        self.assertEqual(self.client.delete(f"/api/sections/{section_id}").status_code, 204)
        self.assertEqual(self.client.get("/api/sections").json(), [])


if __name__ == "__main__":
    unittest.main()
