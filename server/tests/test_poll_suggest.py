"""Tests for AI poll suggestions: the DETERMINISTIC validation/dedup/parse layer
(no live LLM — the model output is the untrusted part, so the filter is what we
pin), plus the cache round-trip + history gathering against the DB.

The LLM call itself is monkeypatched: we assert the prompt is built + the reply
is parsed/validated, never that a real model produced good text (that's the
eval harness's job — prototypes/poll-suggest/).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from database import get_db
from services import llm_client, poll_suggest
from tests.conftest import create_poll


# ── validate_suggestion ────────────────────────────────────────────────────────


def test_validate_yes_no_requires_title():
    assert poll_suggest.validate_suggestion({"category": "yes_no"}) is None
    ok = poll_suggest.validate_suggestion(
        {"category": "yes_no", "title": "Should we do an offsite?"}
    )
    assert ok == {"category": "yes_no", "title": "Should we do an offsite?"}


def test_validate_limited_supply_requires_title():
    assert poll_suggest.validate_suggestion({"category": "limited_supply"}) is None
    ok = poll_suggest.validate_suggestion(
        {"category": "limited_supply", "title": "2 spare tickets"}
    )
    assert ok == {"category": "limited_supply", "title": "2 spare tickets"}


def test_validate_drops_stray_title_on_non_title_category():
    # A title on restaurant is noise — the title is auto-generated from fields.
    ok = poll_suggest.validate_suggestion(
        {"category": "restaurant", "title": "Where to eat?", "context": "Friday dinner"}
    )
    assert ok == {"category": "restaurant", "context": "Friday dinner"}


def test_validate_options_need_two_distinct():
    one = poll_suggest.validate_suggestion(
        {"category": "movie", "options": ["Dune"]}
    )
    assert one == {"category": "movie"}  # <2 → dropped, becomes suggestion-collection
    dup = poll_suggest.validate_suggestion(
        {"category": "movie", "options": ["Dune", "dune", "DUNE"]}
    )
    assert dup == {"category": "movie"}  # all the same after casefold
    two = poll_suggest.validate_suggestion(
        {"category": "movie", "options": ["Dune", "Oppenheimer"]}
    )
    assert two == {"category": "movie", "options": ["Dune", "Oppenheimer"]}


def test_validate_options_ignored_for_yes_no():
    ok = poll_suggest.validate_suggestion(
        {"category": "yes_no", "title": "Pizza tonight?", "options": ["A", "B"]}
    )
    assert ok == {"category": "yes_no", "title": "Pizza tonight?"}


def test_yes_no_rejects_choice_titles():
    # A "pick / which / choose / or" decision is a choice poll, not a yes_no.
    for bad in [
        "Summer Movie Night Pick?",
        "Which restaurant for dinner?",
        "Tacos or sushi?",
        "Choose a game for tonight",
        "Dune vs Oppenheimer?",
    ]:
        assert poll_suggest.validate_suggestion({"category": "yes_no", "title": bad}) is None, bad


def test_yes_no_keeps_genuine_yes_no_titles():
    # Elliptical yes/no prompts have no choice markers — must NOT be rejected.
    for good in ["Pizza tonight?", "Offsite in Q3?", "Should we book the cabin?", "Order more snacks?"]:
        out = poll_suggest.validate_suggestion({"category": "yes_no", "title": good})
        assert out == {"category": "yes_no", "title": good}, good


def _known(category, *pairs):
    """Build a known_options map: category -> {lower label: CategoryOption}."""
    from services.category_options import CategoryOption

    return {
        category: {
            label.lower(): CategoryOption(label=label, metadata=meta)
            for label, meta in pairs
        }
    }


def test_grounding_keeps_only_history_options_and_attaches_metadata():
    known = _known(
        "movie",
        ("Dune: Part Two", {"imageUrl": "https://img/dune.jpg", "infoUrl": "https://tmdb/1"}),
        ("Oppenheimer", {"imageUrl": "https://img/opp.jpg"}),
    )
    out = poll_suggest.validate_suggestion(
        # LLM proposes a real-but-unseen title ("Barbie") + casing drift; only the
        # two previously-referenced ones survive, with canonical casing + DB ref.
        {"category": "movie", "options": ["dune: part two", "Barbie", "OPPENHEIMER"], "context": "movie night"},
        known,
    )
    assert out is not None
    assert out["options"] == ["Dune: Part Two", "Oppenheimer"]
    assert out["options_metadata"] == {
        "Dune: Part Two": {"imageUrl": "https://img/dune.jpg", "infoUrl": "https://tmdb/1"},
        "Oppenheimer": {"imageUrl": "https://img/opp.jpg"},
    }
    assert out.get("context") == "movie night"


def test_grounding_drops_options_when_fewer_than_two_known():
    known = _known("restaurant", ("Chipotle", {"address": "1 Main St"}))
    out = poll_suggest.validate_suggestion(
        {"category": "restaurant", "options": ["Chipotle", "Olive Garden"], "context": "team dinner"},
        known,
    )
    # Only one survives the gate -> not enough for a fixed-option ballot -> the
    # suggestion collapses to category + context (open-to-suggest), never invents.
    assert out == {"category": "restaurant", "context": "team dinner"}


def test_grounding_drops_all_unknown_options_but_keeps_known_without_metadata():
    out = poll_suggest.validate_suggestion(
        {"category": "video_game", "options": ["Halo", "Fortnite"]},
        _known("video_game"),  # empty history for this category
    )
    assert out == {"category": "video_game"}
    # Options with no stored metadata are still kept (real/previously used) but
    # contribute no options_metadata.
    out2 = poll_suggest.validate_suggestion(
        {"category": "video_game", "options": ["Mario Kart 8", "Splatoon 3"]},
        _known("video_game", ("Mario Kart 8", None), ("Splatoon 3", None)),
    )
    assert out2 is not None
    assert out2["options"] == ["Mario Kart 8", "Splatoon 3"]
    assert "options_metadata" not in out2


def test_grounding_skipped_when_known_options_none():
    # Back-compat: callers that don't pass a gate keep any valid option list.
    out = poll_suggest.validate_suggestion(
        {"category": "movie", "options": ["Anything", "Goes"]}, None
    )
    assert out is not None
    assert out["options"] == ["Anything", "Goes"]


def test_validate_category_aliases_and_unknown():
    assert poll_suggest.validate_suggestion(
        {"category": "Video Game", "options": ["Mario Kart", "Smash"]}
    ) == {"category": "video_game", "options": ["Mario Kart", "Smash"]}
    assert poll_suggest.validate_suggestion({"category": "potluck"}) is None
    assert poll_suggest.validate_suggestion("not a dict") is None
    # showtime is intentionally NOT suggestable (needs a live catalog).
    assert poll_suggest.validate_suggestion({"category": "showtime"}) is None


def test_validate_trims_and_bounds():
    ok = poll_suggest.validate_suggestion(
        {"category": "custom", "context": "  spaced   out  ", "options": ["X", "Y"]}
    )
    assert ok["context"] == "spaced out"
    long_title = poll_suggest.validate_suggestion(
        {"category": "yes_no", "title": "Q " * 200}
    )
    assert len(long_title["title"]) <= poll_suggest._TITLE_MAX


# ── filter_and_dedup ───────────────────────────────────────────────────────────


def test_filter_dedups_within_batch_and_against_existing():
    existing = {
        poll_suggest._signature("restaurant", "", [], "lunch"),
    }
    raw = [
        {"category": "restaurant", "context": "lunch"},  # dup of existing → dropped
        {"category": "yes_no", "title": "Friday offsite?"},
        {"category": "yes_no", "title": "Friday offsite?"},  # dup within batch
        {"category": "movie", "options": ["Dune", "Barbie"]},
        "garbage",  # invalid → dropped
    ]
    out = poll_suggest.filter_and_dedup(raw, existing)
    assert out == [
        {"category": "yes_no", "title": "Friday offsite?"},
        {"category": "movie", "options": ["Dune", "Barbie"]},
    ]


def test_filter_caps_to_max():
    raw = [{"category": "yes_no", "title": f"Question {i}?"} for i in range(20)]
    out = poll_suggest.filter_and_dedup(raw, set())
    assert len(out) == poll_suggest.MAX_SUGGESTIONS


# ── _poll_line ─────────────────────────────────────────────────────────────────


def test_poll_line_prefers_prompt_for_yes_no():
    # yes_no's real prompt lives in details (title is often the generic "Question?").
    line = poll_suggest._poll_line(
        {"question_type": "yes_no", "title": "Question?", "details": "Standup at 9?"}
    )
    assert "Standup at 9?" in line and "[Yes/No]" in line
    # Other types show the title (auto-title) + options.
    line2 = poll_suggest._poll_line(
        {
            "question_type": "ranked_choice",
            "category": "restaurant",
            "title": "Restaurant for lunch",
            "details": "lunch",
            "options": ["Chipotle", "Sweetgreen"],
        }
    )
    assert "[Restaurant]" in line2 and "Chipotle" in line2


# ── _extract_json_array ────────────────────────────────────────────────────────


def test_extract_plain_array():
    assert poll_suggest._extract_json_array('[{"category":"yes_no","title":"x?"}]') == [
        {"category": "yes_no", "title": "x?"}
    ]


def test_extract_fenced_and_wrapped():
    fenced = '```json\n[{"category":"movie"}]\n```'
    assert poll_suggest._extract_json_array(fenced) == [{"category": "movie"}]
    wrapped = '{"suggestions": [{"category": "restaurant"}]}'
    assert poll_suggest._extract_json_array(wrapped) == [{"category": "restaurant"}]
    prose = 'Here you go:\n[{"category":"time"}]\nHope that helps!'
    assert poll_suggest._extract_json_array(prose) == [{"category": "time"}]


def test_extract_garbage_returns_empty():
    assert poll_suggest._extract_json_array("no json here") == []


# ── generate_from_history (LLM monkeypatched) ──────────────────────────────────


def test_generate_from_history_parses_and_validates(monkeypatch):
    monkeypatch.setattr(llm_client, "_LLM_URL", "http://stub")
    monkeypatch.setattr(llm_client, "_LLM_MODEL", "stub")

    captured = {}

    def fake_chat(system, user, **kwargs):
        captured["system"] = system
        captured["user"] = user
        return (
            '[{"category":"restaurant","context":"team lunch"},'
            '{"category":"yes_no","title":"Offsite in Q3?"},'
            '{"category":"banana"}]'  # invalid → filtered out
        )

    monkeypatch.setattr(llm_client, "chat", fake_chat)
    ctx = poll_suggest.HistoryContext(
        group_lines=['- [Restaurant] "Where for lunch?"'],
        user_lines=['- [Yes/No] "Standup at 9?"'],
    )
    out = poll_suggest.generate_from_history(ctx)
    assert out == [
        {"category": "restaurant", "context": "team lunch"},
        {"category": "yes_no", "title": "Offsite in Q3?"},
    ]
    # The history made it into the prompt.
    assert "Where for lunch?" in captured["user"]
    assert "Standup at 9?" in captured["user"]


def test_generate_from_history_unconfigured(monkeypatch):
    monkeypatch.setattr(llm_client, "_LLM_URL", "")
    monkeypatch.setattr(llm_client, "_LLM_MODEL", "")
    out = poll_suggest.generate_from_history(poll_suggest.HistoryContext())
    assert out == []


# ── is_stale ───────────────────────────────────────────────────────────────────


def test_is_stale():
    now = datetime(2026, 6, 14, 12, 0, tzinfo=timezone.utc)
    assert poll_suggest.is_stale(None, now) is True
    fresh = poll_suggest.CachedSuggestions(
        suggestions=[], generated_at=now - timedelta(hours=1)
    )
    assert poll_suggest.is_stale(fresh, now) is False
    old = poll_suggest.CachedSuggestions(
        suggestions=[], generated_at=now - timedelta(hours=24)
    )
    assert poll_suggest.is_stale(old, now) is True
    # Naive timestamp (DB without tz) is treated as UTC, not crashed on.
    naive = poll_suggest.CachedSuggestions(
        suggestions=[], generated_at=datetime(2026, 6, 14, 11, 0)
    )
    assert poll_suggest.is_stale(naive, now) is False


# ── DB-backed: gather + store + load round-trip ────────────────────────────────


def test_cache_round_trip_and_gather(client, browser_id):
    """Create a couple of polls, then gather history + store + load suggestions
    for the creator's auto-account. Requires the DB (skipped if unavailable)."""
    poll = create_poll(
        client,
        browser_id=browser_id,
        creator_name="Sam",
        questions=[{"question_type": "yes_no", "context": "Standup at 9?"}],
    )
    group_id = poll["group_id"]

    with get_db() as conn:
        row = conn.execute(
            "SELECT creator_user_id FROM polls WHERE id = %(id)s", {"id": poll["id"]}
        ).fetchone()
        user_id = str(row["creator_user_id"])

        ctx = poll_suggest.gather_history(conn, user_id, group_id)
        assert ctx is not None
        # The created poll shows up in both the group + user history.
        assert any("Standup at 9?" in line for line in ctx.group_lines)
        assert ctx.existing_signatures

        suggestions = [{"category": "restaurant", "context": "team lunch"}]
        poll_suggest.store_suggestions(conn, user_id, group_id, suggestions)
        loaded = poll_suggest.load_cached_suggestions(conn, user_id, group_id)
        assert loaded is not None
        assert loaded.suggestions == suggestions

        # Upsert replaces.
        poll_suggest.store_suggestions(
            conn, user_id, group_id, [{"category": "movie"}]
        )
        loaded2 = poll_suggest.load_cached_suggestions(conn, user_id, group_id)
        assert loaded2.suggestions == [{"category": "movie"}]
