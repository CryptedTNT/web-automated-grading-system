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
