from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
import time
import unittest
from unittest.mock import patch

from app.inference import ocr_parallel as p


class ParallelOCRTests(unittest.TestCase):
    def test_out_of_order_completion_keeps_input_order(self):
        with ThreadPoolExecutor(max_workers=3) as executor:
            with patch.object(p, "_executor", executor), patch.object(p, "OCR_CONCURRENCY", 3):
                def recognize(i):
                    time.sleep(0.02 if i % 2 == 0 else 0.001)
                    return (str(i), i / 10)
                self.assertEqual(list(p.ordered_recognize(range(8), recognize)),
                                 [(str(i), i / 10) for i in range(8)])

    def test_two_sessions_share_three_threads_not_six(self):
        lock = Lock()
        active = peak = 0
        overlap = Event()
        def recognize(i):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(active, peak)
                if active == 3:
                    overlap.set()
            overlap.wait(2)
            time.sleep(0.005)
            with lock:
                active -= 1
            return i
        with ThreadPoolExecutor(max_workers=3) as executor:
            with patch.object(p, "_executor", executor), patch.object(p, "OCR_CONCURRENCY", 3):
                with ThreadPoolExecutor(max_workers=2) as sessions:
                    runs = [sessions.submit(lambda: list(p.ordered_recognize(range(5), recognize)))
                            for _ in range(2)]
                    self.assertEqual([r.result() for r in runs], [list(range(5))] * 2)
        self.assertEqual(peak, 3)

    def test_cancellation_stops_dispatch_and_returns_promptly(self):
        stop = Event()
        release = Event()
        started = Event()
        calls = []
        def recognize(i):
            calls.append(i)
            started.set()
            release.wait(2)
            return i
        def check():
            if stop.is_set():
                raise RuntimeError("cancelled")
        with ThreadPoolExecutor(max_workers=2) as executor:
            with patch.object(p, "_executor", executor), patch.object(p, "OCR_CONCURRENCY", 2):
                with ThreadPoolExecutor(max_workers=1) as caller:
                    run = caller.submit(lambda: list(p.ordered_recognize(range(30), recognize, check)))
                    self.assertTrue(started.wait(2))
                    stop.set()
                    try:
                        with self.assertRaisesRegex(RuntimeError, "cancelled"):
                            run.result(timeout=1)
                    finally:
                        release.set()
        self.assertLessEqual(len(calls), 2)

    def test_exception_propagates_without_reading_whole_input(self):
        consumed = []
        def crops():
            for i in range(100):
                consumed.append(i)
                yield i
        def fail(_):
            raise ValueError("bad crop")
        with ThreadPoolExecutor(max_workers=2) as executor:
            with patch.object(p, "_executor", executor), patch.object(p, "OCR_CONCURRENCY", 2):
                with self.assertRaisesRegex(ValueError, "bad crop"):
                    list(p.ordered_recognize(crops(), fail))
        self.assertLessEqual(len(consumed), 2)

    def test_empty_and_sequential_and_progress(self):
        with ThreadPoolExecutor(max_workers=1) as executor:
            with patch.object(p, "_executor", executor), patch.object(p, "OCR_CONCURRENCY", 1):
                progress = []
                self.assertEqual(list(p.ordered_recognize([], str)), [])
                self.assertEqual(list(p.ordered_recognize([3, 1], str,
                                 on_result=lambda: progress.append(1))), ["3", "1"])
                self.assertEqual(len(progress), 2)


if __name__ == "__main__":
    unittest.main()
