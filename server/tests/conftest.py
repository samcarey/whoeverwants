"""Shared pytest fixtures + helpers for the Phase B.3 / C.x test suite.

`test_threads_api.py`, `test_threads_visibility.py`,
`test_membership_writes.py`, and `test_leave_thread.py` all need the
same TestClient setup, yes/no question shape, and `create_poll` /
`bid_headers` / `thread_members_for` helpers. Centralizing keeps the
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
    return f"test-secret-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def browser_id():
    """A single browser_id pinned across create + read calls within one
    test. Without this, TestClient mints a fresh browser_id per request
    so the read endpoints can't see the polls just created (Phase C.3
    visibility filter requires membership)."""
    return str(uuid.uuid4())


def yes_no_question(**overrides) -> dict:
    base = {"question_type": "yes_no", "category": "yes_no"}
    base.update(overrides)
    return base


def create_poll(client, creator_secret, *, browser_id=None, **kwargs) -> dict:
    payload = {
        "creator_secret": creator_secret,
        "questions": [yes_no_question()],
    }
    payload.update(kwargs)
    headers = {"X-Browser-Id": browser_id} if browser_id else {}
    resp = client.post("/api/polls", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def create_followup(
    client,
    creator_secret,
    parent_question_id,
    *,
    browser_id=None,
) -> dict:
    """Create a poll wrapped in a follow-up to `parent_question_id`."""
    return create_poll(
        client,
        creator_secret,
        browser_id=browser_id,
        follow_up_to=parent_question_id,
    )


def bid_headers(browser_id):
    return {"X-Browser-Id": browser_id} if browser_id else {}


def thread_members_for(thread_id) -> list[str]:
    """Return the browser_id list (as strings) for a thread. Used by tests
    that need to assert membership state directly against the DB rather
    than going through `/api/threads/mine`."""
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT browser_id FROM thread_members WHERE thread_id = %s",
            (thread_id,),
        ).fetchall()
    return [str(r[0]) for r in rows]
