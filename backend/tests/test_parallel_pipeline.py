from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import tempfile
import time
import unittest

from PIL import Image
from app.inference import pipeline, ocr_parallel


class PipelineParallelParityTests(unittest.TestCase):
    def test_remote_matches_sequential_grading_identity_and_saved_crops(self):
        # Include multi-page answers, enumeration reordering, a low-confidence
        # answer, a missing detection, and a crossed-out answer.
        words = {1: ("TRUE", 1.0), 2: ("B", 0.3), 3: ("blue", 1.0),
                 4: ("red", 1.0), 5: ("Ada", 1.0), 6: ("CCS", 1.0)}
        def det(i, field=None):
            return SimpleNamespace(field_name=field, y_center=i, bbox=(i, 0, i+1, 1), polygon=None)
        pages = [[det(5, "name"), det(6, "section"), det(1), det(2)], [det(3), det(4)]]
        def item(i, qtype, answer):
            return SimpleNamespace(item_id=i, item_no=i, question_type=qtype,
                                   correct_answer=answer, alternative_answers=None,
                                   fuzzy_threshold=85, points=1, enum_group=1)
        items = [item(1, "TF", "TRUE"), item(2, "MC", "B"),
                 item(3, "ENUMERATION", "red"), item(4, "ENUMERATION", "blue"),
                 item(5, "IDENTIFICATION", "missing")]
        def crop(_image, bbox, _polygon):
            return Image.new("RGB", (4, 4), (bbox[0], 0, 0))
        def recognize(image):
            i = image.getpixel((0, 0))[0]
            time.sleep(0.015 if i % 2 else 0.001)
            return words[i]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = []
            for i in range(2):
                path = root / f"page{i}.png"
                Image.new("RGB", (20, 20), "white").save(path)
                files.append(str(path))
            with patch.object(pipeline, "_crop", crop), \
                 patch.object(pipeline.recognizer, "recognize_text", recognize), \
                 patch.object(pipeline, "has_strikethrough", create=True,
                              side_effect=lambda im: im.getpixel((0, 0))[0] == 1):
                def run(remote):
                    updates = []
                    with patch.object(pipeline.recognizer, "USE_RUNPOD", remote), \
                         patch.object(pipeline, "detect_regions", side_effect=pages):
                        result = pipeline.run_sheet_group(files, items, root / "crops", "sheet",
                            on_progress=lambda n, _stage: updates.append(n))
                    self.assertEqual(updates, sorted(updates))
                    self.assertTrue(all(Path(a['crop_path']).exists() for a in result['answers'] if a['crop_path']))
                    return result
                baseline = run(False)
                with ThreadPoolExecutor(max_workers=3) as executor:
                    with patch.object(ocr_parallel, "_executor", executor), \
                         patch.object(ocr_parallel, "OCR_CONCURRENCY", 3):
                        parallel = run(True)
                self.assertEqual(parallel, baseline)
                self.assertEqual(parallel['identity'], {'name': 'Ada', 'section': 'CCS'})
                by_item = {a['item_id']: a for a in parallel['answers']}
                self.assertEqual(by_item[1]['recognized_text'], 'TRUE')
                self.assertEqual(by_item[2]['recognized_text'], 'B')
                self.assertEqual(by_item[3]['recognized_text'], 'red')
                self.assertEqual(by_item[4]['recognized_text'], 'blue')
                self.assertIsNone(by_item[5]['recognized_text'])
                with Image.open(by_item[3]['crop_path']) as saved:
                    self.assertEqual(saved.getpixel((0, 0))[0], 4)
                with Image.open(by_item[4]['crop_path']) as saved:
                    self.assertEqual(saved.getpixel((0, 0))[0], 3)

    def test_failed_remote_requests_use_serial_local_fallback(self):
        from threading import Lock
        from app.inference import recognizer
        guard = Lock()
        active = peak = 0
        class Pixels:
            def to(self, _device):
                return self
        processor = lambda **_kwargs: SimpleNamespace(pixel_values=Pixels())
        def decode(_pixels, num_beams):
            nonlocal active, peak
            with guard:
                active += 1
                peak = max(active, peak)
            time.sleep(0.01)
            with guard:
                active -= 1
            return ('local answer', 1.0)
        with patch.object(recognizer, 'USE_RUNPOD', True), \
             patch.object(recognizer, '_recognize_via_runpod', return_value=None), \
             patch.object(recognizer, '_load', return_value=(processor, None)), \
             patch.object(recognizer, '_decode', decode):
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(recognizer.recognize_text,
                                           [Image.new('RGB', (4, 4)) for _ in range(4)]))
        self.assertEqual(results, [('local answer', 1.0)] * 4)
        self.assertEqual(peak, 1)


if __name__ == "__main__":
    unittest.main()
