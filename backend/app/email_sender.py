"""Sends the 6-digit verification/reset codes by email.

Uses Gmail SMTP with an app password -- see backend/SETUP.md for how to
generate one. The app password is what lets this server authenticate to
Gmail and send mail at all; it is unrelated to the 6-digit codes
themselves, which are generated fresh per request in app/security.py
and are the thing a teacher actually reads and types back into the app.
"""

import smtplib
from email.message import EmailMessage

from app.config import settings

SUBJECTS = {
    "verify_email": "Verify your email - Automated Grading System",
    "reset_password": "Password reset code - Automated Grading System",
}

BODY_TEMPLATES = {
    "verify_email": (
        "Your verification code is: {code}\n\n"
        "Enter this code in the app to verify your email address.\n"
        "This code expires in 10 minutes. If you didn't request this, you can ignore this email."
    ),
    "reset_password": (
        "Your password reset code is: {code}\n\n"
        "Enter this code in the app to set a new password.\n"
        "This code expires in 10 minutes. If you didn't request this, you can ignore this email "
        "-- your password will not be changed."
    ),
}


def send_code_email(to_address: str, code: str, purpose: str) -> None:
    message = EmailMessage()
    message["Subject"] = SUBJECTS[purpose]
    message["From"] = settings.smtp_from_email
    message["To"] = to_address
    message.set_content(BODY_TEMPLATES[purpose].format(code=code))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.starttls()
        server.login(settings.smtp_user, settings.smtp_app_password)
        server.send_message(message)
