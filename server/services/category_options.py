"""Previously-referenced option strings per category, for autocomplete priming.

Backs the create-poll autocomplete fields (restaurant / location / movie /
video_game). When a creator opens the new-poll form for one of those
categories and focuses an option field, we want to surface — ABOVE the live
search results — the options of that category that were previously *referenced*
(given as ballot options OR submitted as suggestions) in the same group, sorted
by recency; then the same across every group the creator has access to.

Two reference sources, both scoped by `questions.category`:
  * `questions.options` — finalized ballot options (recency = `questions.created_at`).
  * `votes.suggestions` — suggestion-phase submissions (recency = `votes.created_at`).

Per-option rich metadata (favicon / poster / address / rating / coords) lives in
`questions.options_metadata` regardless of which source the string came from —
`_merge_suggestion_metadata` (services.questions) folds a vote's metadata into
the question row on every submit — so we read it from there for both sources.

Visibility mirrors `services.groups.load_user_visibility`: the "general" scope is
every group the caller is a member of (account-aware union across the caller's
linked browsers). The "group" scope is the one group_id being created in.

Tolerant by design — anything missing yields empty lists, like the sibling
`poll_categories` module.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from services.groups import explore_group_ids, load_user_visibility

logger = logging.getLogger(__name__)

# Cap rows scanned per scope before dedup, and entries returned after dedup.
_SCAN_LIMIT = 400
_RETURN_LIMIT = 50


@dataclass
class CategoryOption:
    """One previously-referenced option: its text + best-available metadata."""

    label: str
    metadata: dict[str, Any] | None


@dataclass
class CategoryOptions:
    """Group-scoped then general (cross-group, group-deduped) option lists,
    each most-recent-first."""

    group: list[CategoryOption]
    general: list[CategoryOption]


# Pull both reference sources (finalized options + vote suggestions) for one
# category across a set of group_ids, newest-first, with each option's metadata
# from `questions.options_metadata`. `jsonb_typeof = 'array'` guards legacy/odd
# rows so `jsonb_array_elements_text` can't error on a non-array `options`.
_QUERY = """
    SELECT label, recency, meta
      FROM (
        SELECT opt AS label,
               q.created_at AS recency,
               (q.options_metadata -> opt) AS meta
          FROM questions q
          JOIN polls p ON q.poll_id = p.id
          CROSS JOIN LATERAL jsonb_array_elements_text(q.options) AS opt
         WHERE q.category = %(cat)s
           AND p.group_id = ANY(%(gids)s::uuid[])
           AND q.options IS NOT NULL
           AND jsonb_typeof(q.options) = 'array'
        UNION ALL
        SELECT sug AS label,
               v.created_at AS recency,
               (q.options_metadata -> sug) AS meta
          FROM votes v
          JOIN questions q ON v.question_id = q.id
          JOIN polls p ON q.poll_id = p.id
          CROSS JOIN LATERAL unnest(v.suggestions) AS sug
         WHERE q.category = %(cat)s
           AND p.group_id = ANY(%(gids)s::uuid[])
           AND v.suggestions IS NOT NULL
      ) src
     WHERE label IS NOT NULL AND btrim(label) <> ''
     ORDER BY recency DESC
     LIMIT %(scan)s
"""


def _query(conn, category: str, gids: list[str]) -> list[CategoryOption]:
    if not gids:
        return []
    rows = conn.execute(
        _QUERY, {"cat": category, "gids": gids, "scan": _SCAN_LIMIT}
    ).fetchall()
    # Dedup case-insensitively, keeping the most-recent casing/position and
    # back-filling metadata from any occurrence (a place suggested with rich
    # data once, typed plainly later, should still carry its favicon).
    by_key: dict[str, CategoryOption] = {}
    for r in rows:
        label = str(r["label"]).strip()
        if not label:
            continue
        key = label.lower()
        meta = r.get("meta")
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = CategoryOption(label=label, metadata=meta or None)
        elif existing.metadata is None and meta:
            # Back-fill metadata from an older occurrence onto the kept label.
            existing.metadata = meta
    # Preserve recency order (dict insertion order == first-seen == recency).
    return list(by_key.values())[:_RETURN_LIMIT]


def load_category_options(
    conn,
    *,
    browser_id: str | None,
    user_id: str | None,
    category: str,
    group_id: str | None,
    explore: bool = False,
) -> CategoryOptions:
    """Previously-referenced options for `category`, scoped to `group_id` and
    (separately) to every group the caller can see. `general` excludes any label
    already in `group` so the FE can concatenate the two without repeats.

    `explore` isolates the surfaces (migration 143): the cross-group `general`
    scope excludes 'explore'-privacy groups for a regular request, and
    restricts to them for an /explore request — so explore-poll option history
    doesn't leak into regular groups' autocomplete priming, and vice versa."""
    category = (category or "").strip()
    if not category:
        return CategoryOptions(group=[], general=[])

    group_entries: list[CategoryOption] = []
    if group_id:
        group_entries = _query(conn, category, [group_id])

    visibility = load_user_visibility(conn, browser_id, user_id=user_id)
    visible_gids = list(visibility.joined_by_group.keys())
    explore_set = explore_group_ids(conn, visible_gids)
    if explore:
        visible_gids = [g for g in visible_gids if g in explore_set]
    else:
        visible_gids = [g for g in visible_gids if g not in explore_set]
    general_entries = _query(conn, category, visible_gids)

    group_labels = {e.label.lower() for e in group_entries}
    general_filtered = [
        e for e in general_entries if e.label.lower() not in group_labels
    ][:_RETURN_LIMIT]

    return CategoryOptions(group=group_entries, general=general_filtered)


def load_known_options_by_category(
    conn,
    *,
    group_id: str | None,
    user_id: str | None,
    categories,
) -> dict[str, dict[str, CategoryOption]]:
    """For each category in `categories`, the options previously *referenced*
    (as ballot options OR suggestions) in this group OR any group the user can
    see, keyed by LOWERCASED label, carrying best-available `options_metadata`.

    This is the gate for AI poll suggestions: an LLM-proposed specific option
    (a restaurant / movie / game / place / custom choice) is only shown when it
    matches one of these known options, and it inherits the stored DB ref
    (favicon / poster / coords / address). Explore groups are excluded (the
    same isolation as `load_category_options`); suggestions are a normal-group
    feature. Tolerant — missing inputs yield empty maps."""
    gids: list[str] = []
    if group_id:
        gids.append(group_id)
    visibility = load_user_visibility(conn, None, user_id=user_id)
    for g in visibility.joined_by_group.keys():
        if g not in gids:
            gids.append(g)
    if gids:
        explore_set = explore_group_ids(conn, gids)
        gids = [g for g in gids if g not in explore_set]

    out: dict[str, dict[str, CategoryOption]] = {}
    for category in categories:
        cat = (category or "").strip()
        if not cat or not gids:
            out[category] = {}
            continue
        out[category] = {e.label.lower(): e for e in _query(conn, cat, gids)}
    return out
