"""Shared request-body validators.

Mirrors lib/nameValidation.ts on the FE — change these constants in
lockstep with the FE module.
"""

from __future__ import annotations

import re

from fastapi import HTTPException

MIN_NAME_LENGTH = 1
MAX_NAME_LENGTH = 50

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1F\x7F]")


def truncate_text(value: str | None, limit: int) -> str | None:
    """The shared trim → cap → rstrip → None rule for free-text fields whose
    columns are unbounded TEXT (SILENT truncation for raw-API callers, not a
    400 — the join-request-message convention). Returns None when nothing
    usable remains after trimming."""
    return (value or "").strip()[:limit].rstrip() or None


def validate_user_name(value: str | None, *, field: str = "name") -> str:
    """Validate a display-name field. Returns the trimmed value; raises
    HTTPException(400) on missing / out-of-range / control-char input.

    Common-sense rules only — length and control-char exclusion. We don't
    police case, emoji, punctuation, or charset since the name is a
    user-controlled display string, never used for routing or auth.
    """
    if value is None:
        raise HTTPException(status_code=400, detail=f"{field} is required")
    trimmed = value.strip()
    if len(trimmed) < MIN_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"{field} is required")
    if len(trimmed) > MAX_NAME_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be {MAX_NAME_LENGTH} characters or fewer",
        )
    if _CONTROL_CHAR_RE.search(trimmed):
        raise HTTPException(
            status_code=400, detail=f"{field} contains invalid characters"
        )
    return trimmed


# Generous cap — the longest single emoji (ZWJ family + variation selectors)
# is well under this. The FE (lib/emojiData.ts: isEmoji) is the primary
# emoji-shape gate; this is the backstop that bounds length and rejects
# obvious non-emoji text. ASCII letters never appear in emoji (regional-
# indicator flag glyphs are non-ASCII), so rejecting them filters out words
# like "dog" without rejecting keycap digits ("5️⃣").
MAX_CATEGORY_ICON_LENGTH = 64
_ASCII_LETTER_RE = re.compile(r"[A-Za-z]")


def validate_category_icon(value: str | None) -> str | None:
    """Validate a custom-category emoji. Returns the trimmed value (or None
    when empty); raises HTTPException(400) on over-length / control-char /
    plain-text input. Lenient on emoji shape — the FE owns that."""
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if len(trimmed) > MAX_CATEGORY_ICON_LENGTH:
        raise HTTPException(status_code=400, detail="Category emoji is too long")
    if _CONTROL_CHAR_RE.search(trimmed) or _ASCII_LETTER_RE.search(trimmed):
        raise HTTPException(
            status_code=400, detail="Category emoji must be an emoji"
        )
    return trimmed


# Ranked-choice headline method (migration 135). Mirror in
# lib/createPollHelpers / lib/types if the FE ever needs the literal set.
WINNER_METHODS = ("favorite", "consensus")


def validate_winner_method(value: str | None) -> str:
    """Validate a ranked-choice headline method. Returns the canonical value,
    defaulting None/empty to 'favorite' (current IRV behavior). Raises
    HTTPException(400) on an unknown value."""
    if value is None or value == "":
        return "favorite"
    if value not in WINNER_METHODS:
        raise HTTPException(
            status_code=400,
            detail=f"winner_method must be one of {WINNER_METHODS}",
        )
    return value


# Per-user "remind me to vote" preference (migration 136). Mirror these in
# lib/voteReminder.ts on the FE. 'off' + fractional ('Nx' = fire when that
# fraction of the poll's open window remains) + absolute lead times. The actual
# offset math lives in services/vote_reminder.py (the only consumer that needs
# it); validation only gates the stored string.
VOTE_REMINDER_OPTIONS = ("off", "0.5x", "0.2x", "0.1x", "1h", "3h", "1d")
DEFAULT_VOTE_REMINDER = "0.2x"


def validate_vote_reminder(value: str | None) -> str:
    """Validate a vote-reminder preference. Returns the canonical value,
    defaulting None/empty to the default. Raises HTTPException(400) on an
    unknown value."""
    if value is None or value == "":
        return DEFAULT_VOTE_REMINDER
    if value not in VOTE_REMINDER_OPTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"vote_reminder must be one of {VOTE_REMINDER_OPTIONS}",
        )
    return value
