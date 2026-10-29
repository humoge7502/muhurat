"""Muhurat — real-time opportunity radar for students.

Every opportunity is REAL: ingested from public, keyless sources, snapshotted at
fetch time (provenance), deduplicated, and served with its source link. Nothing
is simulated; when a source is unreachable the item simply does not update and
the API says when each source was last fetched.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
SNAPSHOT_DIR = DATA_DIR / "snapshots"
DB_PATH = DATA_DIR / "muhurat.db"

LOCK = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    org TEXT,
    url TEXT NOT NULL,
    region TEXT,
    starts_at TEXT,
    deadline TEXT,
    deadline_is_estimate INTEGER NOT NULL DEFAULT 0,
    prize TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    excerpt TEXT,
    fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deadline ON opportunities(deadline);
CREATE INDEX IF NOT EXISTS idx_type ON opportunities(type);
CREATE TABLE IF NOT EXISTS source_status (
    source TEXT PRIMARY KEY,
    last_fetch TEXT,
    last_ok TEXT,
    last_count INTEGER,
    last_error TEXT
);
"""


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


CONN = connect()


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def upsert_many(source: str, items: list[dict[str, Any]], raw: str) -> int:
    """Insert/refresh one source's items + write the raw snapshot (provenance)."""
    now = utcnow_iso()
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]
    (SNAPSHOT_DIR / f"{source}-{datetime.now(timezone.utc):%Y%m%d}-{digest}.json").write_text(
        raw, encoding="utf-8"
    )
    with LOCK, CONN:
        for item in items:
            item.setdefault("fetched_at", now)
            CONN.execute(
                """INSERT INTO opportunities
                   (id, source, type, title, org, url, region, starts_at, deadline,
                    deadline_is_estimate, prize, tags, excerpt, fetched_at)
                   VALUES (:id,:source,:type,:title,:org,:url,:region,:starts_at,:deadline,
                           :deadline_is_estimate,:prize,:tags,:excerpt,:fetched_at)
                   ON CONFLICT(id) DO UPDATE SET
                     title=excluded.title, org=excluded.org, region=excluded.region,
                     starts_at=excluded.starts_at, deadline=excluded.deadline,
                     deadline_is_estimate=excluded.deadline_is_estimate,
                     prize=excluded.prize, tags=excluded.tags, excerpt=excluded.excerpt,
                     fetched_at=excluded.fetched_at""",
                {**item, "tags": json.dumps(item.get("tags", []))},
            )
        CONN.execute(
            """INSERT INTO source_status (source, last_fetch, last_ok, last_count, last_error)
               VALUES (:s, :t, :t, :c, NULL)
               ON CONFLICT(source) DO UPDATE SET last_fetch=:t, last_ok=:t,
                 last_count=:c, last_error=NULL""",
            {"s": source, "t": now, "c": len(items)},
        )
    return len(items)


def mark_source_error(source: str, error: str) -> None:
    now = utcnow_iso()
    with LOCK, CONN:
        CONN.execute(
            """INSERT INTO source_status (source, last_fetch, last_ok, last_count, last_error)
               VALUES (:s, :t, NULL, 0, :e)
               ON CONFLICT(source) DO UPDATE SET last_fetch=:t, last_error=:e""",
            {"s": source, "t": now, "e": error},
        )


def list_opportunities(
    q: str | None = None,
    type_: str | None = None,
    days: int | None = None,
    sort: str = "deadline",
) -> list[dict[str, Any]]:
    """Filtered, sorted view. Past items are never returned."""
    sql = "SELECT * FROM opportunities WHERE 1=1"
    params: list[Any] = []
    if type_:
        sql += " AND type = ?"
        params.append(type_)
    if days is not None:
        horizon = time.time() + days * 86400
        sql += " AND (deadline IS NULL OR deadline = '' OR unixepoch(deadline) <= ?)"
        params.append(horizon)
    sql += " AND (deadline IS NULL OR deadline = '' OR unixepoch(deadline) > unixepoch('now'))"
    if q:
        like = f"%{q.lower()}%"
        sql += " AND (lower(title) LIKE ? OR lower(coalesce(org,'')) LIKE ? OR lower(tags) LIKE ?)"
        params += [like, like, like]
    sql += {
        "deadline": " ORDER BY (deadline = '' OR deadline IS NULL), deadline ASC",
        "new": " ORDER BY fetched_at DESC",
        "prize": " ORDER BY length(coalesce(prize,'')) DESC",
    }.get(sort, " ORDER BY deadline ASC")
    with LOCK, CONN:
        rows = CONN.execute(sql, params).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["tags"] = json.loads(item.get("tags") or "[]")
        out.append(item)
    return out


def source_status() -> list[dict[str, Any]]:
    with LOCK, CONN:
        rows = CONN.execute("SELECT * FROM source_status ORDER BY source").fetchall()
    return [dict(r) for r in rows]
