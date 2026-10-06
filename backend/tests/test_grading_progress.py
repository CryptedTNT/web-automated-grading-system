import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.grading_progress import read_progress, report_progress
from app.inference import pipeline
from app.routers import sessions
from app.db import get_db
from app.security import get_current_faculty


class ProgressTests(unittest.TestCase):
    def test_progress_is_monotonic_and_scoped_to_token_and_session(self):
        token = uuid4()
        report_progress(1, token, 0.5, 'Recognizing')
        report_progress(1, token, 0.2, 'Detecting')
        self.assertEqual(read_progress(1, token)['fraction'], 0.5)
        self.assertEqual(read_progress(2, token)['fraction'], 0)
        self.assertEqual(read_progress(1, uuid4())['fraction'], 0)

    def test_pipeline_reports_work_before_entire_submission_finishes(self):
        updates = []
        dets = [SimpleNamespace(field_name=None, y_center=y, bbox=(0, y, 20, y + 10), polygon=None) for y in (0, 20)]
        items = [SimpleNamespace(item_id=i, item_no=i, question_type='TF', correct_answer='TRUE', alternative_answers=None, points=1) for i in (1, 2)]
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'page.png'
            Image.new('RGB', (40, 50), 'white').save(image)
            with patch.object(pipeline, 'detect_regions', return_value=dets), patch.object(pipeline.recognizer, 'recognize_text', return_value=('TRUE', 1)):
                result = pipeline.run_sheet_group([str(image)], items, Path(directory) / 'crops', 'test', on_progress=lambda value, stage: updates.append((value, stage)))
        self.assertEqual(len(result['answers']), 2)
        fractions = [value for value, _ in updates]
        self.assertEqual(fractions, sorted(fractions))
        self.assertTrue(any(0.2 < value < 0.95 for value in fractions))
        self.assertEqual(fractions[-1], 0.95)

    def test_progress_endpoint_enforces_ownership(self):
        app = FastAPI()
        app.include_router(sessions.router)
        app.dependency_overrides[get_current_faculty] = lambda: SimpleNamespace(faculty_id=2)
        app.dependency_overrides[get_db] = lambda: object()
        with patch.object(sessions, '_owned_session', side_effect=HTTPException(404, 'Not found')):
            response = TestClient(app).get(f'/sessions/1/progress/{uuid4()}')
        self.assertEqual(response.status_code, 404)


if __name__ == '__main__':
    unittest.main()
