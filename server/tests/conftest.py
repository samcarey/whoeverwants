"""Shared pytest fixtures + helpers for the Phase B.3 / C.x test suite.

`test_groups_api.py`, `test_groups_visibility.py`,
`test_membership_writes.py`, and `test_leave_group.py` all need the
same TestClient setup, yes/no question shape, and `create_poll` /
`bid_headers` / `group_members_for` helpers. Centralizing keeps the
per-test files focused on assertions.
"""

import os
import uuid

import psycopg
import pytest

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def creator_secret():
    """Retained for callsite ergonomics — `create_poll(client, creator_secret,
    ...)` reads naturally. Migration 123 retired the per-browser secret, so the
    value is no longer sent to the server; authorship is identity-based
    (creator_user_id, auto-minted from the creator's browser_id). Kept as a
    fixture so the many `create_poll(client, creator_secret, ...)` callsites
    don't have to change."""
    return f"test-secret-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def browser_id():
    """A single browser_id pinned across create + read + mutate calls within
    one test. Without this, TestClient mints a fresh browser_id per request so
    (a) the read endpoints can't see the polls just created (visibility filter
    requires membership), and (b) close/reopen/cutoff can't authorize (the
    creator's auto-minted account is bound to the creating browser_id)."""
    return str(uuid.uuid4())


def yes_no_question(**overrides) -> dict:
    base = {"question_type": "yes_no", "category": "yes_no"}
    base.update(overrides)
    return base


# Maps a created poll's id → the browser_id that created it, so the mutation
# helpers below can authorize close/reopen/cutoff without each test threading
# the header. Migration 123: poll authorship is identity-based and the
# anonymous creator's account is keyed off this browser_id.
_poll_creator_browser: dict[str, str] = {}


def create_poll(client, creator_secret=None, *, browser_id=None, **kwargs) -> dict:
    """Create a poll. `creator_secret` is accepted-but-ignored (see the
    fixture). A browser_id is always pinned (minted when not supplied) so the
    creator's auto-account is stable for later mutation/visibility calls."""
    bid = browser_id or str(uuid.uuid4())
    payload = {
        "creator_name": "Test User",
        "questions": [yes_no_question()],
    }
    payload.update(kwargs)
    resp = client.post("/api/polls", json=payload, headers={"X-Browser-Id": bid})
    assert resp.status_code == 201, resp.text
    data = resp.json()
    _poll_creator_browser[data["id"]] = bid
    return data


def creator_headers(poll) -> dict:
    """X-Browser-Id header for the browser that created `poll` (so a mutation
    authorizes as the creator). Empty when the poll wasn't created via
    `create_poll` in this process."""
    bid = _poll_creator_browser.get(poll["id"])
    return {"X-Browser-Id": bid} if bid else {}


def close_poll(client, poll, *, close_reason="manual", **kwargs):
    return client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": close_reason},
        headers=creator_headers(poll),
        **kwargs,
    )


def reopen_poll(client, poll, **kwargs):
    return client.post(
        f"/api/polls/{poll['id']}/reopen",
        json={},
        headers=creator_headers(poll),
        **kwargs,
    )


def cutoff_poll(client, poll, kind="suggestions", **kwargs):
    return client.post(
        f"/api/polls/{poll['id']}/cutoff-{kind}",
        json={},
        headers=creator_headers(poll),
        **kwargs,
    )


def create_followup(
    client,
    creator_secret,
    parent_question_id,
    *,
    browser_id=None,
) -> dict:
    """Create another poll in the same group as `parent_question_id`.

    Migration 105 retired `polls.follow_up_to`; groups are flat lists
    of polls under one `group_id`. Tests still pass a parent_question_id
    here for ergonomics — the helper resolves it to the parent's
    `group_id` and forwards that as `req.group_id`.
    """
    parent = client.get(f"/api/questions/{parent_question_id}")
    assert parent.status_code == 200, parent.text
    poll_id = parent.json()["poll_id"]
    poll = client.get(f"/api/polls/by-id/{poll_id}")
    assert poll.status_code == 200, poll.text
    group_id = poll.json()["group_id"]
    return create_poll(
        client,
        creator_secret,
        browser_id=browser_id,
        group_id=group_id,
    )


def bid_headers(browser_id):
    return {"X-Browser-Id": browser_id} if browser_id else {}


def group_members_for(group_id) -> list[str]:
    """Return the browser_id list (as strings) for a group. Used by tests
    that need to assert membership state directly against the DB rather
    than going through `/api/groups/mine`."""
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT browser_id FROM group_members WHERE group_id = %s",
            (group_id,),
        ).fetchall()
    return [str(r[0]) for r in rows]
