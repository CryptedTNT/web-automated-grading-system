"""Verification access regression tests. No MySQL or SMTP connection needed."""
import datetime
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.sessions import SessionMiddleware

from app.db import get_db
from app.routers import auth
from app.security import get_current_faculty


class VerifiedAccessTests(unittest.TestCase):
    def setUp(self):
        self.faculty = SimpleNamespace(
            faculty_id=1, full_name="Test Teacher", institution="LSPU",
            username="test", email="test@lspu.edu.ph", email_verified=0,
            created_at=datetime.datetime.utcnow(), last_login_at=None,
        )
        faculty = self.faculty

        class FakeDB:
            def get(self, model, ident):
                return faculty if ident == 1 else None

            def add(self, row):
                pass

            def commit(self):
                pass

        app = FastAPI()
        app.add_middleware(SessionMiddleware, secret_key="test-only-secret")
        app.dependency_overrides[get_db] = lambda: FakeDB()
        app.include_router(auth.router)

        @app.post("/test-session")
        def establish_session(request: auth.Request):
            request.session["faculty_id"] = 1
            return {"ok": True}

        @app.get("/protected")
        def protected(faculty=Depends(get_current_faculty)):
            return {"id": faculty.faculty_id}

        self.client = TestClient(app)

    def test_anonymous_access_denied(self):
        self.assertEqual(self.client.get("/protected").status_code, 401)

    def test_unverified_cookie_cannot_access_application(self):
        self.client.post("/test-session")
        response = self.client.get("/protected")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.headers["X-Email-Verification-Required"], "true")
        self.assertFalse(self.client.get("/auth/me").json()["email_verified"])

    def test_verification_unlocks_same_restricted_session(self):
        self.client.post("/test-session")
        with patch.object(auth, "_check_code", return_value=True), patch.object(auth, "check_rate_limit"), patch.object(auth, "reset_rate_limit"):
            response = self.client.post("/account/email/verify", json={"code": "123456"})
        self.assertTrue(response.json()["ok"])
        self.assertEqual(self.client.get("/protected").status_code, 200)

    def test_wrong_code_does_not_unlock_access(self):
        self.client.post("/test-session")
        with patch.object(auth, "_check_code", return_value=False), patch.object(auth, "check_rate_limit"):
            response = self.client.post("/account/email/verify", json={"code": "000000"})
        self.assertFalse(response.json()["ok"])
        self.assertEqual(self.client.get("/protected").status_code, 403)

    def test_verified_account_loses_access_if_verification_revoked(self):
        self.client.post("/test-session")
        self.faculty.email_verified = 1
        self.assertEqual(self.client.get("/protected").status_code, 200)
        self.faculty.email_verified = 0
        self.assertEqual(self.client.get("/protected").status_code, 403)

    def test_logout_clears_restricted_session(self):
        self.client.post("/test-session")
        self.client.post("/auth/logout")
        self.assertEqual(self.client.get("/auth/me").status_code, 401)


if __name__ == "__main__":
    unittest.main()
