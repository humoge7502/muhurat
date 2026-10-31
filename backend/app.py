"""The Muhurat API. Read-only for clients; refresh happens on a schedule."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

import db
import ingest

app = FastAPI(
    title="Muhurat",
    version="1.0.0",
    description=(
        "Real-time opportunity radar for students. Every item is real, sourced "
        "and snapshotted — no simulated data anywhere."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    ingest.start_background_refresh()
    import push as push_module

    push_module.get_or_create_vapid()


@app.get("/api/push/public-key")
def push_public_key() -> dict[str, Any]:
    """The VAPID application server key for pushManager.subscribe()."""
    import push as push_module

    return {"public_key": push_module.get_or_create_vapid()["public"]}


@app.post("/api/push/subscribe")
def push_subscribe(subscription: dict[str, Any]) -> dict[str, Any]:
    """Store a browser push subscription (endpoint + p256dh/auth keys)."""
    import push as push_module

    try:
        endpoint = subscription["endpoint"]
        keys = subscription["keys"]
        push_module.subscribe(endpoint, keys["p256dh"], keys["auth"])
    except (KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"malformed subscription: {exc}") from exc
    return {"ok": True}


@app.post("/api/push/dispatch")
def push_dispatch(hours: int = 48) -> dict[str, Any]:
    """Send deadline warnings to all subscribers (idempotent per item)."""
    import push as push_module

    return push_module.dispatch_deadline_warnings(hours=min(max(hours, 1), 336))


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "app": "muhurat",
        "opportunities": len(db.list_opportunities()),
        "sources": db.source_status(),
        "data_mode": "live-ingested (keyless public sources, snapshotted)",
    }


@app.get("/api/opportunities")
def opportunities(
    q: str | None = Query(default=None, max_length=120),
    type: str | None = Query(default=None, pattern="^(contest|hackathon|scholarship)$"),
    days: int | None = Query(default=None, ge=1, le=365),
    sort: str = Query(default="deadline", pattern="^(deadline|new|prize)$"),
) -> dict[str, Any]:
    items = db.list_opportunities(q=q, type_=type, days=days, sort=sort)
    return {"count": len(items), "items": items, "sources": db.source_status()}


@app.post("/api/refresh")
def refresh() -> dict[str, Any]:
    """On-demand refresh (the UI's refresh button; the schedule does the rest)."""
    return {"results": ingest.refresh_all(), "sources": db.source_status()}


@app.get("/api/ics")
def ics(ids: str = Query(default="", description="comma-separated opportunity ids")):
    """Calendar file for the chosen opportunities — the student's own device
    becomes the reminder, which works even where notifications do not."""
    wanted = {i.strip() for i in ids.split(",") if i.strip()}
    items = [o for o in db.list_opportunities() if o["id"] in wanted and o["deadline"]]
    if not items:
        raise HTTPException(status_code=404, detail="no matching opportunities with deadlines")
    stamp = db.utcnow_iso().replace("-", "").replace(":", "").replace("+00:00", "Z")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Muhurat//EN", "CALSCALE:GREGORIAN"]
    for o in items:
        deadline = o["deadline"].replace("-", "").replace(":", "").replace("+00:00", "Z")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{o['id']}@muhurat",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{deadline}",
            f"SUMMARY:⏰ {o['title'][:80]}",
            f"URL:{o['url']}",
            f"DESCRIPTION:Deadline for {o['title'][:100]}. Source: {o['url']}",
            "BEGIN:VALARM",
            "TRIGGER:-P2D",
            "ACTION:DISPLAY",
            f"DESCRIPTION:2 days left: {o['title'][:70]}",
            "END:VALARM",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    body = "\r\n".join(lines) + "\r\n"
    return Response(
        content=body,
        media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=muhurat.ics"},
    )
