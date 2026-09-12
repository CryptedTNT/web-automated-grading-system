"""Answer key endpoints. See INTEGRATION_CONTRACT.md section 4
"Answer keys". Every write is scoped `WHERE faculty_id = :fid` --
without that, any signed-in user could edit anyone's key by guessing
an id.
"""

import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AnswerKey, AnswerKeyItem, Faculty
from app.schemas import AnswerKeyCreateRequest, AnswerKeyUpdateRequest, ReplaceAnswerKeyItemsRequest
from app.security import get_current_faculty
from app.utils import QUESTION_TYPE_TO_LABEL, question_type_to_code

router = APIRouter(prefix="/answer-keys", tags=["answer-keys"])


def _key_shape(k: AnswerKey) -> dict:
    return {"id": k.answer_key_id, "name": k.title, "subject": k.subject, "created_at": k.created_at}


def _item_shape(i: AnswerKeyItem) -> dict:
    return {
        "item_no": i.item_no,
        "type": QUESTION_TYPE_TO_LABEL.get(i.question_type, i.question_type),
        "enum_group": i.enum_group,
        "question_text": i.question_text or "",
        "choices": i.choices,
        "correct_answer": i.correct_answer,
        "alternatives": i.alternative_answers or "",
        "points": float(i.points),
        "fuzzy_threshold": float(i.fuzzy_threshold) if i.fuzzy_threshold is not None else 85.0,
    }


def _owned_key(key_id: int, faculty: Faculty, db: Session) -> AnswerKey:
    key = db.scalar(
        select(AnswerKey).where(AnswerKey.answer_key_id == key_id, AnswerKey.faculty_id == faculty.faculty_id)
    )
    if not key:
        raise HTTPException(status_code=404, detail="Answer key not found.")
    return key


@router.get("")
def list_answer_keys(faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    keys = db.scalars(
        select(AnswerKey).where(AnswerKey.faculty_id == faculty.faculty_id).order_by(AnswerKey.answer_key_id.desc())
    )
    return [_key_shape(k) for k in keys]


@router.post("", status_code=201)
def create_answer_key(
    body: AnswerKeyCreateRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    now = datetime.datetime.utcnow()
    key = AnswerKey(
        faculty_id=faculty.faculty_id,
        title=body.name or "Untitled Answer Key",
        subject=body.subject or "General",
        created_at=now,
        updated_at=now,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return {"id": key.answer_key_id}


@router.patch("/{key_id}")
def update_answer_key(
    key_id: int,
    body: AnswerKeyUpdateRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    key = _owned_key(key_id, faculty, db)
    key.title = body.name or "Untitled Answer Key"
    key.subject = body.subject or "General"
    db.add(key)
    db.commit()
    return _key_shape(key)


@router.delete("/{key_id}", status_code=204)
def delete_answer_key(key_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    key = _owned_key(key_id, faculty, db)
    # Deleting the key cascades to its items (fk_item_answerkey ON DELETE
    # CASCADE) -- but those items are RESTRICT-protected by fk_answer_item
    # / fk_result_item (V002) the moment any sheet has been graded with
    # this key, same underlying conflict as replace_items()'s DELETE
    # above. The cascade fails partway with an IntegrityError there,
    # which used to surface as a raw 500 here.
    db.delete(key)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Could not delete: this answer key has graded sessions, and their results are tied "
            "to its items. Delete the session(s) that used it first, then delete this key.",
        )


@router.get("/{key_id}/items")
def list_items(key_id: int, faculty: Faculty = Depends(get_current_faculty), db: Session = Depends(get_db)):
    _owned_key(key_id, faculty, db)  # 404s if not this faculty's key
    items = db.scalars(
        select(AnswerKeyItem).where(AnswerKeyItem.answer_key_id == key_id).order_by(AnswerKeyItem.item_no)
    )
    return [_item_shape(i) for i in items]


@router.put("/{key_id}/items")
def replace_items(
    key_id: int,
    body: ReplaceAnswerKeyItemsRequest,
    faculty: Faculty = Depends(get_current_faculty),
    db: Session = Depends(get_db),
):
    _owned_key(key_id, faculty, db)

    # answer_key_item has a UNIQUE (answer_key_id, item_no) constraint --
    # catching this here first gives a clean, specific message instead of
    # letting it surface as a raw IntegrityError -> 500 from db.commit()
    # below (which is exactly what happened before the frontend's own
    # renumbering bug in AnswerKeyView.vue's collectItems() was fixed).
    item_numbers = [item.item_no for item in body.items]
    if len(set(item_numbers)) != len(item_numbers):
        raise HTTPException(
            status_code=400, detail="Two or more items share the same item number: each must be unique."
        )

    # DELETE then bulk INSERT, staged in the session and committed together
    # as one transaction -- nothing hits the table until db.commit() below.
    #
    # The DELETE itself (not just the later commit) can fail: fk_answer_item
    # and fk_result_item (V002) are ON DELETE RESTRICT on purpose, so a
    # student_answer/grading_result row can never lose track of which
    # question it was actually scored against. That means once any sheet
    # has been graded with this key, its current items can't be wholesale
    # replaced anymore -- the DELETE below raises IntegrityError immediately,
    # before db.commit() is ever reached, which is why an earlier version of
    # this try/except (wrapping only db.commit()) never actually caught it.
    try:
        db.query(AnswerKeyItem).filter(AnswerKeyItem.answer_key_id == key_id).delete()
        for item in body.items:
            code = question_type_to_code(item.type)
            db.add(
                AnswerKeyItem(
                    answer_key_id=key_id,
                    item_no=item.item_no,
                    question_type=code,
                    enum_group=item.enum_group if code == "ENUMERATION" else None,
                    question_text=item.question_text or None,
                    choices=item.choices if code == "MC" else None,
                    correct_answer=item.correct_answer,
                    alternative_answers=item.alternatives or None,
                    fuzzy_threshold=item.fuzzy_threshold,
                    points=item.points,
                )
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Could not save: this answer key already has graded sheets, and their results are "
            "tied to its current items, so they can't be fully replaced. Delete the session(s) that used "
            "this answer key first, or create a new answer key instead of editing this one.",
        )
    return {"ok": True}
