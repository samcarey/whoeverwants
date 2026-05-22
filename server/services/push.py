"""Push notification dispatch.

Two transports are supported:

  * Web Push (VAPID) — Mozilla / Google / Apple Web Push protocol. Works
    on every browser exposing `'PushManager' in window`. The server holds
    a per-tier ECDSA P-256 keypair stored in `app_config`; the public
    component is shared with the FE via `GET /api/push/config` so the FE
    can `pushManager.subscribe` against it. The private component signs
    each push request via `pywebpush`. Generated lazily on first call to
    `get_vapid_keys()` so dev branches don't need any ops work.

  * APNS — Apple's Push Notification service. Used by the Capacitor iOS
    native shell (when @capacitor/push-notifications registers, it hands
    the FE an APNS device token which the FE forwards to
    `POST /api/notifications/subscriptions` with kind='apns'). The
    server signs an ES256 JWT with an APNS Auth Key (.p8) and POSTs the
    payload to `api.push.apple.com` over HTTP/2. Optional — if the
    server doesn't have APNS env vars configured, APNS sends are
    silently skipped (the FE still receives push via Web Push if the
    platform supports it).

Failure handling: per-subscription send errors are caught, logged, and
the subscription's failure_count incremented. Subscriptions with status
410 (Gone) or 404 (Not Found) responses are deleted immediately — that's
the standard signal from push services that the endpoint is dead.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Iterable

import httpx
import jwt
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush

from database import get_db

log = logging.getLogger("push")

_VAPID_PUBLIC_KEY_CONFIG = "vapid_public_key"
_VAPID_PRIVATE_KEY_CONFIG = "vapid_private_key"
_VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:noreply@whoeverwants.com")

# APNS configuration — all optional. When any required value is absent,
# APNS sends are skipped. Set via env vars on the API droplet.
_APNS_KEY_ID = os.environ.get("APNS_KEY_ID")
_APNS_TEAM_ID = os.environ.get("APNS_TEAM_ID")
_APNS_AUTH_KEY_P8_B64 = os.environ.get("APNS_AUTH_KEY_P8")
_APNS_USE_SANDBOX = os.environ.get("APNS_USE_SANDBOX") == "1"
_APNS_HOST = (
    "api.sandbox.push.apple.com" if _APNS_USE_SANDBOX else "api.push.apple.com"
)


@dataclass(frozen=True)
class VapidKeys:
    """VAPID keypair material as URL-safe base64 strings.

    `public_b64` is what the FE feeds into
    `pushManager.subscribe({applicationServerKey})`. `private_pem` is
    what pywebpush needs internally to sign the push request.
    """

    public_b64: str
    private_pem: str


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _generate_vapid_keypair() -> VapidKeys:
    """Generate a fresh ECDSA P-256 keypair in the format pywebpush expects."""
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    public_numbers = private_key.public_key().public_numbers()
    # The Web Push API expects the uncompressed SEC1 point form:
    # 0x04 || X (32 bytes) || Y (32 bytes), URL-safe base64'd without padding.
    raw_point = b"\x04" + public_numbers.x.to_bytes(32, "big") + public_numbers.y.to_bytes(32, "big")
    return VapidKeys(public_b64=_b64url(raw_point), private_pem=private_pem)


def _load_vapid_from_db(conn) -> VapidKeys | None:
    """Fetch the persisted VAPID keypair, or None if it hasn't been generated yet."""
    rows = conn.execute(
        "SELECT key, value FROM app_config WHERE key IN (%s, %s)",
        (_VAPID_PUBLIC_KEY_CONFIG, _VAPID_PRIVATE_KEY_CONFIG),
    ).fetchall()
    by_key = {r["key"]: r["value"] for r in rows}
    public = by_key.get(_VAPID_PUBLIC_KEY_CONFIG)
    private = by_key.get(_VAPID_PRIVATE_KEY_CONFIG)
    if public and private:
        return VapidKeys(public_b64=public, private_pem=private)
    return None


def _store_vapid_in_db(conn, keys: VapidKeys) -> None:
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (%(k)s, %(v)s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        {"k": _VAPID_PUBLIC_KEY_CONFIG, "v": keys.public_b64},
    )
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (%(k)s, %(v)s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        {"k": _VAPID_PRIVATE_KEY_CONFIG, "v": keys.private_pem},
    )


def get_vapid_keys() -> VapidKeys:
    """Return the server's VAPID keypair, generating one on first call.

    Generation+persistence happens in its own transaction so a concurrent
    caller racing against the same code path will fall through to the
    SELECT after the first caller's INSERT commits — they'll read the
    other caller's keypair instead of generating a second one. Composite
    uniqueness is enforced by `app_config`'s PRIMARY KEY (key).
    """
    with get_db() as conn:
        existing = _load_vapid_from_db(conn)
        if existing is not None:
            return existing
        fresh = _generate_vapid_keypair()
        _store_vapid_in_db(conn, fresh)
        log.info("Generated fresh VAPID keypair for this server")
        return fresh


def apns_configured() -> bool:
    """Whether the server has the env vars needed to send APNS pushes."""
    return bool(_APNS_KEY_ID and _APNS_TEAM_ID and _APNS_AUTH_KEY_P8_B64)


def _apns_jwt(now_unix: int) -> str:
    """Build an APNS auth token (ES256 JWT). Valid for ~1 hour per Apple
    spec; we re-issue per send for simplicity (cheap signature)."""
    p8_bytes = base64.b64decode(_APNS_AUTH_KEY_P8_B64)
    private_key = serialization.load_pem_private_key(p8_bytes, password=None)
    payload = {"iss": _APNS_TEAM_ID, "iat": now_unix}
    headers = {"alg": "ES256", "kid": _APNS_KEY_ID}
    return jwt.encode(payload, private_key, algorithm="ES256", headers=headers)


def _delete_subscription(conn, subscription_id: str) -> None:
    conn.execute(
        "DELETE FROM push_subscriptions WHERE id = %(id)s",
        {"id": subscription_id},
    )


def _mark_failure(conn, subscription_id: str, error: str) -> None:
    conn.execute(
        "UPDATE push_subscriptions SET failure_count = failure_count + 1, "
        "last_error = %(e)s, updated_at = NOW() WHERE id = %(id)s",
        {"id": subscription_id, "e": error[:500]},
    )


def _send_web_push(
    subscription: dict,
    payload: dict,
    vapid: VapidKeys,
) -> tuple[bool, str | None, bool]:
    """Send a single web push. Returns (ok, error, should_delete)."""
    sub_info = {
        "endpoint": subscription["endpoint"],
        "keys": {
            "p256dh": subscription["p256dh"],
            "auth": subscription["auth"],
        },
    }
    try:
        webpush(
            subscription_info=sub_info,
            data=json.dumps(payload),
            vapid_private_key=vapid.private_pem,
            vapid_claims={"sub": _VAPID_SUBJECT},
            ttl=60 * 60 * 24,  # 24h — recipients offline this long can drop it
        )
        return (True, None, False)
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        # 404 Not Found / 410 Gone — endpoint is permanently dead.
        should_delete = status in (404, 410)
        return (False, f"web_push {status}: {exc}", should_delete)
    except Exception as exc:  # noqa: BLE001
        return (False, f"web_push error: {exc}", False)


def _send_apns(
    subscription: dict,
    payload: dict,
    client: httpx.Client,
    apns_jwt: str,
) -> tuple[bool, str | None, bool]:
    """Send a single APNS push. Returns (ok, error, should_delete)."""
    device_token = subscription["endpoint"]
    bundle_id = subscription.get("bundle_id") or "com.whoeverwants.app"
    apns_payload = {
        "aps": {
            "alert": {
                "title": payload.get("title", "WhoeverWants"),
                "body": payload.get("body", ""),
            },
            "sound": "default",
            "badge": 1,
        },
        # Custom data — read by the iOS app's notification tap handler
        # to route into the right group.
        "url": payload.get("url"),
        "group_id": payload.get("group_id"),
    }
    headers = {
        "authorization": f"bearer {apns_jwt}",
        "apns-topic": bundle_id,
        "apns-push-type": "alert",
        "apns-priority": "10",
    }
    try:
        resp = client.post(
            f"https://{_APNS_HOST}/3/device/{device_token}",
            headers=headers,
            content=json.dumps(apns_payload),
            timeout=10.0,
        )
        if resp.status_code == 200:
            return (True, None, False)
        # 410 Gone — token no longer valid (app uninstalled, etc.). Apple's
        # BadDeviceToken (400) also indicates an unusable token.
        body = resp.text[:500]
        should_delete = resp.status_code == 410 or "BadDeviceToken" in body
        return (False, f"apns {resp.status_code}: {body}", should_delete)
    except Exception as exc:  # noqa: BLE001
        return (False, f"apns error: {exc}", False)


def _fetch_subscriptions(conn, browser_ids: Iterable[str]) -> list[dict]:
    ids = list(browser_ids)
    if not ids:
        return []
    rows = conn.execute(
        "SELECT id::text, browser_id::text, kind, endpoint, p256dh, auth, bundle_id "
        "FROM push_subscriptions WHERE browser_id = ANY(%(ids)s::uuid[])",
        {"ids": ids},
    ).fetchall()
    return [dict(r) for r in rows]


def _dispatch_pushes(
    subscriptions: list[dict],
    payload: dict,
    vapid: VapidKeys | None,
) -> None:
    """Run the actual web-push / APNS sends + record per-subscription
    outcomes (success → reset failure_count; 410/BadDeviceToken → delete
    the dead row; other failures → mark + log). Called from both
    fan-out helpers below — extracted so adding a third event type
    (e.g. Phase F's join-request notifications) doesn't fork the dispatch
    logic.

    The actual sends run OUTSIDE any `get_db()` block — holding a DB
    connection while waiting on the push services would block other
    inbound API requests. We only re-open a connection at the end to
    persist per-subscription outcomes.
    """
    web_results: list[tuple[str, bool, str | None, bool]] = []
    apns_results: list[tuple[str, bool, str | None, bool]] = []

    web_subs = [s for s in subscriptions if s["kind"] == "web_push"]
    apns_subs = [s for s in subscriptions if s["kind"] == "apns"]

    if web_subs and vapid is not None:
        for sub in web_subs:
            ok, err, should_delete = _send_web_push(sub, payload, vapid)
            web_results.append((sub["id"], ok, err, should_delete))

    if apns_subs and apns_configured():
        jwt_token = _apns_jwt(int(time.time()))
        with httpx.Client(http2=True) as client:
            for sub in apns_subs:
                ok, err, should_delete = _send_apns(sub, payload, client, jwt_token)
                apns_results.append((sub["id"], ok, err, should_delete))

    with get_db() as conn:
        for sub_id, ok, err, should_delete in web_results + apns_results:
            if ok:
                conn.execute(
                    "UPDATE push_subscriptions SET failure_count = 0, last_error = NULL, "
                    "updated_at = NOW() WHERE id = %(id)s",
                    {"id": sub_id},
                )
            elif should_delete:
                _delete_subscription(conn, sub_id)
                log.info("Deleted dead push subscription %s: %s", sub_id, err)
            else:
                _mark_failure(conn, sub_id, err or "unknown")
                log.warning("Push send failed for subscription %s: %s", sub_id, err)


def fan_out_new_poll(group_id: str, creator_browser_id: str | None, payload: dict) -> None:
    """Send a 'new poll' push to every group member (except the creator)
    whose notification preference is on. Safe to call inline OR from a
    BackgroundTasks closure — every error is caught, logged, and
    swallowed so this never blocks the response.

    Default-ON semantics for the pref: a missing row in
    `group_notification_preferences` counts as ON.
    """
    try:
        with get_db() as conn:
            recipients = conn.execute(
                """
                SELECT gm.browser_id::text AS browser_id
                FROM group_members gm
                LEFT JOIN group_notification_preferences pref
                  ON pref.browser_id = gm.browser_id AND pref.group_id = gm.group_id
                WHERE gm.group_id = %(gid)s
                  AND (%(creator)s::uuid IS NULL OR gm.browser_id != %(creator)s::uuid)
                  AND COALESCE(pref.notify_new_poll, TRUE) = TRUE
                """,
                {"gid": group_id, "creator": creator_browser_id},
            ).fetchall()
            browser_ids = [r["browser_id"] for r in recipients]
            if not browser_ids:
                return
            subscriptions = _fetch_subscriptions(conn, browser_ids)
            if not subscriptions:
                return
            vapid = _load_vapid_from_db(conn)

        _dispatch_pushes(subscriptions, payload, vapid)
    except Exception as exc:  # noqa: BLE001
        log.exception("fan_out_new_poll failed: %s", exc)


def fan_out_join_request(
    group_id: str,
    creator_user_id: str,
    payload: dict,
) -> None:
    """Phase F: send a 'someone wants to join your group' push to every
    browser the creator is signed in on, subject to the per-group
    notification preference. Same safety contract as `fan_out_new_poll`:
    every error caught, logged, and swallowed so a failing push service
    can't block the request response.

    Recipients are derived from `user_browsers WHERE user_id = creator`
    (one per linked browser), filtered down to those with active push
    subscriptions, and gated on the same `notify_new_poll` pref the
    new-poll path uses — for v1 the per-group pref is the single signal
    that the creator wants to hear about anything happening on the
    group. Phase I can add a dedicated `notify_join_request` column if
    we want to surface join requests separately from new-poll noise.
    """
    try:
        with get_db() as conn:
            recipients = conn.execute(
                """
                SELECT DISTINCT ub.browser_id::text AS browser_id
                  FROM user_browsers ub
                  LEFT JOIN group_notification_preferences pref
                    ON pref.browser_id = ub.browser_id
                   AND pref.group_id = %(gid)s::uuid
                 WHERE ub.user_id = %(uid)s::uuid
                   AND COALESCE(pref.notify_new_poll, TRUE) = TRUE
                """,
                {"gid": group_id, "uid": creator_user_id},
            ).fetchall()
            browser_ids = [r["browser_id"] for r in recipients]
            if not browser_ids:
                return
            subscriptions = _fetch_subscriptions(conn, browser_ids)
            if not subscriptions:
                return
            vapid = _load_vapid_from_db(conn)

        _dispatch_pushes(subscriptions, payload, vapid)
    except Exception as exc:  # noqa: BLE001
        log.exception("fan_out_join_request failed: %s", exc)
