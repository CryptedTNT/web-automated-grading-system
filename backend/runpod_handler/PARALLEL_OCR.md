# Up to three concurrent OCR requests per submission

This is client-side concurrency, not a model or grading change. The existing
single-image RunPod handler is unchanged. Configure the Azure backend:

```env
USE_RUNPOD=true
RUNPOD_OCR_CONCURRENCY=3
```

Restart `ags-backend` after installing the updated backend files. Set RunPod
max workers to 3; active workers may remain 0. Concurrency defaults to 1 and
is capped at 3. Set it back to 1 and restart to disable parallel dispatch.

The shared thread pool limits OCR across teacher sessions **in one Python
process**. The supplied systemd service uses one Uvicorn process. Do not add
multiple Uvicorn/Gunicorn workers or replicas without a distributed limiter;
each process would otherwise have its own three-request allowance.

New crops are dispatched when any request completes, without waiting for an
earlier slow answer. Completed text/confidence results are buffered by crop
index (up to the submission's crop count); pending requests remain bounded.
Results are consumed in crop order before the existing positional and
enumeration grading logic. Local fallback is serialized to avoid model-load
races. Cancellation stops new dispatch and cancels queued work; up to three
HTTP requests already executing cannot be recalled and finish under the
existing timeout. A remote timeout can still leave a server-side job running,
as with the previous implementation. There is no automatic retry added here.

## Validation and release

Run `python -m unittest discover -s tests -p 'test_ocr_parallel.py' -v` and
`python -m unittest discover -s tests -p 'test_parallel_pipeline.py' -v`
from `backend/`. Tests use mocked OCR, not paid inference. They cover shared
limits, out-of-order completion, cancellation, exceptions, and exact pipeline
parity including identity, enumeration, missing answers, and review flags.

Before a real test, compare the same papers with concurrency 1, 2 and 3, recording
end-to-end time, cold starts, OCR output, score parity, and RunPod cost. No speed
gain is guaranteed. This change alone does not parallelize student uploads or
YOLO detection. The local implementation is not automatically deployed.
