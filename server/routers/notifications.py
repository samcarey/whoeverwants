"""Push notification endpoints.

Three concerns are served here:

  * `GET /api/notifications/config` — exposes the server's VAPID public
    key so the FE can call `pushManager.subscribe({applicationServerKey})`.
    Also returns `apns_supported` so the iOS Capacitor shell knows
    whether the server is configured to deliver APNS pushes.

  * `POST/DELETE /api/notifications/subscriptions` — register or
    unregister this browser's push subscription (web push) or device
    token (apns).

  * `GET/PUT /api/notifications/groups/{route_id}` — per-group toggle.
    Default ON: a missing row means the user is opted in. The PUT writes
    or upserts the row.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from database import get_db
from middleware import browser_id_from_request as _browser_id
from middleware import user_id_from_request as _user_id
from services.auth import resolve_actor_user_id
from services.groups import resolve_group_id_from_route_id
from services.push import apns_configured, compute_badge_count, get_vapid_keys


router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationConfig(BaseModel):
    """Server-side push-config the FE needs to subscribe. `vapid_public_key`
    is the URL-safe base64 application server key. `apns_supported`
    indicates the server can dispatch APNS pushes to registered device
    tokens (Capacitor iOS shell)."""

    vapid_public_key: str
    apns_supported: bool


class WebPushKeys(BaseModel):
    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)


class SubscriptionRequest(BaseModel):
    """Register a push subscription for the calling browser. For `web_push`,
    `endpoint` is the push service URL and `keys` carries the client
    encryption material. For `apns`, `endpoint` is the device token
    (base64 or hex string the FE receives from
    `@capacitor/push-notifications`) and `bundle_id` distinguishes prod
    vs dev iOS builds.
    """

    kind: Literal["web_push", "apns"]
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: WebPushKeys | None = None
    bundle_id: str | None = Field(default=None, max_length=128)
    user_agent: str | None = Field(default=None, max_length=512)


class SubscriptionResponse(BaseModel):
    id: str
    kind: str
    endpoint: str


class UnsubscribeRequest(BaseModel):
    """Identify the subscription to drop. We use endpoint rather than
    subscription id because the FE never sees the server-side id; it
    only has the push service's endpoint URL (web push) or device
    token (apns)."""

    endpoint: str = Field(min_length=1, max_length=2048)


class GroupNotificationPreference(BaseModel):
    """One toggle per (browser, group). `notify_new_poll` defaults to
    True via the server's missing-row-is-on semantics."""

    notify_new_poll: bool


def _require_browser_id(request: Request) -> str:
    browser_id = _browser_id(request)
    if not browser_id:
        raise HTTPException(status_code=400, detail="Missing browser identity")
    return browser_id


class BadgeCountResponse(BaseModel):
    count: int


@router.get("/badge", response_model=BadgeCountResponse)
def get_badge_count(
    request: Request,
    todo_mode: bool = False,
    on_voting_open: bool = True,
    on_results: bool = True,
):
    """The app-icon badge number for the calling browser under the supplied
    settings. The FE passes its EFFECTIVE settings (account-synced when signed
    in, else localStorage) so this works for anonymous users too — unlike the
    push path, which can only see account/default settings. Called on app focus
    for the client-side `setAppBadge` resync. See CLAUDE.md 'App-Icon Badge
    Model'. Returns 0 for an unidentified browser rather than erroring."""
    browser_id = _browser_id(request)
    if not browser_id:
        return BadgeCountResponse(count=0)
    with get_db() as conn:
        count = compute_badge_count(
            conn,
            browser_id,
            user_id=_user_id(request),
            todo_mode=todo_mode,
            on_voting_open=on_voting_open,
            on_results=on_results,
        )
    return BadgeCountResponse(count=count)


@router.get("/config", response_model=NotificationConfig)
def get_notification_config():
    """Return the server-side push config the FE needs to subscribe."""
    keys = get_vapid_keys()
    return NotificationConfig(
        vapid_public_key=keys.public_b64,
        apns_supported=apns_configured(),
    )


@router.post("/subscriptions", response_model=SubscriptionResponse, status_code=201)
def register_subscription(req: SubscriptionRequest, request: Request):
    browser_id = _require_browser_id(request)

    if req.kind == "web_push":
        if req.keys is None:
            raise HTTPException(
                status_code=400, detail="Web push subscriptions require encryption keys"
            )
        p256dh, auth = req.keys.p256dh, req.keys.auth
    else:
        p256dh = auth = None

    # Upsert on (browser_id, endpoint). Re-registering the same endpoint
    # refreshes the keys (Web Push periodically rotates them) without
    # creating a duplicate row.
    with get_db() as conn:
        row = conn.execute(
            """
            INSERT INTO push_subscriptions
              (browser_id, kind, endpoint, p256dh, auth, bundle_id, user_agent)
            VALUES
              (%(browser_id)s, %(kind)s, %(endpoint)s, %(p256dh)s, %(auth)s,
               %(bundle_id)s, %(user_agent)s)
            ON CONFLICT (browser_id, endpoint) DO UPDATE SET
              kind = EXCLUDED.kind,
              p256dh = EXCLUDED.p256dh,
              auth = EXCLUDED.auth,
              bundle_id = EXCLUDED.bundle_id,
              user_agent = EXCLUDED.user_agent,
              failure_count = 0,
              last_error = NULL,
              updated_at = NOW()
            RETURNING id, kind, endpoint
            """,
            {
                "browser_id": browser_id,
                "kind": req.kind,
                "endpoint": req.endpoint,
                "p256dh": p256dh,
                "auth": auth,
                "bundle_id": req.bundle_id,
                "user_agent": req.user_agent,
            },
        ).fetchone()
    return SubscriptionResponse(
        id=str(row["id"]),
        kind=row["kind"],
        endpoint=row["endpoint"],
    )


@router.delete("/subscriptions", status_code=204)
def unregister_subscription(req: UnsubscribeRequest, request: Request):
    """Idempotent unsubscribe — strangers and not-currently-subscribed
    browsers both 204."""
    browser_id = _require_browser_id(request)
    with get_db() as conn:
        conn.execute(
            "DELETE FROM push_subscriptions "
            "WHERE browser_id = %(b)s AND endpoint = %(e)s",
            {"b": browser_id, "e": req.endpoint},
        )


@router.get(
    "/groups/{route_id}",
    response_model=GroupNotificationPreference,
)
def get_group_preference(route_id: str, request: Request):
    """Return the caller's notification preference for this group. The pref
    follows the account (keyed by user_id) when the caller has one, else
    the browser. Defaults to ON when no row exists."""
    browser_id = _require_browser_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        user_id = resolve_actor_user_id(
            conn, user_id=_user_id(request), browser_id=browser_id
        )
        if user_id:
            row = conn.execute(
                "SELECT notify_new_poll FROM group_notification_preferences "
                "WHERE user_id = %(u)s AND group_id = %(g)s",
                {"u": user_id, "g": group_id},
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT notify_new_poll FROM group_notification_preferences "
                "WHERE browser_id = %(b)s AND group_id = %(g)s",
                {"b": browser_id, "g": group_id},
            ).fetchone()
    notify = True if row is None else bool(row["notify_new_poll"])
    return GroupNotificationPreference(notify_new_poll=notify)


@router.put(
    "/groups/{route_id}",
    response_model=GroupNotificationPreference,
)
def set_group_preference(
    route_id: str, req: GroupNotificationPreference, request: Request
):
    """Set the per-group notification preference. Keyed to the caller's
    account (so it applies on every signed-in device) when they have one,
    else to the browser."""
    browser_id = _require_browser_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        user_id = resolve_actor_user_id(
            conn, user_id=_user_id(request), browser_id=browser_id
        )
        if user_id:
            conn.execute(
                """
                INSERT INTO group_notification_preferences
                  (user_id, group_id, notify_new_poll)
                VALUES (%(u)s, %(g)s, %(notify)s)
                ON CONFLICT (user_id, group_id) WHERE user_id IS NOT NULL
                DO UPDATE SET
                  notify_new_poll = EXCLUDED.notify_new_poll,
                  updated_at = NOW()
                """,
                {"u": user_id, "g": group_id, "notify": req.notify_new_poll},
            )
        else:
            conn.execute(
                """
                INSERT INTO group_notification_preferences
                  (browser_id, group_id, notify_new_poll)
                VALUES (%(b)s, %(g)s, %(notify)s)
                ON CONFLICT (browser_id, group_id) WHERE browser_id IS NOT NULL
                DO UPDATE SET
                  notify_new_poll = EXCLUDED.notify_new_poll,
                  updated_at = NOW()
                """,
                {"b": browser_id, "g": group_id, "notify": req.notify_new_poll},
            )
    return req
