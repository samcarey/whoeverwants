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
