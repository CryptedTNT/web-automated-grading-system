"""Loads backend/.env into a small Settings object. Every other module
reads connection/secret values from here rather than os.environ directly,
so there is exactly one place that knows where the .env file is."""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://ags_app:ChangeMe_AGS_2026!@127.0.0.1:3306/ags_db?charset=utf8mb4",
    )
    upload_dir: Path = BACKEND_DIR / os.getenv("UPLOAD_DIR", "./storage/uploads")
    crop_dir: Path = BACKEND_DIR / os.getenv("CROP_DIR", "./storage/crops")
    export_dir: Path = BACKEND_DIR / os.getenv("EXPORT_DIR", "./storage/exports")
    secret_key: str = os.getenv("SECRET_KEY", "dev-only-insecure-key-change-me")
    frontend_origin: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    # Marks the session cookie Secure (HTTPS-only) -- defaults to False so
    # local http://localhost dev keeps working (a Secure cookie is never
    # sent over plain HTTP, silently breaking every login otherwise).
    # MUST be set to true in any real deployment served over HTTPS -- see
    # SETUP.md's deployment note.
    session_cookie_secure: bool = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"

    # Gmail SMTP -- see SETUP.md for how to generate the app password.
    # This account is what the server sends verification/reset emails
    # *from*; it is separate from any teacher's own email in `faculty`.
    smtp_host: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_app_password: str = os.getenv("SMTP_APP_PASSWORD", "")
    smtp_from_email: str = os.getenv("FROM_EMAIL", "") or smtp_user


settings = Settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)
settings.crop_dir.mkdir(parents=True, exist_ok=True)
settings.export_dir.mkdir(parents=True, exist_ok=True)

# Both of these strings are committed to this public repo (this file's
# own fallback, and .env.example's placeholder) -- anyone who has read
# them can forge a signed session cookie for any faculty_id if a real
# deployment ever leaves one of them in place. SESSION_COOKIE_SECURE is
# the flag that already distinguishes "real HTTPS deployment" from
# local http://localhost dev (see the field above and main.py), so a
# placeholder key combined with that flag being true is a hard stop
# rather than a warning.
_INSECURE_SECRET_KEYS = {
    "dev-only-insecure-key-change-me",
    "replace-me-with-a-random-64-character-hex-string",
    "",
}

if settings.secret_key in _INSECURE_SECRET_KEYS:
    if settings.session_cookie_secure:
        raise RuntimeError(
            "SECRET_KEY is still a placeholder value, but SESSION_COOKIE_SECURE=true means "
            "this looks like a real deployment. Generate a real key first: "
            'python -c "import secrets; print(secrets.token_hex(32))" -- see DEPLOYMENT.md.'
        )
    import warnings

    warnings.warn(
        "SECRET_KEY is a placeholder value. Fine for local dev, but sessions signed with it "
        "can be forged by anyone who has read this repo. Generate a real key before any "
        "deployment reachable by anyone but you.",
        stacklevel=1,
    )
