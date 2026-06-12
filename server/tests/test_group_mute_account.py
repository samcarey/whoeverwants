"""Account-keyed group mute preference (migration 125).

Muting a group's "Activity" notifications now follows the account: it applies
on every device the user is signed in on, and the fan-out skips all of them.
Account-less callers still mute per-browser.
"""

import uuid

import psycopg

import services.push
from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import TEST_DB_URL, bid_headers, create_poll


def _bid_headers(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _bearer(bid, token):
    h = _bid_headers(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _sign_in(client, browser_id, email):
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "INSERT INTO magic_link_tokens (token_hash, email, browser_id, expires_at) "
            "VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')",
            (hash_token(token), normalize_email(email), browser_id),
        )
        conn.commit()
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"]


def _add_member_and_sub(group_id, browser_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "INSERT INTO group_members (group_id, browser_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (group_id, browser_id),
        )
        conn.execute(
            "INSERT INTO push_subscriptions (browser_id, kind, endpoint) "
            "VALUES (%s, 'web_push', %s) ON CONFLICT DO NOTHING",
            (browser_id, f"https://example.test/{browser_id}"),
        )
        conn.commit()


def _recipients(monkeypatch, group_id, creator_bid):
    """Run fan_out_new_poll, capturing the browser_ids it would push to."""
    captured = {}

    def fake_dispatch(subscriptions, payload, vapid):
        captured["browser_ids"] = sorted(s["browser_id"] for s in subscriptions)

    monkeypatch.setattr(services.push, "_dispatch_pushes", fake_dispatch)
    services.push.fan_out_new_poll(group_id, creator_bid, {"title": "x"})
    return captured.get("browser_ids", [])


def test_mute_while_signed_in_applies_to_all_devices(client, monkeypatch):
    email = f"mute-{uuid.uuid4().hex[:8]}@example.com"
    bid_a, bid_b = str(uuid.uuid4()), str(uuid.uuid4())
    creator = str(uuid.uuid4())
    token_a, _ = _sign_in(client, bid_a, email)
    token_b, _ = _sign_in(client, bid_b, email)

    poll = create_poll(client, browser_id=creator)
    group_id, route = poll["group_id"], poll["group_short_id"]
    _add_member_and_sub(group_id, bid_a)
    _add_member_and_sub(group_id, bid_b)

    # Default ON: both devices are recipients.
    assert _recipients(monkeypatch, group_id, creator) == sorted([bid_a, bid_b])

    # Mute on device A (signed in) → account-keyed.
    resp = client.put(
        f"/api/notifications/groups/{route}",
        json={"notify_new_poll": False},
        headers=_bearer(bid_a, token_a),
    )
    assert resp.status_code == 200, resp.text

    # Fan-out now skips BOTH devices of the account.
    assert _recipients(monkeypatch, group_id, creator) == []

    # Device B (same account) reads the mute too.
    got = client.get(
        f"/api/notifications/groups/{route}", headers=_bearer(bid_b, token_b)
    )
    assert got.json()["notify_new_poll"] is False


def test_account_less_mute_is_per_browser(client, monkeypatch):
    bid_a, bid_b = str(uuid.uuid4()), str(uuid.uuid4())
    creator = str(uuid.uuid4())
    poll = create_poll(client, browser_id=creator)
    group_id, route = poll["group_id"], poll["group_short_id"]
    _add_member_and_sub(group_id, bid_a)
    _add_member_and_sub(group_id, bid_b)

    # A mutes (no account → browser-keyed); B is unaffected.
    resp = client.put(
        f"/api/notifications/groups/{route}",
        json={"notify_new_poll": False},
        headers=_bid_headers(bid_a),
    )
    assert resp.status_code == 200, resp.text
    assert _recipients(monkeypatch, group_id, creator) == [bid_b]


def _join_request_recipients(monkeypatch, group_id, admin_user_ids):
    """Run fan_out_join_request, capturing the browser_ids it would push to."""
    captured = {}

    def fake_dispatch(subscriptions, payload, vapid):
        captured["browser_ids"] = sorted(s["browser_id"] for s in subscriptions)

    monkeypatch.setattr(services.push, "_dispatch_pushes", fake_dispatch)
    services.push.fan_out_join_request(group_id, admin_user_ids, {"title": "x"})
    return captured.get("browser_ids", [])


def test_join_request_fan_out_targets_every_admin_account_aware(
    client, monkeypatch
):
    """`fan_out_join_request` (migration-142 form: a LIST of admin user_ids)
    must reach every browser of every admin, and an account-keyed mute on one
    admin must silence ALL of that admin's devices without touching the
    other admin's."""
    email_a = f"jr-admin-a-{uuid.uuid4().hex[:8]}@example.com"
    email_b = f"jr-admin-b-{uuid.uuid4().hex[:8]}@example.com"
    # Admin A is signed in on two devices; admin B on one.
    bid_a1, bid_a2, bid_b = (str(uuid.uuid4()) for _ in range(3))
    token_a, uid_a = _sign_in(client, bid_a1, email_a)
    _sign_in(client, bid_a2, email_a)
    _, uid_b = _sign_in(client, bid_b, email_b)

    poll = create_poll(client, browser_id=str(uuid.uuid4()))
    group_id, route = poll["group_id"], poll["group_short_id"]
    for bid in (bid_a1, bid_a2, bid_b):
        _add_member_and_sub(group_id, bid)

    # Both admins, default pref ON → every linked browser is a recipient.
    assert _join_request_recipients(monkeypatch, group_id, [uid_a, uid_b]) == (
        sorted([bid_a1, bid_a2, bid_b])
    )

    # Admin A mutes the group (account-keyed) → both of A's devices drop;
    # B still gets it.
    resp = client.put(
        f"/api/notifications/groups/{route}",
        json={"notify_new_poll": False},
        headers=_bearer(bid_a1, token_a),
    )
    assert resp.status_code == 200, resp.text
    assert _join_request_recipients(
        monkeypatch, group_id, [uid_a, uid_b]
    ) == [bid_b]

    # Empty admin set (admin-less group) → no-op.
    assert _join_request_recipients(monkeypatch, group_id, []) == []
