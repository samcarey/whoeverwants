"""FE origin resolution for any server-side URL minting (magic links,
invite links, password-reset emails, etc.).

Reads the `Origin` request header (set by every major browser on
cross-origin fetches) and validates it against an allowlist. Falls
back to `FE_DEFAULT_ORIGIN` env var (default `https://whoeverwants.com`)
when the Origin header is absent or unmatched.

Without this allowlist, a hostile Origin header could trick the server
into embedding attacker-controlled hostnames in shareable URLs
(magic-link emails, invite URLs) — recipients would click through to
the attacker's site. The allowlist enforces "we'll only embed our own
hosts in user-bound URLs".

When adding a new host (e.g. an additional preview tier or external
embed), extend `_ALLOWED_ORIGIN_PATTERNS` here — it's the single
allowlist for the whole API.
"""

from __future__ import annotations

import os
import re

from fastapi import Request


_ALLOWED_ORIGIN_PATTERNS = [
    re.compile(r"^https://whoeverwants\.com$"),
    re.compile(r"^https://latest\.whoeverwants\.com$"),
    re.compile(r"^https://[a-z0-9-]+\.dev\.whoeverwants\.com$"),
    re.compile(r"^http://localhost:\d+$"),
    re.compile(r"^http://127\.0\.0\.1:\d+$"),
]

_DEFAULT_FE_ORIGIN = os.environ.get(
    "FE_DEFAULT_ORIGIN", "https://whoeverwants.com"
)


def resolve_fe_origin(request: Request) -> str:
    """Pick the FE origin to embed in URLs for this request.

    Returns the request's `Origin` header when it matches a known
    pattern; otherwise the configured default. The result is always a
    URL prefix without a trailing slash, suitable for concatenation
    with a path like `/invite/<token>` or `/auth/verify?token=...`.
    """
    origin = request.headers.get("origin")
    if origin and any(p.match(origin) for p in _ALLOWED_ORIGIN_PATTERNS):
        return origin
    return _DEFAULT_FE_ORIGIN
