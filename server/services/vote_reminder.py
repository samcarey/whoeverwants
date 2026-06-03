"""Per-user "remind me to vote" selection logic (migration 136).

The setting lives on `users.vote_reminder` (account-synced; see
`validation.VOTE_REMINDER_OPTIONS`). This module turns that preference into
the per-(poll, browser) decision the cron tick acts on:

  fire_time = poll.response_deadline - offset(setting, open_window)

where `open_window = response_deadline - created_at`. A fractional setting
('0.2x') fires when that fraction of the window remains; an absolute setting
('1h', '1d') fires that fixed lead time before the deadline. 'off' never fires.

`claim_due_reminders` is the single entry point the tick calls. It applies the
cheap SQL gates (membership, not-muted, not-ignored, not-voted) per open poll,
computes the per-recipient fire time in Python (the offset depends on each
member's effective setting + the poll's window), then atomically claims each
due (poll, browser) into `vote_reminders_sent` so the reminder fires exactly
once. Returns the claimed browsers grouped by poll for the caller to dispatch.

Scale note: this evaluates every open poll with a future deadline once per
tick and runs one recipient query per such poll — O(open_polls) queries/min.
Fine at the app's current scale (small groups); batch into a single query with
a window-function offset if open-poll counts ever grow large.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from services.push import _NOT_IGNORED, _NOT_VOTED, _PREF_JOIN, _PREF_ON_TRUE
from services.validation import DEFAULT_VOTE_REMINDER

# Fractional settings: fraction of the poll's open window that must REMAIN.
_FRACTIONAL: dict[str, float] = {"0.5x": 0.5, "0.2x": 0.2, "0.1x": 0.1}
# Absolute lead times before the deadline.
_ABSOLUTE: dict[str, timedelta] = {
    "1h": timedelta(hours=1),
    "3h": timedelta(hours=3),
    "1d": timedelta(days=1),
}


def reminder_offset(
    setting: str, created_at: datetime, response_deadline: datetime
) -> timedelta | None:
    """The lead time before `response_deadline` at which this setting fires, or
    None when the setting is 'off' / unknown. Fractional settings scale the open
    window; absolute settings are fixed. A fractional offset can exceed the
    window for a degenerate (zero/negative) window — the caller clamps via the
    `now >= fire_time` check, so an out-of-range fire_time just fires on the
    next tick."""
    frac = _FRACTIONAL.get(setting)
    if frac is not None:
        window = response_deadline - created_at
        return window * frac
    return _ABSOLUTE.get(setting)  # None for 'off' / anything unknown


def claim_due_reminders(
    conn, now: datetime
) -> list[tuple[str, list[str]]]:
    """Find and atomically claim every (poll, browser) whose vote reminder is
    due now. Returns [(poll_id, [browser_id, ...]), ...] of freshly-claimed
    targets to dispatch. A claimed row in `vote_reminders_sent` guarantees the
    reminder won't be re-sent on a later tick."""
    candidate_polls = conn.execute(
        """
        SELECT id::text AS id, group_id::text AS group_id,
               created_at, response_deadline
          FROM polls
         WHERE is_closed = false
           AND response_deadline IS NOT NULL
           AND response_deadline > %(now)s
           AND (prephase_deadline IS NULL OR prephase_deadline <= %(now)s)
        """,
        {"now": now},
    ).fetchall()

    out: list[tuple[str, list[str]]] = []
    for poll in candidate_polls:
        pid = poll["id"]
        recipients = conn.execute(
            f"""
            SELECT gm.browser_id::text AS browser_id,
                   COALESCE(rem_u.vote_reminder, %(default)s) AS reminder
              FROM group_members gm
              {_PREF_JOIN}
              LEFT JOIN users rem_u ON rem_u.id = gm_ub.user_id
             WHERE gm.group_id = %(gid)s
               AND {_PREF_ON_TRUE}
               AND {_NOT_IGNORED}
               AND {_NOT_VOTED}
            """,
            {"gid": poll["group_id"], "pid": pid, "default": DEFAULT_VOTE_REMINDER},
        ).fetchall()

        claimed: list[str] = []
        for r in recipients:
            offset = reminder_offset(
                r["reminder"], poll["created_at"], poll["response_deadline"]
            )
            if offset is None:
                continue  # 'off'
            fire_time = poll["response_deadline"] - offset
            if now < fire_time:
                continue  # not due yet
            row = conn.execute(
                """
                INSERT INTO vote_reminders_sent (poll_id, browser_id)
                VALUES (%(pid)s::uuid, %(bid)s::uuid)
                ON CONFLICT (poll_id, browser_id) DO NOTHING
                RETURNING browser_id::text AS browser_id
                """,
                {"pid": pid, "bid": r["browser_id"]},
            ).fetchone()
            if row:
                claimed.append(row["browser_id"])

        if claimed:
            out.append((pid, claimed))
    return out
