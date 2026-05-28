"""Phase F (group join requests) end-to-end coverage.

Exercises every state machine transition documented in
`docs/auth-access-model.md` + `services/join_requests.py`:

  * POST /join-requests
    - anonymous → 401
    - signed-in non-member → 201 + status='pending'
    - signed-in non-member, repeat → 200 + status='already_pending'
    - signed-in member → 200 + status='already_member'
    - signed-in creator → 200 + status='already_member'
    - 404 on unresolvable route
  * GET /join-requests
    - anonymous → 401
    - non-creator → 403
    - creator → list, oldest first
    - 404 on unresolvable route
    - groups without a recorded creator → 403
  * POST /join-requests/<id>/decide
    - anonymous → 401
    - non-creator → 403
    - cross-group request_id (creator of A tries to decide a request
      on group B) → 404
    - already-decided → 404
    - approve → status='approved', requester gets membership +
      visibility on next read
    - deny → status='denied', no membership

Tests use the shared `client` fixture and mirror
`test_group_privacy.py`'s magic-link sign-in helper so the session
token is real.
"""

import uuid

import psycopg
import pytest

from services.auth import (
    generate_token,
    hash_token,
    normalize_email,
)
from tests.conftest import TEST_DB_URL


@pytest.fixture
def creator_browser():
    return str(uuid.uuid4())


@pytest.fixture
def requester_browser():
    return str(uuid.uuid4())


@pytest.fixture
def stranger_browser():
    return str(uuid.uuid4())


def _bid_headers(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _bearer_headers(bid, token):
    h = _bid_headers(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _issue_known_magic_link(email, browser_id):
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO magic_link_tokens
                  (token_hash, email, browser_id, expires_at)
                VALUES
                  (%s, %s, %s, NOW() + INTERVAL '15 minutes')
                """,
                (hash_token(token), normalize_email(email), browser_id),
            )
        conn.commit()
    return token


def _sign_in(client, browser_id, email=None, name="Test User"):
    """Run a full magic-link verify and return (session_token, user_id,
    email). The email is the server-normalized (lowercase, trimmed)
    form so tests can compare against `requester_email` from list /
    create endpoint responses without surface mismatches.

    `name` defaults to a non-empty display name so the join-request
    name gate (which requires `users.display_name`) is satisfied. Pass
    `name=None` to leave the account nameless — useful for testing
    that gate's 400 path.
    """
    raw_email = email or f"phasef-{uuid.uuid4().hex[:8]}@example.com"
    token = _issue_known_magic_link(raw_email, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    session_token = body["session_token"]
    if name is not None:
        named = client.post(
            "/api/auth/me/name",
            json={"name": name},
            headers=_bearer_headers(browser_id, session_token),
        )
        assert named.status_code == 200, named.text
    return session_token, body["user"]["user_id"], normalize_email(raw_email)


def _create_private_group(client, browser_id, token):
    """Signed-in create → privacy='private', creator_user_id recorded."""
    resp = client.post(
        "/api/groups",
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 201, resp.text
    group = resp.json()
    assert group["privacy"] == "private"
    return group


def _create_public_anon_group(client, browser_id):
    """Anonymous create → privacy='public', creator_user_id NULL.
    Used for the "no recorded creator" 403 cases."""
    resp = client.post("/api/groups", headers=_bid_headers(browser_id))
    assert resp.status_code == 201, resp.text
    group = resp.json()
    assert group["privacy"] == "public"
    assert group["creator_user_id"] is None
    return group


# --------------------------------------------------------------------- create


def test_create_join_request_anonymous_returns_401(
    client, creator_browser, stranger_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    resp = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "Hi"},
        headers=_bid_headers(stranger_browser),
    )
    assert resp.status_code == 401


def test_create_join_request_unknown_group_returns_404(
    client, requester_browser
):
    rtoken, _, _ = _sign_in(client, requester_browser)
    bogus = str(uuid.uuid4())
    resp = client.post(
        f"/api/groups/{bogus}/join-requests",
        json={"message": "Hi"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert resp.status_code == 404


def test_create_join_request_requires_account_name(
    client, creator_browser, requester_browser
):
    """A signed-in caller whose account has no `display_name` is rejected
    with 400 — the creator wouldn't be able to recognize who's asking."""
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    # Sign in without setting a name so users.display_name stays NULL.
    rtoken, _, _ = _sign_in(client, requester_browser, name=None)
    resp = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "Hi"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert resp.status_code == 400, resp.text
    assert "name" in resp.json()["detail"].lower()


def test_create_join_request_new_returns_pending(
    client, creator_browser, requester_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    rtoken, _, remail = _sign_in(client, requester_browser)
    resp = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "Hi, it's Alice"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["request"]["message"] == "Hi, it's Alice"
    assert body["request"]["requester_email"] == remail


def test_create_join_request_repeat_returns_already_pending(
    client, creator_browser, requester_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    rtoken, _, _ = _sign_in(client, requester_browser)
    first = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "first"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert first.json()["status"] == "pending"

    # Second call with DIFFERENT message — the existing pending row
    # wins (no overwrite), status reports 'already_pending'.
    second = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "second"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert second.status_code == 200, second.text
    assert second.json()["status"] == "already_pending"
    assert second.json()["request"]["message"] == "first"


def test_create_join_request_creator_short_circuits(
    client, creator_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    resp = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "I am the creator"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "already_member"
    assert resp.json()["request"] is None


def test_create_join_request_existing_member_short_circuits(
    client, creator_browser, requester_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    # Approve the requester so they have a membership row.
    rtoken, _, _ = _sign_in(client, requester_browser)
    create = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "let me in"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    request_id = create.json()["request"]["id"]
    decide = client.post(
        f"/api/groups/{group['id']}/join-requests/{request_id}/decide",
        json={"action": "approve"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert decide.status_code == 200, decide.text

    # Now they're a member — re-request should short-circuit.
    repeat = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "again"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert repeat.status_code == 200
    assert repeat.json()["status"] == "already_member"


# ----------------------------------------------------------------------- list


def test_list_join_requests_anonymous_returns_401(client, creator_browser):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    resp = client.get(
        f"/api/groups/{group['id']}/join-requests",
        headers=_bid_headers(creator_browser),  # no token
    )
    assert resp.status_code == 401


def test_list_join_requests_non_creator_returns_403(
    client, creator_browser, requester_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    rtoken, _, _ = _sign_in(client, requester_browser)

    resp = client.get(
        f"/api/groups/{group['id']}/join-requests",
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert resp.status_code == 403


def test_list_join_requests_creator_sees_pending_in_order(
    client, creator_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    # Two requesters with different emails so we can spot ordering.
    rb1 = str(uuid.uuid4())
    rb2 = str(uuid.uuid4())
    rt1, _, e1 = _sign_in(client, rb1)
    rt2, _, e2 = _sign_in(client, rb2)
    client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "first"},
        headers=_bearer_headers(rb1, rt1),
    )
    client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "second"},
        headers=_bearer_headers(rb2, rt2),
    )

    resp = client.get(
        f"/api/groups/{group['id']}/join-requests",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 2
    assert body[0]["message"] == "first"
    assert body[0]["requester_email"] == e1
    assert body[1]["message"] == "second"
    assert body[1]["requester_email"] == e2


def test_list_join_requests_anon_created_group_returns_403(
    client, creator_browser
):
    """Anonymous-created groups have no recorded creator — no one can
    list them. Phase I will add a 'claim' upgrade path."""
    group = _create_public_anon_group(client, creator_browser)
    ctoken, _, _ = _sign_in(client, creator_browser)

    resp = client.get(
        f"/api/groups/{group['id']}/join-requests",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 403


# --------------------------------------------------------------------- decide


def test_decide_anonymous_returns_401(client, creator_browser):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    bogus_request = str(uuid.uuid4())
    resp = client.post(
        f"/api/groups/{group['id']}/join-requests/{bogus_request}/decide",
        json={"action": "approve"},
        headers=_bid_headers(creator_browser),
    )
    assert resp.status_code == 401


def test_decide_non_creator_returns_403(
    client, creator_browser, requester_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    rtoken, _, _ = _sign_in(client, requester_browser)

    create = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "let me in"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    request_id = create.json()["request"]["id"]

    # Requester tries to approve their own request.
    resp = client.post(
        f"/api/groups/{group['id']}/join-requests/{request_id}/decide",
        json={"action": "approve"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert resp.status_code == 403


def test_decide_cross_group_request_returns_404(
    client, creator_browser, requester_browser
):
    """Creator of group A can't decide on a request belonging to
    group B — even if they correctly guess the request_id. The
    route_id + request_id pairing is enforced server-side."""
    ctoken, _, _ = _sign_in(client, creator_browser)
    group_a = _create_private_group(client, creator_browser, ctoken)
    # Different creator browser → different user → different group.
    second_creator_browser = str(uuid.uuid4())
    btoken, _, _ = _sign_in(client, second_creator_browser)
    group_b = _create_private_group(client, second_creator_browser, btoken)

    rtoken, _, _ = _sign_in(client, requester_browser)
    create = client.post(
        f"/api/groups/{group_b['id']}/join-requests",
        json={"message": "for B"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    request_id = create.json()["request"]["id"]

    # Creator of A tries to decide on a request that belongs to B.
    resp = client.post(
        f"/api/groups/{group_a['id']}/join-requests/{request_id}/decide",
        json={"action": "approve"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 404


def test_decide_already_decided_returns_404(
    client, creator_browser, requester_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    rtoken, _, _ = _sign_in(client, requester_browser)

    create = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "let me in"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    request_id = create.json()["request"]["id"]
    first = client.post(
        f"/api/groups/{group['id']}/join-requests/{request_id}/decide",
        json={"action": "approve"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/groups/{group['id']}/join-requests/{request_id}/decide",
        json={"action": "approve"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert second.status_code == 404


def test_decide_invalid_action_returns_400(
    client, creator_browser, requester_browser
):
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    rtoken, _, _ = _sign_in(client, requester_browser)
    create = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "x"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    request_id = create.json()["request"]["id"]
    resp = client.post(
        f"/api/groups/{group['id']}/join-requests/{request_id}/decide",
        json={"action": "maybe"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 400


def test_approve_writes_membership_and_grants_visibility(
    client, creator_browser, requester_browser
):
    """End-to-end: requester can't see the private group; after
    approve, they CAN see it via /by-route-id. This is the load-bearing
    happy path."""
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    rtoken, _, _ = _sign_in(client, requester_browser)

    # Pre-approval: requester can't see the private group.
    pre = client.get(
        f"/api/groups/by-route-id/{group['id']}",
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert pre.status_code == 404

    create = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "let me in"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    request_id = create.json()["request"]["id"]
    decide = client.post(
        f"/api/groups/{group['id']}/join-requests/{request_id}/decide",
        json={"action": "approve"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert decide.status_code == 200
    assert decide.json()["status"] == "approved"

    # Post-approval: requester sees the group (no longer 404).
    post = client.get(
        f"/api/groups/by-route-id/{group['id']}",
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert post.status_code == 200, post.text


def test_approve_schedules_member_added_push(
    client, creator_browser, requester_browser, monkeypatch
):
    """On approve, the endpoint must schedule a `fan_out_member_added`
    push targeting the requester's user_id. The push is what wakes the
    requester's open GroupNotFound screen so it can auto-reload into
    the group (no manual refresh required). Deny does NOT schedule a
    push (per `docs/auth-access-model.md`).

    Monkeypatches the helper at its router-side import site so we can
    verify (a) it was called, (b) with the right user_id + payload
    shape, without standing up a fake push subscription.
    """
    import routers.groups as groups_router

    captured: list[dict] = []

    def fake_fan_out(group_id, added_user_id, payload):
        captured.append(
            {
                "group_id": group_id,
                "user_id": added_user_id,
                "payload": payload,
            }
        )

    monkeypatch.setattr(groups_router, "fan_out_member_added", fake_fan_out)

    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    rtoken, requester_uid, _ = _sign_in(client, requester_browser)

    create = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "let me in"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    request_id = create.json()["request"]["id"]

    approve = client.post(
        f"/api/groups/{group['id']}/join-requests/{request_id}/decide",
        json={"action": "approve"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "approved"

    # Exactly one scheduled fan-out for the approved request.
    approve_calls = [c for c in captured if c["user_id"] == requester_uid]
    assert len(approve_calls) == 1, captured
    call = approve_calls[0]
    payload = call["payload"]
    # Payload shape must match what the SW + Capacitor bridge listens
    # for: `member-added-<group_uuid>` tag + url under `/g/<route>` +
    # `group_id` field carrying the route_for_url + `group_uuid` field
    # carrying the canonical UUID so listeners whose viewer is on the
    # UUID-form URL can still match. GroupNotFound's listener matches on
    # EITHER tag OR url; both must be correct.
    assert payload["tag"] == f"member-added-{group['id']}"
    assert payload["url"].startswith("/g/")
    assert payload["group_id"]
    assert payload["group_uuid"] == group["id"]
    assert payload["title"]
    assert payload["body"]

    # Deny should NOT fire member-added (separate request, separate
    # requester). Reset and run a deny flow.
    captured.clear()
    deny_browser = str(uuid.uuid4())
    dtoken, _, _ = _sign_in(client, deny_browser)
    d_create = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "no"},
        headers=_bearer_headers(deny_browser, dtoken),
    )
    deny_id = d_create.json()["request"]["id"]
    deny = client.post(
        f"/api/groups/{group['id']}/join-requests/{deny_id}/decide",
        json={"action": "deny"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert deny.status_code == 200
    assert deny.json()["status"] == "denied"
    assert captured == []


def test_deny_does_not_grant_membership_and_allows_re_request(
    client, creator_browser, requester_browser
):
    """Deny walks the row to 'denied' (partial unique frees up the
    slot), so the requester can re-request after a denial."""
    ctoken, _, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    rtoken, _, _ = _sign_in(client, requester_browser)

    first = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "first"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    request_id = first.json()["request"]["id"]
    deny = client.post(
        f"/api/groups/{group['id']}/join-requests/{request_id}/decide",
        json={"action": "deny"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert deny.status_code == 200
    assert deny.json()["status"] == "denied"

    # Requester still can't see the group.
    blocked = client.get(
        f"/api/groups/by-route-id/{group['id']}",
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert blocked.status_code == 404

    # Re-request should succeed (partial-unique constraint frees the
    # slot when the prior row is no longer 'pending').
    again = client.post(
        f"/api/groups/{group['id']}/join-requests",
        json={"message": "second"},
        headers=_bearer_headers(requester_browser, rtoken),
    )
    assert again.status_code == 200
    assert again.json()["status"] == "pending"
    assert again.json()["request"]["id"] != request_id
