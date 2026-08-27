"""Label<->code maps and small helpers shared by more than one router.
See database/APP_MAPPING.md section 2 for why these mappings exist --
the app stores/shows display labels, the database stores codes."""

QUESTION_TYPE_TO_CODE = {
    "Multiple Choice": "MC",
    "True or False": "TF",
    "Identification": "IDENTIFICATION",
    "Enumeration": "ENUMERATION",
}
QUESTION_TYPE_TO_LABEL = {code: label for label, code in QUESTION_TYPE_TO_CODE.items()}

STATUS_TO_CODE = {
    "OK": "correct",
    "Wrong": "incorrect",
    "Flagged": "flagged",
}
STATUS_TO_LABEL = {code: label for label, code in STATUS_TO_CODE.items()}

SESSION_STATUS_TO_CODE = {
    "Processing": "processing",
    "Completed": "completed",
    "Cancelled": "cancelled",
    "Failed": "failed",
}
SESSION_STATUS_TO_LABEL = {code: label for label, code in SESSION_STATUS_TO_CODE.items()}


def question_type_to_code(label_or_code: str) -> str:
    """Accepts either a UI label ("Multiple Choice") or an already-valid
    code ("MC") so callers that already have a code don't need a branch."""
    if label_or_code in QUESTION_TYPE_TO_LABEL:
        return label_or_code
    return QUESTION_TYPE_TO_CODE.get(label_or_code, "IDENTIFICATION")


def make_sheet_code(session_id: int, sequence: int) -> str:
    """De-identified handle for a sheet, e.g. AGS-0001-0003.
    See database/migrations/V002__sheets_recognition_and_grading.sql."""
    return f"AGS-{session_id:04d}-{sequence:04d}"
