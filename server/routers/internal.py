"""Internal endpoints driven by server-local cron, not end users.

`POST /api/internal/tick` is hit once a minute by a host crontab entry (see
`scripts/provision-droplet.sh`). It's the only place the system acts on
deadlines passing — everything else in the app computes "closed" / "phase
over" lazily on read. The tick:

  1. Flips `is_closed` for polls whose `response_deadline` has passed, making
     closure authoritative (the vote endpoint gates on `is_closed`, so this
     also closes the previously-open "deadline passed but votes still
     accepted" hole).
  2. Claims every `is_closed AND NOT close_notified` poll and fires a
     poll-closed push. This uniformly catches deadline closes, auto
     (max_capacity) closes, and any explicit close whose inline push didn't
     run — the `close_notified` flag is the single idempotency boundary.
  3. Claims every poll whose prephase has ended but isn't `prephase_notified`,
     finalizes its options, and fires a phase-transition push. Catches both
     deadline-driven transitions and explicit cutoffs (the cutoff endpoints
     set `prephase_deadline = now`, which this query matches). A poll whose
     entire content turns out to be a cancelled time event ("event's off") is
     auto-closed here instead of getting a "voting is open" push; its close
     push then fires next tick via step 2.
  4. Claims per-(poll, browser) "remind me to vote" reminders that are due —
     each recipient's lead time comes from their account-synced
     `users.vote_reminder` preference (migration 136). Only reaches members who
     can still vote (open, votable now), haven't voted/abstained, and haven't
     ignored the poll. See `services/vote_reminder.py`.

Each claim is an atomic `UPDATE ... RETURNING` (or `INSERT ... RETURNING` for
reminders) so two overlapping ticks (or
the inline endpoint racing the tick) can't double-send. Push dispatch runs
after the claim transaction commits, so a failed send doesn't un-claim the
row (best-effort, matching the rest of the push layer).

Auth: `Authorization: Bearer <INTERNAL_TICK_SECRET>`. When the env var is
unset the endpoint 503s (disabled) rather than running unauthenticated — dev
tiers without the secret simply don't run the tick; the inline close/cutoff
pushes still fire there.
"""

from __future__ import annotations

import hmac
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from database import get_db
from routers.polls import (
    _build_close_notification,
    _build_reminder_notification,
    _build_transition_notification,
)
from services.push import (
    fan_out_phase_transition,
    fan_out_poll_closed,
    fan_out_to_browsers,
)
from services.vote_reminder import claim_due_reminders
from services.questions import (
    _finalize_suggestion_options,
    _finalize_time_slots,
    _maybe_close_cancelled_event_poll,
)

log = logging.getLogger("internal")

router = APIRouter(prefix="/api/internal", tags=["internal"])

_TICK_SECRET = os.environ.get("INTERNAL_TICK_SECRET", "")


def _authorize_tick(request: Request) -> None:
    if not _TICK_SECRET:
        raise HTTPException(status_code=503, detail="Internal tick not configured")
    header = request.headers.get("authorization", "")
    if not hmac.compare_digest(header, f"Bearer {_TICK_SECRET}"):
        raise HTTPException(status_code=403, detail="Forbidden")


def _finalize_poll_questions(conn, poll_id: str, now: datetime) -> None:
    """Finalize options for a transitioned poll's questions so members who
    open it after the push land on a ready ballot. Idempotent — both
    finalizers no-op when options are already set."""
    rows = conn.execute(
        "SELECT id, question_type FROM questions WHERE poll_id = %(pid)s",
        {"pid": poll_id},
    ).fetchall()
    for r in rows:
        if r["question_type"] == "ranked_choice":
            _finalize_suggestion_options(conn, str(r["id"]), now)
        elif r["question_type"] == "time":
            _finalize_time_slots(conn, str(r["id"]), now)


@router.post("/tick")
def tick(request: Request):
    _authorize_tick(request)
    now = datetime.now(timezone.utc)

    with get_db() as conn:
        # 1. Make is_closed authoritative for past-deadline polls.
        conn.execute(
            """
            UPDATE polls
            SET is_closed = true,
                close_reason = COALESCE(close_reason, 'deadline'),
                updated_at = %(now)s
            WHERE is_closed = false
              AND response_deadline IS NOT NULL
              AND response_deadline <= %(now)s
            """,
            {"now": now},
        )

        # 2. Claim un-notified closes (atomic — the UPDATE row-locks each
        #    claimed poll, so a concurrent tick or the inline close path can't
        #    grab the same row).
        closed = conn.execute(
            """
            UPDATE polls SET close_notified = true
            WHERE is_closed = true AND close_notified = false
            RETURNING id::text AS id
            """,
        ).fetchall()
        closed_ids = [r["id"] for r in closed]

        # 3. Claim un-notified phase transitions (prephase ended, not closed).
        transitioned = conn.execute(
            """
            UPDATE polls SET prephase_notified = true
            WHERE prephase_deadline IS NOT NULL
              AND prephase_deadline <= %(now)s
              AND prephase_notified = false
              AND is_closed = false
            RETURNING id::text AS id
            """,
            {"now": now},
        ).fetchall()
        transitioned_ids = [r["id"] for r in transitioned]

        # Finalize each transitioned poll's options, then auto-close any whose
        # entire content is a cancelled time event ("event's off"). A cancelled
        # poll must NOT get a "voting is open" push — skip it below; its close
        # push fires next tick (step 2 claims it via close_notified = false).
        cancelled_ids: set[str] = set()
        for pid in transitioned_ids:
            _finalize_poll_questions(conn, pid, now)
            if _maybe_close_cancelled_event_poll(conn, pid, now):
                cancelled_ids.add(pid)

        # 4. Claim per-(poll, browser) vote reminders that are due now. Each
        #    claim is an atomic INSERT into vote_reminders_sent, so the reminder
        #    fires exactly once even across overlapping ticks. Dispatch runs
        #    after this transaction commits, like the close/transition pushes.
        reminder_targets = claim_due_reminders(conn, now)

    # Dispatch outside the claim transaction. Each fan-out opens its own
    # connection and swallows errors, so one bad poll can't abort the batch.
    for pid in closed_ids:
        with get_db() as conn:
            built = _build_close_notification(conn, pid)
        if built:
            group_id, payload = built
            fan_out_poll_closed(group_id, pid, payload)

    for pid in transitioned_ids:
        if pid in cancelled_ids:
            continue  # event's off → close push fires next tick, not a transition push
        with get_db() as conn:
            built = _build_transition_notification(conn, pid)
        if built:
            group_id, payload, prevoting_on, latest = built
            fan_out_phase_transition(
                group_id,
                pid,
                payload,
                prevoting_on=prevoting_on,
                latest_contribution=latest,
            )

    reminded = 0
    for pid, browser_ids in reminder_targets:
        with get_db() as conn:
            built = _build_reminder_notification(conn, pid)
        if built:
            _group_id, payload = built
            fan_out_to_browsers(browser_ids, payload)
            reminded += len(browser_ids)

    return {
        "closed": len(closed_ids),
        "transitioned": len(transitioned_ids),
        "cancelled": len(cancelled_ids),
        "reminded": reminded,
    }
