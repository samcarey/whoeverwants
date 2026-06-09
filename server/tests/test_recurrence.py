"""Tests for poll recurrence: occurrence math, create/cancel endpoints, and
the cron-tick materialization (migration 141)."""
import uuid
from datetime import date, timedelta

import psycopg
import pytest

from tests.conftest import TEST_DB_URL, create_poll, creator_headers
from database import get_db
from services.recurrence import (
    generate_occurrences,
    due_occurrences,
    upcoming_occurrences,
    is_active,
    materialize_due_instances,
)


def _rule(**over):
    base = {
        "frequency": "daily",
        "interval": 1,
        "weekdays": [],
        "monthlyMode": "dayOfMonth",
        "end": {"type": "never"},
        "start": "2026-01-01",
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# Pure occurrence math (mirrors tests/__tests__/recurrence.test.ts)
# ---------------------------------------------------------------------------

def test_is_active():
    assert not is_active(None)
    assert not is_active(_rule(frequency="none"))
    assert is_active(_rule(frequency="weekly"))


def test_daily():
    occ = generate_occurrences(_rule(interval=3), date(2026, 1, 1), limit=3)
    assert occ == [date(2026, 1, 1), date(2026, 1, 4), date(2026, 1, 7)]


def test_daily_after_count():
    occ = generate_occurrences(
        _rule(end={"type": "after", "count": 2}), date(2026, 1, 1), limit=10
    )
    assert occ == [date(2026, 1, 1), date(2026, 1, 2)]


def test_weekly_selected_days():
    # 2026-01-01 is a Thursday; pick Mon(1)+Wed(3).
    occ = generate_occurrences(
        _rule(frequency="weekly", weekdays=[1, 3]), date(2026, 1, 1), limit=4
    )
    assert occ == [date(2026, 1, 5), date(2026, 1, 7), date(2026, 1, 12), date(2026, 1, 14)]


def test_weekly_biweekly():
    occ = generate_occurrences(
        _rule(frequency="weekly", interval=2, weekdays=[4]), date(2026, 1, 1), limit=3
    )
    assert occ == [date(2026, 1, 1), date(2026, 1, 15), date(2026, 1, 29)]


def test_monthly_day_of_month_clamps():
    occ = generate_occurrences(
        _rule(frequency="monthly", monthlyMode="dayOfMonth"), date(2026, 1, 31), limit=3
    )
    assert occ == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)]


def test_monthly_nth_weekday():
    # 2026-01-13 is the 2nd Tuesday.
    occ = generate_occurrences(
        _rule(frequency="monthly", monthlyMode="nthWeekday"), date(2026, 1, 13), limit=3
    )
    assert occ == [date(2026, 1, 13), date(2026, 2, 10), date(2026, 3, 10)]


def test_upcoming_filters_skip_and_until():
    today = date(2026, 1, 1)
    anchor = {
        "recurrence": _rule(start="2026-01-01"),
        "recurrence_skip_dates": ["2026-01-03"],
        "recurrence_until": date(2026, 1, 6),
        "recurrence_last_run": date(2026, 1, 1),
    }
    occ = upcoming_occurrences(anchor, today, limit=10)
    # > today (Jan 1), skip Jan 3, until Jan 6 (exclusive) → Jan 2, 4, 5.
    assert occ == [date(2026, 1, 2), date(2026, 1, 4), date(2026, 1, 5)]


def test_due_after_last_run():
    today = date(2026, 1, 5)
    anchor = {
        "recurrence": _rule(start="2026-01-01"),
        "recurrence_skip_dates": ["2026-01-04"],
        "recurrence_until": None,
        "recurrence_last_run": date(2026, 1, 2),
    }
    # last_run Jan 2, today Jan 5, skip Jan 4 → Jan 3, Jan 5.
    assert due_occurrences(anchor, today) == [date(2026, 1, 3), date(2026, 1, 5)]


# ---------------------------------------------------------------------------
# Create / response
# ---------------------------------------------------------------------------

def test_create_stores_recurrence(client):
    today = date.today().isoformat()
    poll = create_poll(client, recurrence=_rule(frequency="weekly", weekdays=[2], start=today))
    assert poll["recurrence"] is not None
    assert poll["recurrence"]["frequency"] == "weekly"
    assert poll["recurrence"]["start"] == today
    assert poll["recurrence_skip_dates"] == []
    assert poll["recurrence_until"] is None
    assert poll["recurrence_anchor_id"] is None


def test_create_without_recurrence_is_null(client):
    poll = create_poll(client)
    assert poll["recurrence"] is None


def test_malformed_recurrence_ignored(client):
    poll = create_poll(client, recurrence={"frequency": "bogus"})
    assert poll["recurrence"] is None


# ---------------------------------------------------------------------------
# Cancel endpoints
# ---------------------------------------------------------------------------

def test_cancel_occurrence(client):
    today = date.today().isoformat()
    poll = create_poll(client, recurrence=_rule(start=today))
    resp = client.post(
        f"/api/polls/{poll['id']}/recurrence/cancel",
        json={"scope": "occurrence", "date": "2026-07-15"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["recurrence_skip_dates"] == ["2026-07-15"]


def test_cancel_series(client):
    today = date.today().isoformat()
    poll = create_poll(client, recurrence=_rule(start=today))
    resp = client.post(
        f"/api/polls/{poll['id']}/recurrence/cancel",
        json={"scope": "series", "date": "2026-07-15"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["recurrence_until"] == "2026-07-15"


def test_cancel_requires_creator(client):
    today = date.today().isoformat()
    poll = create_poll(client, recurrence=_rule(start=today))
    resp = client.post(
        f"/api/polls/{poll['id']}/recurrence/cancel",
        json={"scope": "series", "date": "2026-07-15"},
        headers={"X-Browser-Id": str(uuid.uuid4())},  # not the creator
    )
    assert resp.status_code == 403


def test_cancel_non_recurring_404(client):
    poll = create_poll(client)  # no recurrence
    resp = client.post(
        f"/api/polls/{poll['id']}/recurrence/cancel",
        json={"scope": "series", "date": "2026-07-15"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 404


def test_cancel_bad_scope(client):
    today = date.today().isoformat()
    poll = create_poll(client, recurrence=_rule(start=today))
    resp = client.post(
        f"/api/polls/{poll['id']}/recurrence/cancel",
        json={"scope": "nope", "date": "2026-07-15"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Materialization (scheduler)
# ---------------------------------------------------------------------------

def _backdate_anchor(poll_id: str, start: date):
    """Push the anchor's start + last_run back so occurrences are 'due'."""
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "UPDATE polls SET recurrence = jsonb_set(recurrence, '{start}', %(start)s::jsonb), "
            "recurrence_last_run = %(d)s WHERE id = %(id)s",
            {"start": f'"{start.isoformat()}"', "d": start, "id": poll_id},
        )
        conn.commit()


def _children_of(anchor_id: str) -> list[tuple]:
    """(id, group_id, recurrence, recurrence_anchor_id) rows for an anchor's
    materialized children. Scoped per-anchor since the shared test DB
    accumulates recurring polls across tests/runs."""
    with psycopg.connect(TEST_DB_URL) as conn:
        return conn.execute(
            "SELECT id::text, group_id::text, recurrence, recurrence_anchor_id::text "
            "FROM polls WHERE recurrence_anchor_id = %s ORDER BY created_at",
            (anchor_id,),
        ).fetchall()


def test_materialize_creates_due_instances(client):
    today = date.today()
    start = today - timedelta(days=2)
    poll = create_poll(client, recurrence=_rule(frequency="daily", start=start.isoformat()))
    group_id = poll["group_id"]
    _backdate_anchor(poll["id"], start)

    with get_db() as conn:
        materialize_due_instances(conn, today)

    # due dates after last_run(start) on/before today = start+1, today → 2 instances.
    children = _children_of(poll["id"])
    assert len(children) == 2
    for cid, cgroup, crule, canchor in children:
        assert cgroup == group_id       # same group as the anchor
        assert crule is None            # children carry no rule of their own
        assert canchor == poll["id"]    # linked back to the anchor
    # The instance carries a copy of the anchor's question.
    with psycopg.connect(TEST_DB_URL) as conn:
        qcount = conn.execute(
            "SELECT COUNT(*) FROM questions WHERE poll_id = %s", (children[0][0],)
        ).fetchone()[0]
    assert qcount == 1


def test_materialize_idempotent(client):
    today = date.today()
    start = today - timedelta(days=1)
    poll = create_poll(client, recurrence=_rule(frequency="daily", start=start.isoformat()))
    _backdate_anchor(poll["id"], start)
    with get_db() as conn:
        materialize_due_instances(conn, today)
    after_first = len(_children_of(poll["id"]))
    with get_db() as conn:
        materialize_due_instances(conn, today)
    after_second = len(_children_of(poll["id"]))
    assert after_first == 1
    assert after_second == 1  # watermark advanced → no new instance for this anchor


def test_materialize_respects_until(client):
    today = date.today()
    start = today - timedelta(days=3)
    poll = create_poll(client, recurrence=_rule(frequency="daily", start=start.isoformat()))
    _backdate_anchor(poll["id"], start)
    # End the series before any due date materializes.
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "UPDATE polls SET recurrence_until = %s WHERE id = %s",
            ((start + timedelta(days=1)), poll["id"]),
        )
        conn.commit()
    with get_db() as conn:
        materialize_due_instances(conn, today)
    assert _children_of(poll["id"]) == []
