"""Bounded, ordered OCR scheduling shared by sessions in one backend process."""
from collections import deque
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import os

# Keep the limit conservative: three RunPod workers, not one pool per teacher.
OCR_CONCURRENCY = max(1, min(3, int(os.getenv("RUNPOD_OCR_CONCURRENCY", "1"))))
_executor = ThreadPoolExecutor(max_workers=OCR_CONCURRENCY, thread_name_prefix="ocr")


def ordered_recognize(crops, recognize, check_stop=lambda: None, on_result=None):
    """Yield input-ordered results, with only a small window of pending jobs.

    Cancellation stops new dispatch and cancels queued futures. Already-running
    HTTP requests cannot be recalled; they finish under their configured timeout.
    """
    pending = deque()
    iterator = iter(crops)

    def submit_next():
        check_stop()
        try:
            crop = next(iterator)
        except StopIteration:
            return False

        def run():
            check_stop()
            return recognize(crop)

        pending.append(_executor.submit(run))
        return True

    try:
        for _ in range(OCR_CONCURRENCY):
            if not submit_next():
                break
        while pending:
            check_stop()
            future = pending[0]
            while True:
                check_stop()
                try:
                    result = future.result(timeout=0.1)
                    break
                except TimeoutError:
                    if future.done():
                        raise
            pending.popleft()
            check_stop()
            if on_result:
                on_result()
            yield result
            submit_next()
    finally:
        for future in pending:
            future.cancel()
