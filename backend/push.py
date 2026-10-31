"""Web-push: self-generated VAPID keys, subscriptions, deadline dispatch.

The VAPID keypair is GENERATED ON FIRST START with local cryptography — there
is no key to extract from anywhere, and `data/vapid.json` is gitignored so the
private half never reaches a repository. Losing it only means subscribers
re-subscribe: push endpoints are bound to the application server key.

Dispatch is idempotent per (subscription, item): `push_sent` records what was
already delivered, so the 6-hourly refresh can call this repeatedly without
spamming a student about the same deadline.
"""

from __future__ import annotations

import base64
import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import db

_VAPID_PATH = db.DATA_DIR / "vapid.json"
_VAPID_LOCK = threading.Lock()
_VAPID_CACHE: dict[str, str] | None = None
SUB_LOCK = threading.Lock()


def get_or_create_vapid() -> dict[str, str]:
    """Return {'public': b64url, 'private': b64url, ...} — generated on device."""
    global _VAPID_CACHE
    with _VAPID_LOCK:
        if _VAPID_CACHE:
            return _VAPID_CACHE
        if _VAPID_PATH.exists():
            _VAPID_CACHE = json.loads(_VAPID_PATH.read_text(encoding="utf-8"))
            return _VAPID_CACHE

        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.serialization import (
            Encoding,
            NoEncryption,
            PrivateFormat,
            PublicFormat,
        )

        def b64url(raw: bytes) -> str:
            return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

        key = ec.generate_private_key(ec.SECP256R1())
        public_raw = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        private_pkcs8 = key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
        private_scalar = key.private_numbers().private_value.to_bytes(32, "big")

        doc = {
            "public": b64url(public_raw),
            "private": b64url(private_scalar),
            "private_pkcs8_b64": b64url(private_pkcs8),
            "subject": "mailto:muhurat@humoge7502.dev",
            "generated_at": db.utcnow_iso(),
            "sha256_fingerprint": hashlib.sha256(public_raw).hexdigest()[:16],
        }
        _VAPID_PATH.write_text(json.dumps(doc, indent=2), encoding="utf-8")
        _VAPID_CACHE = doc
        return _VAPID_CACHE


def subscribe(endpoint: str, p256dh: str, auth: str) -> None:
    with SUB_LOCK, db.CONN:
        db.CONN.execute(
            """INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
               VALUES (:e, :p, :a, :t)
               ON CONFLICT(endpoint) DO UPDATE SET p256dh=:p, auth=:a""",
            {"e": endpoint, "p": p256dh, "a": auth, "t": db.utcnow_iso()},
        )


def unsubscribe(endpoint: str) -> None:
    with SUB_LOCK, db.CONN:
        db.CONN.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))


def _subscriptions() -> list[dict[str, Any]]:
    with db.LOCK, db.CONN:
        rows = db.CONN.execute("SELECT * FROM push_subscriptions").fetchall()
    return [dict(r) for r in rows]


def _ts(iso: str) -> float | None:
    try:
        return datetime.fromisoformat(iso).timestamp()
    except ValueError:
        return None


def countdown_short(iso: str) -> str:
    ts = _ts(iso)
    if ts is None:
        return "deadline soon"
    remaining_days = (ts - datetime.now(timezone.utc).timestamp()) / 86400
    if remaining_days < 1:
        return f"{max(1, round(remaining_days * 24))}h left"
    return f"{round(remaining_days)}d left"


def dispatch_deadline_warnings(hours: int = 48) -> dict[str, Any]:
    """Push every subscription about items whose deadline lands within `hours`.

    Delivery failures (expired subscriptions, unreachable push services) are
    recorded per-endpoint and the subscription is dropped on 404/410 — the
    protocol's own cleanup signal.
    """
    from pywebpush import WebPushException, webpush

    vapid = get_or_create_vapid()
    horizon = datetime.now(timezone.utc).timestamp() + hours * 3600
    targets = [
        item
        for item in db.list_opportunities()
        if item["deadline"]
        and (_ts(item["deadline"]) is not None)
        and (_ts(item["deadline"]) <= horizon)
    ]
    subs = _subscriptions()
    sent = failed = 0
    per_endpoint: list[dict[str, Any]] = []
    with SUB_LOCK, db.CONN:
        for sub in subs:
            outcomes: list[str] = []
            for item in targets:
                already = db.CONN.execute(
                    "SELECT 1 FROM push_sent WHERE endpoint = ? AND item_id = ?",
                    (sub["endpoint"], item["id"]),
                ).fetchone()
                if already:
                    continue
                try:
                    webpush(
                        subscription_info={
                            "endpoint": sub["endpoint"],
                            "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                        },
                        data=json.dumps(
                            {
                                "title": f"⏰ {countdown_short(item['deadline'])} — {item['title'][:70]}",
                                "body": f"{item['type']} · deadline {item['deadline'][:16].replace('T', ' ')} UTC",
                                "url": item["url"],
                            }
                        ),
                        vapid_private_key=vapid["private_pkcs8_b64"],
                        vapid_claims={"sub": vapid["subject"]},
                    )
                    db.CONN.execute(
                        "INSERT OR IGNORE INTO push_sent (endpoint, item_id, sent_at) VALUES (?, ?, ?)",
                        (sub["endpoint"], item["id"], db.utcnow_iso()),
                    )
                    outcomes.append(f"sent:{item['id'][:12]}")
                    sent += 1
                except WebPushException as exc:
                    response = getattr(exc, "response", None)
                    code = getattr(response, "status_code", None) if response is not None else None
                    if code in (404, 410):
                        db.CONN.execute(
                            "DELETE FROM push_subscriptions WHERE endpoint = ?",
                            (sub["endpoint"],),
                        )
                        outcomes.append(f"gone:{code}")
                    else:
                        outcomes.append(f"fail:{code or type(exc).__name__}")
                    failed += 1
                except Exception as exc:  # noqa: BLE001 - per-item resilience
                    outcomes.append(f"fail:{type(exc).__name__}")
                    failed += 1
            per_endpoint.append({"endpoint": sub["endpoint"][:60] + "…", "outcomes": outcomes})
    return {
        "subscriptions": len(subs),
        "targets": len(targets),
        "sent": sent,
        "failed": failed,
        "per_endpoint": per_endpoint,
    }
