"""Poll variant evolution — the /explore feed's "natural selection" engine.

A user-submitted explore poll (a single yes/no question) is the TRUNK of a
binary spine. On submit it spawns 2 LLM-generated yes/no variants — one grows
ABOVE it (direction 'up'), one BELOW ('down'). Each spawned variant, once it
accrues `SPAWN_VOTE_THRESHOLD` distinct voters, spawns ONE further variant in
its OWN direction (an up-variant grows up, a down-variant grows down), so the
spine extends away from the trunk in both directions, generation by generation.

`spawn_variants(poll_id)` is the single entry point, run as a FastAPI
BackgroundTask from two places:
  - `create_poll` (when a yes/no poll is posted to /explore) → the trunk spawns
    its 2 children immediately (no vote requirement).
  - `submit_poll_votes` (any not-yet-spawned poll in an explore group) → a
    variant spawns its 1 child once it crosses the vote threshold; this path
    also retries a trunk whose creation-time spawn failed (LLM was down).

The actual LLM call lives in services/variant_llm.py and degrades gracefully
when no endpoint is configured (the feed then just doesn't evolve).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from database import get_db
from models import CreatePollRequest, CreateQuestionRequest, QuestionType
from services.groups import EXPLORE_PRIVACY
from services.variant_llm import generate_variant_titles, is_configured

log = logging.getLogger("poll_variants")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (ValueError, TypeError):
        return default


# Distinct voters a SPAWNED variant needs before it earns its own child.
# Default 1 (every voted-on variant evolves — the owner's "start with 1, tune
# later"). The trunk ignores this (it spawns at creation).
SPAWN_VOTE_THRESHOLD = _env_int("POLL_VARIANT_VOTE_THRESHOLD", 1)
# Cap the spine depth so the feed + LLM cost stay bounded.
MAX_VARIANT_GENERATION = _env_int("POLL_VARIANT_MAX_GENERATION", 5)


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def count_poll_voters(conn, poll_id: str) -> int:
    """Distinct people (by browser_id) who have voted on any question of the
    poll. Legacy NULL-browser_id votes (pre-migration-120) are excluded."""
    row = conn.execute(
        "SELECT COUNT(DISTINCT v.browser_id) AS c FROM votes v "
        "JOIN questions q ON v.question_id = q.id "
        "WHERE q.poll_id = %(pid)s AND v.browser_id IS NOT NULL",
        {"pid": poll_id},
    ).fetchone()
    return int(row["c"] or 0) if row else 0


def _single_yes_no_question(conn, poll_id: str) -> dict | None:
    """The poll's question row IFF it's a single yes/no with a non-empty title;
    else None. The evolution system only handles yes/no polls (for now)."""
    rows = conn.execute(
        "SELECT * FROM questions WHERE poll_id = %(pid)s",
        {"pid": poll_id},
    ).fetchall()
    if len(rows) != 1:
        return None
    q = dict(rows[0])
    if q.get("question_type") != "yes_no" or not (q.get("title") or "").strip():
        return None
    return q


def _spine_titles(conn, root_id: str) -> list[str]:
    """Every question title already used in this spine (trunk + all variants),
    so the LLM can avoid repeating one."""
    rows = conn.execute(
        "SELECT DISTINCT q.title FROM questions q JOIN polls p ON q.poll_id = p.id "
        "WHERE p.id = %(root)s OR p.variant_root_id = %(root)s",
        {"root": root_id},
    ).fetchall()
    return [r["title"] for r in rows if r.get("title")]


# ---------------------------------------------------------------------------
# Variant creation
# ---------------------------------------------------------------------------

def _create_variant(
    conn,
    parent_row: dict,
    parent_question: dict,
    *,
    title: str,
    direction: str,
    generation: int,
    root_id: str,
    now: datetime,
) -> str:
    """Insert one variant poll: a fresh single yes/no question carrying the
    LLM-generated `title`, in the parent's (explore) group, with the parent's
    creator + the spine lineage. Reuses the create-time insert helpers (lazy
    import to dodge the routers.polls ↔ services circular)."""
    from routers.polls import _insert_poll, _insert_question  # noqa: PLC0415

    sub = CreateQuestionRequest(
        question_type=QuestionType.yes_no,
        category=parent_question.get("category") or "yes_no",
        category_icon=parent_question.get("category_icon"),
        is_auto_title=False,
    )
    req = CreatePollRequest(
        creator_name=parent_row.get("creator_name"),
        group_id=str(parent_row["group_id"]) if parent_row.get("group_id") else None,
        questions=[sub],
    )
    poll_row = _insert_poll(
        conn, req, now,
        creator_user_id=parent_row.get("creator_user_id"),
        group_creator_user_id=None,
    )
    _insert_question(conn, poll_row, req, sub, 0, title, now)
    conn.execute(
        "UPDATE polls SET variant_parent_id = %(parent)s, variant_root_id = %(root)s, "
        "variant_direction = %(dir)s, variant_generation = %(gen)s WHERE id = %(id)s",
        {
            "parent": str(parent_row["id"]),
            "root": root_id,
            "dir": direction,
            "gen": generation,
            "id": str(poll_row["id"]),
        },
    )
    return str(poll_row["id"])


# ---------------------------------------------------------------------------
# Spawn orchestration
# ---------------------------------------------------------------------------

def _gather_and_claim(conn, poll_id: str):
    """Decide whether `poll_id` should spawn now and, if so, atomically claim it
    (so concurrent spawn tasks can't double-spawn). Returns
    `(base_title, directions, generation, root_id, avoid)` or None.

    The claim is an `UPDATE ... WHERE variant_spawned = false RETURNING` — the
    loser of a race sees 0 rows (the winner's row lock serializes them) and
    bails. The claim is committed (by get_db) before the slow LLM call, so the
    connection/lock isn't held across generation."""
    row = conn.execute(
        "SELECT p.id, p.variant_parent_id, p.variant_root_id, p.variant_direction, "
        "p.variant_generation, p.variant_spawned, t.privacy AS group_privacy "
        "FROM polls p LEFT JOIN groups t ON p.group_id = t.id WHERE p.id = %(id)s",
        {"id": poll_id},
    ).fetchone()
    if not row:
        return None
    row = dict(row)
    # Only explore polls evolve, and only ones that haven't spawned yet.
    if row.get("group_privacy") != EXPLORE_PRIVACY or row.get("variant_spawned"):
        return None
    question = _single_yes_no_question(conn, poll_id)
    if not question:
        return None
    base_title = (question.get("title") or "").strip()

    is_root = row.get("variant_parent_id") is None
    if is_root:
        # The trunk spawns 2 children (one each direction) at creation, no votes.
        directions = ["up", "down"]
        generation = 1
        root_id = poll_id
    else:
        gen = row.get("variant_generation") or 0
        if gen >= MAX_VARIANT_GENERATION:
            return None
        if count_poll_voters(conn, poll_id) < SPAWN_VOTE_THRESHOLD:
            return None
        directions = [row.get("variant_direction") or "down"]
        generation = gen + 1
        root_id = str(row.get("variant_root_id") or poll_id)

    claimed = conn.execute(
        "UPDATE polls SET variant_spawned = true "
        "WHERE id = %(id)s AND variant_spawned = false RETURNING id",
        {"id": poll_id},
    ).fetchone()
    if not claimed:
        return None
    avoid = _spine_titles(conn, root_id)
    return base_title, directions, generation, root_id, avoid


def spawn_variants(poll_id: str) -> None:
    """Background-task entry point. Spawns the poll's variant(s) if it's an
    eligible explore poll that hasn't spawned yet (and, for a variant, has hit
    the vote threshold). No-op + safe for any other poll."""
    if not is_configured():
        log.info("[variants] LLM not configured; skipping spawn for %s", poll_id)
        return
    now = datetime.now(timezone.utc)

    # Phase 1: gather + atomically claim (short transaction).
    try:
        with get_db() as conn:
            claim = _gather_and_claim(conn, poll_id)
    except Exception:  # noqa: BLE001
        log.exception("[variants] gather/claim failed for %s", poll_id)
        return
    if claim is None:
        return
    base_title, directions, generation, root_id, avoid = claim

    # Phase 2: generate (no DB connection held — the LLM call can take seconds).
    titles = generate_variant_titles(base_title, len(directions), avoid=avoid)
    if not titles:
        # Transient failure (LLM down / empty reply): revert the claim so a
        # later trigger (e.g. another vote) retries.
        try:
            with get_db() as conn:
                conn.execute(
                    "UPDATE polls SET variant_spawned = false WHERE id = %(id)s",
                    {"id": poll_id},
                )
        except Exception:  # noqa: BLE001
            log.exception("[variants] failed to revert claim for %s", poll_id)
        log.warning("[variants] no titles generated for %s; reverted claim", poll_id)
        return

    # Phase 3: insert the child variant(s) (claim stays set on a hard failure so
    # we don't loop on a persistently-broken poll).
    try:
        with get_db() as conn:
            parent_row = conn.execute(
                "SELECT * FROM polls WHERE id = %(id)s", {"id": poll_id}
            ).fetchone()
            parent_q = conn.execute(
                "SELECT * FROM questions WHERE poll_id = %(id)s "
                "ORDER BY question_index NULLS LAST, created_at LIMIT 1",
                {"id": poll_id},
            ).fetchone()
            if not parent_row or not parent_q:
                return
            parent_row, parent_q = dict(parent_row), dict(parent_q)
            for direction, title in zip(directions, titles):
                new_id = _create_variant(
                    conn, parent_row, parent_q,
                    title=title, direction=direction,
                    generation=generation, root_id=root_id, now=now,
                )
                log.info(
                    "[variants] spawned %s (%s, gen %s) from %s: %r",
                    new_id, direction, generation, poll_id, title,
                )
    except Exception:  # noqa: BLE001
        log.exception("[variants] failed to insert variants for %s", poll_id)
