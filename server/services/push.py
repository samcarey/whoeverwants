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
from services.auth import caller_browser_ids
from services.groups import NIL_UUID

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
    aps: dict = {
        "alert": {
            "title": payload.get("title", "WhoeverWants"),
            "body": payload.get("body", ""),
        },
        "sound": "default",
    }
    # Per-recipient badge count is injected by _dispatch_pushes (_payload_for).
    # Only set aps.badge when a real count is present — NEVER assert a phantom
    # value. If absent (e.g. the count computation failed), omit it so iOS leaves
    # the icon badge untouched rather than stamping a misleading number.
    badge = payload.get("badge")
    if isinstance(badge, int):
        aps["badge"] = badge
    apns_payload = {
        "aps": aps,
        # Custom data — read by the iOS app's notification tap handler
        # to route into the right group. `tag` + `group_uuid` (when
        # present) ride alongside so the FE swMessages bridge can do
        # tag-prefix discrimination and UUID-form matching on native iOS,
        # exactly like the web push branch. Missing fields are dropped so
        # we don't send `null` literals in the payload.
        "url": payload.get("url"),
        "group_id": payload.get("group_id"),
    }
    for k in ("tag", "group_uuid"):
        v = payload.get(k)
        if v is not None:
            apns_payload[k] = v
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


def _badge_settings_for_browser(conn, browser_id: str) -> tuple[bool, bool, bool]:
    """(todo_mode, on_voting_open, on_results) for a browser. Signed-in →
    account columns; anonymous (no user_browsers row) → defaults (to-do model;
    the on_voting_open/on_results re-lights are unread-only so inert here). The
    push path can only see account/default settings — an anonymous user's
    localStorage preference shapes only the client-side badge.
    """
    row = conn.execute(
        """
        SELECT u.badge_todo_mode, u.badge_on_voting_open, u.badge_on_results
          FROM user_browsers ub
          JOIN users u ON u.id = ub.user_id
         WHERE ub.browser_id = %(b)s::uuid
        """,
        {"b": browser_id},
    ).fetchone()
    if not row:
        return (True, True, True)
    return (
        bool(row["badge_todo_mode"]),
        bool(row["badge_on_voting_open"]),
        bool(row["badge_on_results"]),
    )


def _caller_browser_ids(conn, browser_id: str | None, user_id: str | None) -> list[str]:
    """Badge-side alias for the shared identity helper. The canonical
    implementation lives in `services.auth.caller_browser_ids` so the
    "caller's own data" union (badge counts AND the caller's own votes) has a
    single source of truth."""
    return caller_browser_ids(conn, browser_id=browser_id, user_id=user_id)


def compute_badge_count(
    conn,
    browser_id: str | None,
    *,
    user_id: str | None = None,
    todo_mode: bool,
    on_voting_open: bool,
    on_results: bool,
) -> int:
    """The app-icon badge number for a caller under the given settings.

    Single source of truth shared by the push fan-out (per recipient) and the
    GET /api/notifications/badge endpoint (client-side resync). See the
    'App-Icon Badge Model' section in CLAUDE.md. Account-aware: membership,
    votes, and views are unioned across every browser linked to the caller's
    account (`_caller_browser_ids`), so viewing a poll on one device clears its
    unread badge on the others.

    - to-do: open, votable (prephase passed / none), deadline not passed, and
      no vote/abstain by ANY of the caller's devices on the poll's questions.
    - unread: a notification event the caller hasn't seen on ANY device since —
      never-viewed (new), or (gated) a transition / close after the last view.
    """
    # No usable identity → 0 without touching the DB. The RFC 4122 nil UUID is
    # never a real browser (a device that ever sends it must not inherit a
    # stranger's unread count). When a session user_id IS present we still
    # resolve the account's browsers even if the current browser is nil.
    if user_id is None and (not browser_id or browser_id == NIL_UUID):
        return 0
    bids = _caller_browser_ids(conn, browser_id, user_id)
    if not bids:
        return 0
    # Gap 1: polls the caller has ✕'d ('old') are silenced everywhere — they
    # contribute to neither the to-do nor the unread badge. `bids` is already
    # the account union, so this suppression is account-aware (ignore on one
    # device clears the badge on the others).
    from services.follow_state import old_poll_ids_for_browsers

    old = list(old_poll_ids_for_browsers(conn, bids))
    if todo_mode:
        row = conn.execute(
            """
            SELECT COUNT(*) AS c FROM (
              SELECT DISTINCT p.id
                FROM group_members gm
                JOIN polls p ON p.group_id = gm.group_id
               WHERE gm.browser_id = ANY(%(bids)s::uuid[])
                 AND p.id <> ALL(%(old)s::uuid[])
                 AND p.is_closed = false
                 AND (p.response_deadline IS NULL OR p.response_deadline > NOW())
                 AND (p.prephase_deadline IS NULL OR p.prephase_deadline <= NOW())
                 AND NOT EXISTS (
                   SELECT 1 FROM votes v
                     JOIN questions q ON v.question_id = q.id
                    WHERE q.poll_id = p.id AND v.browser_id = ANY(%(bids)s::uuid[])
                 )
            ) t
            """,
            {"bids": bids, "old": old},
        ).fetchone()
        return int(row["c"] or 0)
    row = conn.execute(
        """
        SELECT COUNT(*) AS c FROM (
          SELECT DISTINCT p.id
            FROM group_members gm
            JOIN polls p ON p.group_id = gm.group_id
            LEFT JOIN LATERAL (
              SELECT MAX(pv.last_viewed_at) AS last_viewed_at
                FROM poll_views pv
               WHERE pv.poll_id = p.id AND pv.browser_id = ANY(%(bids)s::uuid[])
            ) seen ON TRUE
           WHERE gm.browser_id = ANY(%(bids)s::uuid[])
             AND p.id <> ALL(%(old)s::uuid[])
             -- Closed-before-join filter (mirrors filter_visible_polls): a poll
             -- closed before this member joined is hidden in the app, so it must
             -- not inflate the badge. updated_at is the close_at proxy; gm.joined_at
             -- per-row + DISTINCT gives the most-permissive (MIN joined_at) rule.
             AND (p.is_closed = false OR p.updated_at >= gm.joined_at)
             AND (
               (seen.last_viewed_at IS NULL OR seen.last_viewed_at < p.created_at)
               OR (%(voting)s AND p.prephase_deadline IS NOT NULL
                   AND p.prephase_deadline <= NOW()
                   AND (seen.last_viewed_at IS NULL OR seen.last_viewed_at < p.prephase_deadline))
               OR (%(results)s AND p.is_closed = true
                   AND (seen.last_viewed_at IS NULL OR seen.last_viewed_at < p.updated_at))
             )
        ) t
        """,
        {"bids": bids, "voting": on_voting_open, "results": on_results, "old": old},
    ).fetchone()
    return int(row["c"] or 0)


def _badge_counts_for_browsers(conn, browser_ids: set[str]) -> dict[str, int]:
    """Resolve each recipient's settings + compute their badge count, in one
    short connection block (so the network sends don't hold a DB connection)."""
    out: dict[str, int] = {}
    for bid in browser_ids:
        todo, voting, results = _badge_settings_for_browser(conn, bid)
        out[bid] = compute_badge_count(
            conn, bid, todo_mode=todo, on_voting_open=voting, on_results=results
        )
    return out


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

    # Per-recipient app-icon badge count, computed up front in one short
    # connection block so the network sends below don't hold a DB connection.
    browser_ids = {s["browser_id"] for s in subscriptions if s.get("browser_id")}
    badge_by_browser: dict[str, int] = {}
    if browser_ids:
        try:
            with get_db() as conn:
                badge_by_browser = _badge_counts_for_browsers(conn, browser_ids)
        except Exception as exc:  # noqa: BLE001
            # Badge is best-effort; fall back to the payload's default badge.
            log.warning("badge count computation failed: %s", exc)

    def _payload_for(sub: dict) -> dict:
        count = badge_by_browser.get(sub.get("browser_id"))
        return {**payload, "badge": count} if count is not None else payload

    if web_subs and vapid is not None:
        for sub in web_subs:
            ok, err, should_delete = _send_web_push(sub, _payload_for(sub), vapid)
            web_results.append((sub["id"], ok, err, should_delete))

    if apns_subs and apns_configured():
        jwt_token = _apns_jwt(int(time.time()))
        with httpx.Client(http2=True) as client:
            for sub in apns_subs:
                ok, err, should_delete = _send_apns(sub, _payload_for(sub), client, jwt_token)
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


# Account-aware mute pref (migration 125) for a member row aliased `gm`
# (exposing gm.browser_id + gm.group_id). The pref follows the account
# (user_id) when the browser has one, else the browser; a missing row is the
# default ON. Account pref wins over a stale browser pref via COALESCE order.
_PREF_JOIN = """
                LEFT JOIN user_browsers gm_ub ON gm_ub.browser_id = gm.browser_id
                LEFT JOIN group_notification_preferences apref
                  ON apref.user_id = gm_ub.user_id AND apref.group_id = gm.group_id
                LEFT JOIN group_notification_preferences bpref
                  ON bpref.browser_id = gm.browser_id AND bpref.group_id = gm.group_id
"""
_PREF_ON_TRUE = "COALESCE(apref.notify_new_poll, bpref.notify_new_poll, TRUE) = TRUE"

# Gap 1: skip members who ✕'d THIS poll (filed it in their Old tab) — "ignore"
# silences poll-closed + phase-transition pushes. Expects the recipient query to
# alias the member row `gm` AND join `gm_ub` (the `_PREF_JOIN` row, exposing
# gm_ub.user_id) and bind %(pid)s to the poll_id.
#
# Account-aware, mirroring the badge path (`effective_follow_states` /
# `old_poll_ids_for_browsers`): a member browser is ignored when the EFFECTIVE
# follow state for this poll — the most-recently-updated `poll_follow_state` row
# across every browser linked to the member's account — is 'old'. So ✕ on device
# A also silences device B's push for the same account. Anonymous members
# (gm_ub.user_id IS NULL) fall back to their own browser's row only, since the
# `au.user_id = NULL` join matches nothing and the union reduces to gm.browser_id.
# No row anywhere → COALESCE to 'new' (default-follow) → not ignored.
_NOT_IGNORED = """
                COALESCE((
                  SELECT pfs.state
                    FROM poll_follow_state pfs
                   WHERE pfs.poll_id = %(pid)s::uuid
                     AND pfs.browser_id IN (
                       SELECT au.browser_id FROM user_browsers au
                        WHERE au.user_id = gm_ub.user_id
                       UNION ALL
                       SELECT gm.browser_id
                     )
                   ORDER BY pfs.updated_at DESC
                   LIMIT 1
                ), 'new') <> 'old'
"""


# Skip members who have already voted/abstained on THIS poll. Account-aware,
# mirroring `_NOT_IGNORED`: a vote on any of the poll's questions by ANY browser
# linked to the member's account (gm_ub.user_id) — or the member browser itself
# — counts as "acted". Expects the recipient query to alias the member row `gm`,
# join `gm_ub` (the `_PREF_JOIN` row), and bind %(pid)s to the poll_id. Used by
# the vote-reminder pass so a reminder only reaches people who haven't responded.
_NOT_VOTED = """
                NOT EXISTS (
                  SELECT 1 FROM votes v
                    JOIN questions q ON v.question_id = q.id
                   WHERE q.poll_id = %(pid)s::uuid
                     AND v.browser_id IN (
                       SELECT au.browser_id FROM user_browsers au
                        WHERE au.user_id = gm_ub.user_id
                       UNION ALL
                       SELECT gm.browser_id
                     )
                )
"""


def fan_out_to_browsers(browser_ids: list[str], payload: dict) -> None:
    """Send a push to an explicit set of browser_ids. Unlike the group-scoped
    fan-outs, the recipient set is computed by the caller (e.g. the vote-reminder
    pass, which has already applied the mute / ignore / not-voted / due gates per
    browser). Same safety contract: every error caught, logged, swallowed.
    """
    if not browser_ids:
        return
    try:
        with get_db() as conn:
            subscriptions = _fetch_subscriptions(conn, browser_ids)
            if not subscriptions:
                return
            vapid = _load_vapid_from_db(conn)
        _dispatch_pushes(subscriptions, payload, vapid)
    except Exception as exc:  # noqa: BLE001
        log.exception("fan_out_to_browsers failed: %s", exc)


def fan_out_new_poll(group_id: str, creator_browser_id: str | None, payload: dict) -> None:
    """Send a 'new poll' push to every group member (except the creator)
    whose notification preference is on. Safe to call inline OR from a
    BackgroundTasks closure — every error is caught, logged, and
    swallowed so this never blocks the response.

    Default-ON semantics for the pref: a missing row in
    `group_notification_preferences` counts as ON. The pref follows the
    account (migration 125), so muting on one device mutes everywhere.
    """
    try:
        with get_db() as conn:
            recipients = conn.execute(
                f"""
                SELECT gm.browser_id::text AS browser_id
                FROM group_members gm
                {_PREF_JOIN}
                WHERE gm.group_id = %(gid)s
                  AND (%(creator)s::uuid IS NULL OR gm.browser_id != %(creator)s::uuid)
                  AND {_PREF_ON_TRUE}
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
    admin_user_ids: list[str],
    payload: dict,
) -> None:
    """Phase F: send a 'someone wants to join your group' push to every
    browser each group ADMIN is signed in on, subject to the per-group
    notification preference. Same safety contract as `fan_out_new_poll`:
    every error caught, logged, and swallowed so a failing push service
    can't block the request response.

    Migration 142 made admins (not the vestigial `creator_user_id`) the
    people who approve/deny join requests, so they're the recipient set
    — a promoted co-admin hears about requests they can act on, and a
    group whose creator deleted their account still notifies its
    surviving admins. Recipients are derived from `user_browsers WHERE
    user_id = ANY(admins)` (one per linked browser, per admin), filtered
    down to those with active push subscriptions, and gated on the same
    `notify_new_poll` pref the new-poll path uses — for v1 the per-group
    pref is the single signal that an admin wants to hear about anything
    happening on the group. Phase I can add a dedicated
    `notify_join_request` column if we want to surface join requests
    separately from new-poll noise.
    """
    try:
        if not admin_user_ids:
            return
        with get_db() as conn:
            recipients = conn.execute(
                """
                SELECT DISTINCT ub.browser_id::text AS browser_id
                  FROM user_browsers ub
                  LEFT JOIN group_notification_preferences apref
                    ON apref.user_id = ub.user_id
                   AND apref.group_id = %(gid)s::uuid
                  LEFT JOIN group_notification_preferences bpref
                    ON bpref.browser_id = ub.browser_id
                   AND bpref.group_id = %(gid)s::uuid
                 WHERE ub.user_id = ANY(%(uids)s::uuid[])
                   AND COALESCE(apref.notify_new_poll, bpref.notify_new_poll, TRUE) = TRUE
                """,
                {"gid": group_id, "uids": list(admin_user_ids)},
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


def fan_out_to_user(
    group_id: str,
    user_id: str,
    payload: dict,
) -> None:
    """Send a group-scoped push to every browser the given account is signed
    in on, subject to the per-group notification preference (default ON when
    the account has no pref row yet, e.g. a freshly-added member). Same safety
    contract as `fan_out_join_request`: every error caught, logged, swallowed.

    Targets `user_browsers WHERE user_id = user_id` — the recipient is one
    specific account, not the group at large. Callers build their own payload
    (member-added, plus-one invite, etc.); this just routes it. Reuses the
    `notify_new_poll` pref as the single "do I want to hear about this group?"
    signal.
    """
    try:
        with get_db() as conn:
            recipients = conn.execute(
                """
                SELECT DISTINCT ub.browser_id::text AS browser_id
                  FROM user_browsers ub
                  LEFT JOIN group_notification_preferences apref
                    ON apref.user_id = %(uid)s::uuid
                   AND apref.group_id = %(gid)s::uuid
                  LEFT JOIN group_notification_preferences bpref
                    ON bpref.browser_id = ub.browser_id
                   AND bpref.group_id = %(gid)s::uuid
                 WHERE ub.user_id = %(uid)s::uuid
                   AND COALESCE(apref.notify_new_poll, bpref.notify_new_poll, TRUE) = TRUE
                """,
                {"gid": group_id, "uid": user_id},
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
        log.exception("fan_out_to_user failed: %s", exc)


def fan_out_poll_closed(group_id: str, poll_id: str, payload: dict) -> None:
    """Send a 'poll closed' push to every group member whose notification
    preference is on. Same safety contract + default-ON pref semantics as
    `fan_out_new_poll`.

    Audience is the whole group with NO actor exclusion (unlike new-poll,
    which excludes the creator): a close is detected by the cron tick
    decoupled from whoever closed it, deadline closes have no actor at all,
    and the poll's creator legitimately wants the 'your poll closed — results
    are in' nudge. `poll_id` is unused by the query (the payload already
    carries the routing url) but kept in the signature so callers read
    symmetrically with `fan_out_phase_transition`.
    """
    try:
        with get_db() as conn:
            recipients = conn.execute(
                f"""
                SELECT gm.browser_id::text AS browser_id
                FROM group_members gm
                {_PREF_JOIN}
                WHERE gm.group_id = %(gid)s
                  AND {_PREF_ON_TRUE}
                  AND {_NOT_IGNORED}
                """,
                {"gid": group_id, "pid": poll_id},
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
        log.exception("fan_out_poll_closed failed: %s", exc)


def fan_out_phase_transition(
    group_id: str,
    poll_id: str,
    payload: dict,
    *,
    prevoting_on: bool,
    latest_contribution,
) -> None:
    """Send a 'voting is open' push when a poll leaves its suggestion /
    availability prephase. Same safety contract + default-ON pref semantics
    as `fan_out_new_poll`.

    Audience is the whole group with the prephase pref on, MINUS members who
    are already done — the single skip-case the user specified:

        prevoting was on  AND  the member prevoted  AND  no option-adding
        contribution arrived after their last view of the poll.

    Everyone else is notified, including members who never prevoted (they may
    have been deliberately holding off until the option set settled) and
    prevoters who'd see new options they haven't looked at yet.

    `prevoting_on` is the poll's `allow_pre_ranking` (default true).
    `latest_contribution` is the timestamp of the most recent option-adding
    vote (a suggestion or an availability submission) anywhere in the poll, or
    None when the prephase drew no contributions. When it's None nobody can be
    "satisfied" (there were no options to have seen), so everyone is notified.

    Membership is keyed per browser_id (matching new-poll fan-out): a person
    signed in on two browsers who prevoted on one may still be notified on the
    other. Accepted for v1 — the cross-browser union would add a
    `user_browsers` walk for a marginal dedup.
    """
    try:
        with get_db() as conn:
            recipients = conn.execute(
                f"""
                SELECT gm.browser_id::text AS browser_id
                FROM group_members gm
                {_PREF_JOIN}
                WHERE gm.group_id = %(gid)s
                  AND {_PREF_ON_TRUE}
                  AND {_NOT_IGNORED}
                  AND NOT (
                    %(prevoting_on)s
                    AND EXISTS (
                      SELECT 1 FROM votes v
                      JOIN questions q ON v.question_id = q.id
                      WHERE q.poll_id = %(pid)s AND v.browser_id = gm.browser_id
                    )
                    AND %(latest)s IS NOT NULL
                    AND EXISTS (
                      SELECT 1 FROM poll_views pv
                      WHERE pv.poll_id = %(pid)s
                        AND pv.browser_id = gm.browser_id
                        AND pv.last_viewed_at >= %(latest)s
                    )
                  )
                """,
                {
                    "gid": group_id,
                    "pid": poll_id,
                    "prevoting_on": prevoting_on,
                    "latest": latest_contribution,
                },
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
        log.exception("fan_out_phase_transition failed: %s", exc)
