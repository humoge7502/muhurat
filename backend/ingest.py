"""The three REAL, keyless ingestion sources and the refresh loop.

Every item carries its source URL. Dates are parsed only when a source states
them; where a deadline is estimated (e.g. extracted from prose) the row says so
via deadline_is_estimate — a student planning around a wrong date is worse than
one shown "see source".
"""

from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx

import db

FETCH_INTERVAL_SECONDS = 6 * 3600
TIMEOUT = 30.0
USER_AGENT = "muhurat/1.0 (student opportunity radar; +https://github.com/humoge7502/muhurat)"


def _iso(epoch_seconds: int | float) -> str:
    return datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).isoformat(timespec="seconds")


def _id(source: str, url: str) -> str:
    import hashlib

    return f"{source}:{hashlib.sha256(url.encode()).hexdigest()[:16]}"


def fetch_codeforces(client: httpx.Client) -> tuple[list[dict[str, Any]], str]:
    """Upcoming programming contests. Public API, no key."""
    response = client.get(
        "https://codeforces.com/api/contest.list", headers={"User-Agent": USER_AGENT}
    )
    response.raise_for_status()
    raw = response.text
    payload = json.loads(raw)
    items: list[dict[str, Any]] = []
    for contest in payload.get("result", []):
        if contest.get("phase") != "BEFORE":
            continue
        start = int(contest["startTimeSeconds"])
        cid = contest["id"]
        items.append(
            {
                "id": _id("codeforces", f"https://codeforces.com/contests/{cid}"),
                "source": "codeforces",
                "type": "contest",
                "title": str(contest.get("name", "")).strip() or f"Contest {cid}",
                "org": "Codeforces",
                "url": f"https://codeforces.com/contests/{cid}",
                "region": "global",
                "starts_at": _iso(start),
                # Registration effectively closes when the contest starts.
                "deadline": _iso(start),
                "deadline_is_estimate": 1,
                "prize": "",
                "tags": ["competitive-programming", str(contest.get("type", "CF")).lower()],
                "excerpt": f"{contest.get('type', 'CF')} contest · "
                f"{int(contest.get('durationSeconds', 0)) // 3600}h long",
            }
        )
    return items, raw


_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
]
# Sources use both full names ("October") and abbreviations ("Oct"); the map
# accepts both so a recognised date is never dropped on a technicality.
_MONTHS = {}
for _i, _name in enumerate(_MONTH_NAMES, start=1):
    _MONTHS[_name.lower()] = _i
    _MONTHS[_name[:3].lower()] = _i


def _parse_devpost_dates(entry: dict[str, Any]) -> tuple[str, str]:
    """Devpost exposes dates inconsistently; parse only what is actually present."""
    open_state = entry.get("open_state") or {}
    if isinstance(open_state, dict):
        start = open_state.get("start") or open_state.get("started_at")
        end = open_state.get("end") or open_state.get("closed_at")
        if start and end:
            return _iso(int(start)), _iso(int(end))
    text = str(entry.get("submission_period_dates") or "")
    # Two real shapes: "Oct 30 - Dec 04, 2026" (cross-month) and
    # "Nov 09 - 30, 2026" (same-month, month implied on the right side).
    match = re.search(
        r"([A-Z][a-z]{2,8})\s+(\d{1,2})\s*(?:,?\s*(\d{4}))?\s*-\s*"
        r"(?:([A-Z][a-z]{2,8})\s+)?(\d{1,2}),?\s*(\d{4})",
        text,
    )
    if not match:
        return "", ""
    try:
        m1, d1, y1, m2, d2, y2 = match.groups()
        year2 = int(y2)
        month1 = _MONTHS[m1.lower()]
        month2 = _MONTHS[m2.lower()] if m2 else month1
        year1 = int(y1) if y1 else (year2 if (month1, int(d1)) <= (month2, int(d2)) else year2 - 1)
        start = datetime(year1, month1, int(d1), tzinfo=timezone.utc).isoformat(timespec="seconds")
        end = datetime(year2, month2, int(d2), 23, 59, tzinfo=timezone.utc).isoformat(timespec="seconds")
        return start, end
    except (ValueError, KeyError):
        return "", ""


def fetch_devpost(client: httpx.Client) -> tuple[list[dict[str, Any]], str]:
    """Upcoming hackathons. Public JSON, no key."""
    response = client.get(
        "https://devpost.com/api/hackathons?status=upcoming",
        headers={"User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    raw = response.text
    payload = json.loads(raw)
    items: list[dict[str, Any]] = []
    for entry in payload.get("hackathons", []):
        url = entry.get("url") or entry.get("start_a_submission_url") or ""
        if not url:
            continue
        starts_at, ends_at = _parse_devpost_dates(entry)
        themes = [t.get("name") for t in (entry.get("themes") or []) if isinstance(t, dict)]
        prize = entry.get("prize_amount")
        location = "Online"
        displayed = entry.get("displayed_location")
        if isinstance(displayed, dict):
            location = displayed.get("location") or "Online"
        items.append(
            {
                "id": _id("devpost", url),
                "source": "devpost",
                "type": "hackathon",
                "title": str(entry.get("title", "")).strip(),
                "org": entry.get("organization_name") or "Devpost",
                "url": url,
                "region": "global",
                "starts_at": starts_at,
                "deadline": ends_at,  # submission-period end is the working deadline
                "deadline_is_estimate": 0,
                "prize": f"${prize:,.0f} prizes" if isinstance(prize, (int, float)) and prize else "",
                "tags": ["hackathon", *(str(t).lower() for t in themes[:3])],
                "excerpt": f"{entry.get('registrations_count', 0):,} registered · {location}",
            }
        )
    return items, raw


_DATE_HINT = re.compile(
    r"(deadline|apply by|apply before|last date|closes on|submit by)[:\s]*([^.<]{3,80})", re.I
)


def fetch_opportunitydesk(client: httpx.Client) -> tuple[list[dict[str, Any]], str]:
    """Scholarships, fellowships and grants. Public WordPress RSS, no key."""
    import feedparser

    response = client.get("https://opportunitydesk.org/feed/", headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    raw = response.text
    parsed = feedparser.parse(raw)
    items: list[dict[str, Any]] = []
    for entry in parsed.entries[:40]:
        url = entry.get("link", "")
        if not url:
            continue
        title = entry.get("title", "").strip()
        excerpt = re.sub(r"<[^>]+>", " ", entry.get("summary", ""))[:280].strip()
        hint = _DATE_HINT.search(excerpt) or _DATE_HINT.search(title)
        deadline = ""
        if hint:
            found = re.search(
                r"([A-Z][a-z]{2,8})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})", hint.group(2)
            )
            if found and found.group(1).lower() in _MONTHS:
                try:
                    deadline = datetime(
                        int(found.group(3)), _MONTHS[found.group(1).lower()],
                        int(found.group(2)), 23, 59, tzinfo=timezone.utc,
                    ).isoformat(timespec="seconds")
                except ValueError:
                    deadline = ""
        items.append(
            {
                "id": _id("opportunitydesk", url),
                "source": "opportunitydesk",
                "type": "scholarship",
                "title": title,
                "org": "Opportunity Desk",
                "url": url,
                "region": "international",
                "starts_at": "",
                "deadline": deadline,
                # Extracted from prose: flagged so the UI can say "estimated".
                "deadline_is_estimate": 1 if deadline else 0,
                "prize": "",
                "tags": ["scholarship", "fellowship", "funding"],
                "excerpt": excerpt,
            }
        )
    return items, raw


_FETCHERS = {
    "codeforces": fetch_codeforces,
    "devpost": fetch_devpost,
    "opportunitydesk": fetch_opportunitydesk,
}


def refresh_all() -> dict[str, Any]:
    """One full refresh. Each source is independent: one failing never blocks
    the others, and its error is recorded in source_status, not hidden."""
    results: dict[str, Any] = {}
    with httpx.Client(timeout=TIMEOUT) as client:
        for source, fetcher in _FETCHERS.items():
            try:
                items, raw = fetcher(client)
                count = db.upsert_many(source, items, raw)
                results[source] = {"ok": True, "count": count}
            except Exception as exc:  # noqa: BLE001 - recorded, never raised
                db.mark_source_error(source, f"{type(exc).__name__}: {exc}")
                results[source] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    return results


def start_background_refresh() -> threading.Thread:
    """Refresh on startup, then every FETCH_INTERVAL_SECONDS. Daemon thread."""

    def loop() -> None:
        while True:
            try:
                refresh_all()
            except Exception:  # pragma: no cover - the loop must never die
                pass
            time.sleep(FETCH_INTERVAL_SECONDS)

    thread = threading.Thread(target=loop, name="muhurat-ingest", daemon=True)
    thread.start()
    return thread
