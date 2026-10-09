from types import SimpleNamespace
import unittest

from app.inference.grading import best_item_similarity, match_enumeration_answers


def _item(item_id, correct_answer, alternatives=None, points=1, fuzzy_threshold=85, enum_group=1):
    return SimpleNamespace(
        item_id=item_id,
        correct_answer=correct_answer,
        alternative_answers=alternatives,
        points=points,
        fuzzy_threshold=fuzzy_threshold,
        enum_group=enum_group,
    )


class BestItemSimilarityTests(unittest.TestCase):
    def test_plain_exact_match_is_unaffected(self):
        item = _item(1, "Virtual Machines")
        self.assertGreaterEqual(best_item_similarity(item, "Virtual Machines"), 99.99)

    def test_an_alternative_is_matched_as_well_as_the_main_answer(self):
        item = _item(1, "Virtual Machines", alternatives="Cloud Platform, VMs")
        self.assertGreaterEqual(best_item_similarity(item, "Cloud Platform"), 99.99)

    def test_a_slash_joined_answer_credits_either_phrasing(self):
        # The screenshot's exact case: one blank answered as "A / B" where
        # only one side is the key's main correct_answer.
        item = _item(1, "Virtual Machines")
        self.assertGreaterEqual(best_item_similarity(item, "Virtual Machines / Cloud Platform"), 99.99)
        self.assertGreaterEqual(best_item_similarity(item, "Cloud Platform / Virtual Machines"), 99.99)

    def test_a_slash_joined_answer_also_checks_against_alternatives(self):
        item = _item(1, "Virtual Machines", alternatives="Cloud Platform")
        self.assertGreaterEqual(best_item_similarity(item, "Something Else / Cloud Platform"), 99.99)

    def test_a_slash_joined_answer_with_no_matching_side_is_not_inflated(self):
        item = _item(1, "Virtual Machines")
        score = best_item_similarity(item, "Totally Unrelated / Also Unrelated")
        self.assertLess(score, 50)

    def test_the_whole_text_is_still_tried_even_when_it_contains_a_slash(self):
        # A legitimate slash-containing correct answer (e.g. "I/O") must
        # still match the text as written, not only its split pieces.
        item = _item(1, "I/O")
        self.assertGreaterEqual(best_item_similarity(item, "I/O"), 99.99)


class MatchEnumerationAnswersTests(unittest.TestCase):
    def test_a_slash_joined_answer_is_graded_correct_not_incorrect(self):
        items = [_item(1, "Virtual Machines", points=1)]
        result = match_enumeration_answers(items, ["Virtual Machines / Cloud Platform"])
        slot = result["per_slot"][0]
        self.assertTrue(slot.is_exact)
        self.assertEqual(slot.earned, 1)

    def test_a_slash_joined_answer_with_a_declared_alternative_is_correct(self):
        items = [_item(1, "Virtual Machines", alternatives="Cloud Platform", points=1)]
        result = match_enumeration_answers(items, ["Cloud Platform / Something Unrelated To This Key"])
        slot = result["per_slot"][0]
        self.assertTrue(slot.is_exact)
        self.assertEqual(slot.earned, 1)

    def test_an_unrelated_slash_joined_answer_is_still_incorrect_or_flagged_not_silently_correct(self):
        items = [_item(1, "Virtual Machines", points=1, fuzzy_threshold=85)]
        result = match_enumeration_answers(items, ["Totally Unrelated / Also Unrelated"])
        slot = result["per_slot"][0]
        self.assertFalse(slot.is_exact)
        self.assertEqual(slot.earned, 0)


if __name__ == "__main__":
    unittest.main()
