"""Dev-tier tick endpoint (POST /api/internal/dev/tick).

Per-branch dev servers have no cron, so this non-prod endpoint runs the same
tick body without the bearer secret, gated by request Origin (inert on prod
via services/fe_origin.is_prod_origin, same model as the dev instant-sign-in
links). Covers:

  * dev Origin → 200 + the tick result-dict shape
  * prod Origin (and no Origin) → 503 (feature is dev-only)
  * it actually does the work: a past-deadline poll is flipped is_closed
  * the authenticated /tick path is unchanged (secret still required)
"""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg

from tests.conftest import TEST_DB_URL, create_poll

import routers.internal

DEV_ORIGIN = "http://localhost:3000"
PROD_ORIGIN = "https://whoeverwants.com"

_TICK_KEYS = {"closed", "transitioned", "cancelled", "reminded", "materialized", "aged"}


def _db():
    return psycopg.connect(TEST_DB_URL)


def _set_deadline_past(poll_id):
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    with _db() as conn:
        conn.execute(
            "UPDATE polls SET response_deadline = %s, is_closed = false WHERE id = %s",
            (past, poll_id),
        )
        conn.commit()


def test_dev_tick_runs_on_dev_origin(client):
    resp = client.post("/api/internal/dev/tick", headers={"Origin": DEV_ORIGIN})
    assert resp.status_code == 200
    assert set(resp.json().keys()) == _TICK_KEYS


def test_dev_tick_503_on_prod_origin(client):
    assert (
        client.post("/api/internal/dev/tick", headers={"Origin": PROD_ORIGIN}).status_code
        == 503
    )


def test_dev_tick_503_without_origin(client):
    # No Origin falls back to prod → gated off (safe default).
    assert client.post("/api/internal/dev/tick").status_code == 503


def test_dev_tick_closes_past_deadline_poll(client):
    poll = create_poll(client, browser_id=str(uuid.uuid4()))
    _set_deadline_past(poll["id"])

    body = client.post("/api/internal/dev/tick", headers={"Origin": DEV_ORIGIN}).json()
    assert body["closed"] >= 1

    with _db() as conn:
        row = conn.execute(
            "SELECT is_closed, close_reason FROM polls WHERE id = %s", (poll["id"],)
        ).fetchone()
    assert row[0] is True
    assert row[1] == "deadline"


def test_authenticated_tick_still_requires_secret(client, monkeypatch):
    monkeypatch.setattr(routers.internal, "_TICK_SECRET", "sek")
    # Wrong/absent secret is rejected even on a dev Origin (the /tick path
    # doesn't consult Origin at all).
    assert client.post("/api/internal/tick", headers={"Origin": DEV_ORIGIN}).status_code == 403
    assert (
        client.post(
            "/api/internal/tick",
            headers={"Authorization": "Bearer sek", "Origin": PROD_ORIGIN},
        ).status_code
        == 200
    )
