"""Input limits for requests that reach the service.

The service has no authentication of its own: it is reachable only from the
webapp over the docker network, and the webapp lets any Google account sign
in. Every request body is therefore attacker-controlled, and the analysis
code it feeds (light curves, periodograms, the multi-agent workflow) does
work proportional to the size of what it is given. Without limits, one
request with a large or very long event list allocates gigabytes and blocks
the process for every user.

The limits are far above anything the real data needs. Corpus event lists
are capped at 800 events, and a single Chandra observation spans at most a
few hundred kiloseconds.
"""

from __future__ import annotations

import math
import os
from typing import Any, Iterable, Optional

from fastapi import HTTPException


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


MAX_EVENTS = _env_int("MAX_EVENTS_PER_LIST", 50_000)
MAX_TIME_SPAN_S = _env_int("MAX_EVENT_TIME_SPAN_S", 2_000_000)
MAX_NEIGHBORS = _env_int("MAX_NEIGHBORS", 25)
MAX_MESSAGE_CHARS = 20_000
MAX_HISTORY_MESSAGES = 50
MAX_HISTORY_CHARS = 100_000

EVENT_LIST_KEYS = ("event_list", "original_event_list")


def _event_time(row: Any) -> Optional[float]:
    if isinstance(row, (list, tuple)) and row:
        value = row[0]
    elif isinstance(row, dict):
        value = row.get("time", row.get("t"))
    else:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def check_event_list(events: Any, label: str = "event_list") -> None:
    """Reject an event list that is too long, too long in time, or non-finite.

    Raises HTTPException(413) so the caller gets a clear, non-retryable error.
    Malformed rows are left to the analysis code, which already reports them.
    """
    if events is None:
        return
    if not isinstance(events, list):
        raise HTTPException(status_code=422, detail=f"{label} must be a list")
    if len(events) > MAX_EVENTS:
        raise HTTPException(
            status_code=413,
            detail=f"{label} has {len(events)} events; the limit is {MAX_EVENTS}",
        )
    times = [t for t in (_event_time(r) for r in events) if t is not None]
    if not times:
        return
    if not all(math.isfinite(t) for t in times):
        raise HTTPException(status_code=422, detail=f"{label} contains non-finite times")
    if max(times) - min(times) > MAX_TIME_SPAN_S:
        raise HTTPException(
            status_code=413,
            detail=f"{label} spans more than {MAX_TIME_SPAN_S} seconds",
        )


def check_source(obj: Any, label: str = "object") -> None:
    """Check every event list carried by a source document."""
    if not isinstance(obj, dict):
        return
    for key in EVENT_LIST_KEYS:
        check_event_list(obj.get(key), f"{label}.{key}")


def check_sources(objs: Optional[Iterable[Any]], label: str = "neighbors") -> None:
    if objs is None:
        return
    objs = list(objs)
    if len(objs) > MAX_NEIGHBORS:
        raise HTTPException(
            status_code=413,
            detail=f"{label} has {len(objs)} entries; the limit is {MAX_NEIGHBORS}",
        )
    for i, obj in enumerate(objs):
        check_source(obj, f"{label}[{i}]")
