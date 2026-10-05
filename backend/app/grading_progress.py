"""Ephemeral progress for a single-worker deployment; no student data stored."""
from threading import Lock
from time import monotonic

_lock = Lock()
_entries = {}


def report_progress(session_id, token, fraction, stage):
    if token is None:
        return
    key = (session_id, str(token))
    with _lock:
        now = monotonic()
        for expired in [k for k, v in _entries.items() if now - v['updated'] > 3600]:
            _entries.pop(expired, None)
        if key not in _entries and len(_entries) >= 500:
            _entries.pop(min(_entries, key=lambda k: _entries[k]['updated']), None)
        previous = _entries.get(key, {}).get('fraction', 0)
        _entries[key] = {
            'fraction': max(previous, min(1, max(0, float(fraction)))),
            'stage': stage, 'updated': now,
        }


def read_progress(session_id, token):
    with _lock:
        value = _entries.get((session_id, str(token)))
        if not value or monotonic() - value['updated'] > 3600:
            return {'fraction': 0, 'stage': 'Uploading pages'}
        return {'fraction': value['fraction'], 'stage': value['stage']}
