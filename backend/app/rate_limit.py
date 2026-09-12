"""A tiny in-process rate limiter for the auth endpoints that are
otherwise guessable: login passwords, and the 6-digit email
verification/password-reset codes.

Deliberately not backed by Redis or a DB table -- this app runs as a
single uvicorn worker (see deploy/ags-backend.service, no --workers
flag), so a plain in-memory counter is already visible to every
request with no extra infrastructure. If this is ever run with
multiple worker processes, each would keep its own counters and the
limit would effectively multiply -- switch to a shared store first.
"""

import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException

_attempts: dict[str, list[float]] = defaultdict(list)
_lock = Lock()


def check_rate_limit(key: str, max_attempts: int, window_seconds: int) -> None:
    """Raises 429 if `key` has already been attempted `max_attempts`
    times within the last `window_seconds`; otherwise records this
    attempt. Call once per attempt, before doing the sensitive check
    itself (verifying a password, checking a code) -- guessing wrong
    still counts against the limit, which is the whole point."""
    now = time.monotonic()
    cutoff = now - window_seconds
    with _lock:
        bucket = _attempts[key]
        while bucket and bucket[0] < cutoff:
            bucket.pop(0)
        if len(bucket) >= max_attempts:
            retry_after = int(bucket[0] + window_seconds - now) + 1
            raise HTTPException(
                status_code=429,
                detail="Too many attempts. Please wait before trying again.",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)


def reset_rate_limit(key: str) -> None:
    """Clears a key's attempt history -- call on a successful
    attempt so a few earlier typos don't count against whatever this
    account does next."""
    with _lock:
        _attempts.pop(key, None)
