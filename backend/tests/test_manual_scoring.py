from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas import ReviewRequest
from app.routers import results


class ManualScoringTests(unittest.TestCase):
    def review(self, score):
        result = SimpleNamespace(item_id=1, recognized_id=None, status='flagged', match_score=80, score=0, auto_score=0, auto_status='flagged')
        item = SimpleNamespace(points=Decimal('3'))
        added = []
        db = SimpleNamespace(get=lambda model, ident: item, add=added.append, scalar=lambda query: None, commit=lambda: None)
        with patch.object(results, '_owned_result', return_value=result):
            results.review_result(1, ReviewRequest(action='manual_score_override', awarded_score=score), SimpleNamespace(faculty_id=1), db)
        return result, added

    def test_two_out_of_three_is_partial_and_preserves_automatic_result(self):
        result, added = self.review(2)
        self.assertEqual(result.score, Decimal('2'))
        self.assertEqual(result.status, 'partial')
        self.assertEqual(result.auto_score, 0)
        self.assertEqual(result.auto_status, 'flagged')
        review = added[-1]
        self.assertEqual(review.final_score, Decimal('2'))
        self.assertEqual(review.override_action, 'manual_score_override')

    def test_zero_and_full_points_are_resolved(self):
        self.assertEqual(self.review(0)[0].status, 'incorrect')
        self.assertEqual(self.review(3)[0].status, 'correct')
        self.assertEqual(self.review('2.25')[0].score, Decimal('2.25'))

    def test_over_maximum_and_missing_score_are_rejected(self):
        for score in (4, None):
            with self.assertRaises(HTTPException):
                self.review(score)

    def test_invalid_precision_negative_and_nonfinite_are_rejected(self):
        for score in (-1, '2.001', 'NaN', 'Infinity'):
            with self.assertRaises(ValidationError):
                ReviewRequest(action='manual_score_override', awarded_score=score)


if __name__ == '__main__':
    unittest.main()
