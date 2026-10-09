import datetime
import io
import unittest

import numpy as np
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.inference.strikethrough import has_strikethrough
from app.models import ClassSection, ExamSheet, RosterStudent, StudentInfo
from app.roster import find_duplicate_sheet, find_section_id, match_name, normalize_name, resolve_identity, same_name
from app.roster_import import RosterImportError, extract_names_from_excel, find_text_lines


def _xlsx(rows):
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


class NameMatchingTests(unittest.TestCase):
    roster = [(1, "Jeremy Race"), (2, "Maria Santos"), (3, "Juan Dela Cruz")]

    def test_exact_match_ignores_case_spacing_punctuation_and_word_order(self):
        self.assertTrue(same_name("  jeremy   RACE ", "Jeremy Race"))
        self.assertTrue(same_name("Race Jeremy", "Jeremy Race"))
        self.assertTrue(same_name("Pedro Reyes, Jr.", "Pedro Reyes Jr"))
        match = match_name("juan dela cruz", self.roster)
        self.assertEqual((match.status, match.roster_id), ("matched", 3))

    def test_close_spelling_is_suggested_for_confirmation_not_applied(self):
        match = match_name("Jeremy Rave", self.roster)
        self.assertEqual(match.status, "suggested")
        self.assertEqual(match.roster_id, 1)
        self.assertGreaterEqual(match.score, 80)

    def test_unrelated_name_is_unmatched(self):
        match = match_name("Zelda Quinn", self.roster)
        self.assertEqual((match.status, match.roster_id), ("unmatched", None))

    def test_two_close_candidates_are_never_suggested(self):
        roster = [(10, "Ana Cruz"), (11, "Ana Cruzz")]
        match = match_name("Ana Cruzs", roster)
        self.assertEqual(match.status, "unmatched")
        self.assertIsNone(match.roster_id)

    def test_duplicate_exact_names_need_the_teacher_to_choose(self):
        roster = [(20, "Lea Tan"), (21, "Lea Tan")]
        self.assertEqual(match_name("Lea Tan", roster).status, "unmatched")

    def test_blank_name_is_unmatched(self):
        self.assertEqual(match_name("", self.roster).status, "unmatched")
        self.assertEqual(normalize_name("  "), "")

    def test_section_compares_canonical_form_exactly(self):
        sections = [(1, "BSCS 1-A"), (2, "BSCS 1-B")]
        self.assertEqual(find_section_id(sections, "BSCS 1A"), 1)
        self.assertEqual(find_section_id(sections, "BSCS 1 - B"), 2)
        self.assertIsNone(find_section_id(sections, "BSCS 1-C"))
        self.assertIsNone(find_section_id(sections, "M"))


class ResolveIdentityTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine, tables=[ClassSection.__table__, RosterStudent.__table__])
        self.db = Session(engine)
        now = datetime.datetime(2026, 10, 7)
        a = ClassSection(faculty_id=1, section_name="BSCS 1-A", created_at=now)
        b = ClassSection(faculty_id=1, section_name="BSCS 1-B", created_at=now)
        self.db.add_all([a, b])
        self.db.flush()
        self.db.add_all([
            RosterStudent(section_id=a.section_id, full_name="Jeremy Race", position=1, created_at=now),
            RosterStudent(section_id=a.section_id, full_name="Maria Santos", position=2, created_at=now),
            RosterStudent(section_id=b.section_id, full_name="Pedro Reyes", position=1, created_at=now),
        ])
        self.db.commit()
        self.section_a = a.section_id
        self.section_b = b.section_id

    def tearDown(self):
        self.db.close()

    def test_exact_name_in_detected_section(self):
        result = resolve_identity(self.db, 1, "Maria Santos", "BSCS 1A")
        self.assertEqual(result["roster_status"], "matched")
        self.assertEqual(result["section_id"], self.section_a)
        self.assertEqual(result["section"], "BSCS 1-A")

    def test_unclear_section_searches_every_section_by_name(self):
        result = resolve_identity(self.db, 1, "Pedro Reyes", "M")
        self.assertEqual(result["roster_status"], "matched")
        self.assertEqual(result["section_id"], self.section_b)
        self.assertEqual(result["section"], "BSCS 1-B")
        self.assertEqual(result["name"], "Pedro Reyes")

    def test_section_not_on_list_with_close_name_is_suggested_across_sections(self):
        result = resolve_identity(self.db, 1, "Jeremy Rave", "BSCS 9-Z")
        self.assertEqual(result["roster_status"], "suggested")
        self.assertEqual(result["section_id"], self.section_a)
        self.assertEqual(result["name"], "Jeremy Rave")
        self.assertEqual(result["detected_name"], "Jeremy Rave")

    def test_name_on_no_list_is_unmatched_and_keeps_detected_text(self):
        result = resolve_identity(self.db, 1, "Zelda Quinn", "M")
        self.assertEqual(result["roster_status"], "unmatched")
        self.assertIsNone(result["section_id"])
        self.assertEqual(result["name"], "Zelda Quinn")

    def test_teacher_without_sections_gets_no_check(self):
        result = resolve_identity(self.db, 2, "Anyone", "BSCS 1-A")
        self.assertIsNone(result["roster_status"])
        self.assertIsNone(result["roster_id"])


class DuplicateDetectionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine, tables=[ExamSheet.__table__, StudentInfo.__table__])
        self.db = Session(engine)
        self.now = datetime.datetime(2026, 10, 7)

    def tearDown(self):
        self.db.close()

    def _sheet(self, session_id, answer_key_id, offset_minutes=0):
        sheet = ExamSheet(
            session_id=session_id,
            answer_key_id=answer_key_id,
            sheet_code=f"AGS-TEST-{session_id}-{offset_minutes}",
            upload_date=self.now + datetime.timedelta(minutes=offset_minutes),
        )
        self.db.add(sheet)
        self.db.flush()
        return sheet.sheet_id

    def _info(self, sheet_id, name, roster_id=None):
        self.db.add(StudentInfo(sheet_id=sheet_id, name=name, roster_id=roster_id, consent_status="consented"))
        self.db.flush()

    def test_same_roster_student_on_the_same_questionnaire_is_a_duplicate(self):
        first = self._sheet(session_id=1, answer_key_id=10)
        self._info(first, "Jeremy Race", roster_id=5)
        second = self._sheet(session_id=2, answer_key_id=10, offset_minutes=5)

        found = find_duplicate_sheet(self.db, answer_key_id=10, roster_id=5, name="Jeremy Race", exclude_sheet_id=second)
        self.assertEqual(found, first)

    def test_same_roster_student_on_a_different_questionnaire_is_not_a_duplicate(self):
        first = self._sheet(session_id=1, answer_key_id=10)
        self._info(first, "Jeremy Race", roster_id=5)
        second = self._sheet(session_id=2, answer_key_id=11, offset_minutes=5)

        found = find_duplicate_sheet(self.db, answer_key_id=11, roster_id=5, name="Jeremy Race", exclude_sheet_id=second)
        self.assertIsNone(found)

    def test_falls_back_to_exact_normalised_name_when_there_is_no_roster_link(self):
        first = self._sheet(session_id=1, answer_key_id=10)
        self._info(first, "Maria Santos")  # no roster set up
        second = self._sheet(session_id=2, answer_key_id=10, offset_minutes=5)

        found = find_duplicate_sheet(self.db, answer_key_id=10, roster_id=None, name="  maria   SANTOS ", exclude_sheet_id=second)
        self.assertEqual(found, first)

    def test_a_close_but_not_exact_name_is_not_flagged_without_a_roster(self):
        first = self._sheet(session_id=1, answer_key_id=10)
        self._info(first, "Jeremy Race")
        second = self._sheet(session_id=2, answer_key_id=10, offset_minutes=5)

        # Unlike resolve_identity's suggestions, a bare name fallback never
        # guesses at a close spelling -- that risk belongs to a feature the
        # teacher explicitly confirms, not one that silently links sheets.
        found = find_duplicate_sheet(self.db, answer_key_id=10, roster_id=None, name="Jeremy Rave", exclude_sheet_id=second)
        self.assertIsNone(found)

    def test_a_repeated_duplicate_points_back_to_the_original_not_the_middle_one(self):
        first = self._sheet(session_id=1, answer_key_id=10)
        self._info(first, "Jeremy Race", roster_id=5)
        second = self._sheet(session_id=2, answer_key_id=10, offset_minutes=5)
        self._info(second, "Jeremy Race", roster_id=5)
        third = self._sheet(session_id=3, answer_key_id=10, offset_minutes=10)

        found = find_duplicate_sheet(self.db, answer_key_id=10, roster_id=5, name="Jeremy Race", exclude_sheet_id=third)
        self.assertEqual(found, first)

    def test_no_prior_sheet_is_not_a_duplicate(self):
        only = self._sheet(session_id=1, answer_key_id=10)
        found = find_duplicate_sheet(self.db, answer_key_id=10, roster_id=None, name="Nobody Yet", exclude_sheet_id=only)
        self.assertIsNone(found)


class ExcelImportTests(unittest.TestCase):
    def test_names_column_is_found_beside_an_id_column(self):
        names, column = extract_names_from_excel(_xlsx([
            ["No", "Student Name", "Section"],
            [1, "Juan Dela Cruz", "BSCS 1-A"],
            [2, "Maria Santos", "BSCS 1-A"],
            [3, "Jeremy Race", "BSCS 1-A"],
        ]))
        self.assertEqual(names, ["Juan Dela Cruz", "Maria Santos", "Jeremy Race"])
        self.assertEqual(column, "column B")

    def test_headerless_names_column_is_found(self):
        names, column = extract_names_from_excel(_xlsx([["Juan Dela Cruz"], ["Maria Santos"], ["Pedro Reyes, Jr."]]))
        self.assertEqual(names, ["Juan Dela Cruz", "Maria Santos", "Pedro Reyes, Jr."])
        self.assertEqual(column, "column A")

    def test_separate_first_and_last_name_columns_are_refused(self):
        with self.assertRaises(RosterImportError) as ctx:
            extract_names_from_excel(_xlsx([["First name", "Last name"], ["Juan", "Dela Cruz"], ["Maria", "Santos"]]))
        self.assertIn("More than one column", str(ctx.exception))

    def test_file_without_names_is_refused(self):
        with self.assertRaises(RosterImportError):
            extract_names_from_excel(_xlsx([["ID", "Score"], [101, 20], [102, 18]]))

    def test_unreadable_file_is_refused(self):
        with self.assertRaises(RosterImportError):
            extract_names_from_excel(b"not a spreadsheet")


class ListImageTests(unittest.TestCase):
    def _list_image(self, lines):
        image = Image.new("RGB", (900, 120 + 70 * len(lines)), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 36)
        for index, text in enumerate(lines):
            draw.text((40, 40 + 70 * index), text, font=font, fill="black")
        return image

    def test_each_printed_line_is_its_own_text_line_in_order(self):
        image = self._list_image(["Juan Dela Cruz", "Maria Santos", "Jeremy Race"])
        gray = np.array(image.convert("L"))
        from app.roster_import import _erase_rules

        ink, _ = _erase_rules(255 - gray)
        boxes = find_text_lines(ink)
        self.assertEqual(len(boxes), 3)
        tops = [box[1] for box in boxes]
        self.assertEqual(tops, sorted(tops))


class StrikethroughTests(unittest.TestCase):
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 44)

    def _word(self, word, strike=False, underline=False):
        image = Image.new("RGB", (360, 110), "white")
        draw = ImageDraw.Draw(image)
        left, top, right, bottom = draw.textbbox((20, 20), word, font=self.font)
        draw.text((20, 20), word, font=self.font, fill="black")
        if strike:
            draw.line((left - 6, (top + bottom) // 2, right + 6, (top + bottom) // 2), fill="black", width=4)
        if underline:
            draw.line((left - 6, bottom + 6, right + 6, bottom + 6), fill="black", width=3)
        return image.crop((left - 10, top - 10, right + 10, bottom + 14))

    def test_struck_answers_are_detected(self):
        self.assertTrue(has_strikethrough(self._word("TRUE", strike=True)))
        self.assertTrue(has_strikethrough(self._word("FALSE", strike=True)))
        self.assertTrue(has_strikethrough(self._word("TRUE", strike=True, underline=True)))
        self.assertTrue(has_strikethrough(self._word("Java Layer", strike=True)))

    def test_plain_and_underlined_answers_are_not_flagged(self):
        self.assertFalse(has_strikethrough(self._word("TRUE")))
        self.assertFalse(has_strikethrough(self._word("TRUE", underline=True)))
        self.assertFalse(has_strikethrough(self._word("Information Technology", underline=True)))
        self.assertFalse(has_strikethrough(self._word("Java Layer")))

    def test_blank_crop_is_not_flagged(self):
        self.assertFalse(has_strikethrough(Image.new("RGB", (200, 60), "white")))


if __name__ == "__main__":
    unittest.main()
