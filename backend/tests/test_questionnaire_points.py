import unittest
from pydantic import ValidationError
from app.schemas import AnswerKeyItemIn


class QuestionnairePointTests(unittest.TestCase):
    def test_points_bounds(self):
        for points in (1, 3, 10):
            self.assertEqual(AnswerKeyItemIn(item_no=1, type='Identification', correct_answer='OCR', points=points).points, points)
        for points in (0, -1, 0.5, 1.5, 3.01, 11, float('inf'), float('nan')):
            with self.assertRaises(ValidationError):
                AnswerKeyItemIn(item_no=1, type='Identification', correct_answer='OCR', points=points)

    def test_threshold_unchanged(self):
        item = AnswerKeyItemIn(item_no=1, type='Identification', correct_answer='OCR')
        self.assertEqual(item.fuzzy_threshold, 85)


if __name__ == '__main__':
    unittest.main()
