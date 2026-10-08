"""Bounded, ordered OCR scheduling shared by sessions in one backend process."""
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import os

# Keep the limit conservative: three RunPod workers, not one pool per teacher.
OCR_CONCURRENCY = max(1, min(3, int(os.getenv("RUNPOD_OCR_CONCURRENCY", "1"))))
_executor = ThreadPoolExecutor(max_workers=OCR_CONCURRENCY, thread_name_prefix="ocr")


def ordered_recognize(crops, recognize, check_stop=lambda: None, on_result=None):
    """Refill on any completion; buffer results to yield them in crop order.

    Cancellation stops new dispatch and cancels queued futures. Already-running
    HTTP requests cannot be recalled; they finish under their configured timeout.
    """
    pending = {}
    completed = {}
    submitted = next_result = 0
    iterator = iter(crops)

    def submit_next():
        nonlocal submitted
        check_stop()
        try:
            crop = next(iterator)
        except StopIteration:
            return False

        def run():
            check_stop()
            return recognize(crop)

        pending[_executor.submit(run)] = submitted
        submitted += 1
        return True

    try:
        for _ in range(OCR_CONCURRENCY):
            if not submit_next():
                break
        while pending:
            check_stop()
            done, _ = wait(pending, timeout=0.1, return_when=FIRST_COMPLETED)
            check_stop()
            # Resolve the whole completion set before dispatching replacements:
            # a failure must not trigger additional paid requests.
            for future in done:
                completed[pending.pop(future)] = future.result()
                if on_result:
                    on_result()
            for _ in done:
                if not submit_next():
                    break
            while next_result in completed:
                check_stop()
                yield completed.pop(next_result)
                next_result += 1
    finally:
        for future in pending:
            future.cancel()
