"""Generic OpenAI-compatible chat client, shared by LLM features.

Speaks the `/v1/chat/completions` shape that Ollama (the Mac-mini dev box),
OpenAI, vLLM, LM Studio, etc. all expose — the SAME endpoint the poll-variant
evolution feature already wires up on every tier (dev → Mac Ollama via
host.docker.internal, canary → ollama.dev.whoeverwants.com, prod → whatever's
configured). So a new LLM feature inherits working config for free.

Config (env vars, read at module load):

    POLL_VARIANT_LLM_URL      full chat-completions URL (required)
    POLL_VARIANT_LLM_MODEL    default model id (required)
    POLL_VARIANT_LLM_API_KEY  optional bearer (unset for Ollama)
    POLL_VARIANT_LLM_TIMEOUT  request timeout seconds (default 60)
    POLL_SUGGEST_LLM_MODEL    OPTIONAL per-feature model override for poll
                              suggestions (falls back to POLL_VARIANT_LLM_MODEL),
                              so the suggestion feature can run a larger/better
                              model than variant evolution without re-plumbing.
    POLL_SUGGEST_LLM_TIMEOUT  OPTIONAL per-feature request timeout for poll
                              suggestions (defaults to max(variant timeout, 300)).
                              The suggestion prompt is large and qwen3:14b runs
                              with thinking ON (load-bearing for quality — see
                              CLAUDE.md), so a realistic call takes ~120s+ and
                              the 120s variant timeout cuts it off. The call is a
                              BackgroundTask, so a generous timeout blocks no one.

Graceful degradation (like RESEND_API_KEY / TMDB_API_KEY): when the URL/model
are unset, `is_configured()` is false and callers skip the feature.

Sync (httpx.Client) on purpose: callers run inside FastAPI BackgroundTasks
(threadpool) alongside the sync psycopg helpers — mirrors services/email.py.

This module is intentionally separate from services/variant_llm.py: that module
keeps its variant-specific prompt + title-extraction helpers, while this one is
the bare transport. Both read the same env vars; the duplication is one line.
"""
from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("llm_client")

_LLM_URL = os.environ.get("POLL_VARIANT_LLM_URL", "").strip()
_LLM_MODEL = os.environ.get("POLL_VARIANT_LLM_MODEL", "").strip()
_LLM_API_KEY = os.environ.get("POLL_VARIANT_LLM_API_KEY", "").strip()
_SUGGEST_MODEL = os.environ.get("POLL_SUGGEST_LLM_MODEL", "").strip() or _LLM_MODEL
try:
    _LLM_TIMEOUT = float(os.environ.get("POLL_VARIANT_LLM_TIMEOUT", "60"))
except ValueError:
    _LLM_TIMEOUT = 60.0
try:
    _SUGGEST_TIMEOUT = float(os.environ.get("POLL_SUGGEST_LLM_TIMEOUT", "").strip())
except ValueError:
    # The suggestion prompt + thinking-mode reasoning take ~120s+; give it
    # comfortable headroom over the (shorter) variant timeout by default.
    _SUGGEST_TIMEOUT = max(_LLM_TIMEOUT, 300.0)


def is_configured() -> bool:
    """True when an LLM endpoint + model are configured."""
    return bool(_LLM_URL and _LLM_MODEL)


def suggest_model() -> str:
    """The model id to use for poll-suggestion generation (override or default)."""
    return _SUGGEST_MODEL


def suggest_timeout() -> float:
    """Request timeout (seconds) for poll-suggestion generation. Larger than the
    variant timeout because the suggestion prompt is big and the model thinks."""
    return _SUGGEST_TIMEOUT


def chat(
    system: str,
    user: str,
    *,
    model: str | None = None,
    temperature: float = 0.7,
    timeout: float | None = None,
) -> str | None:
    """One chat-completion round-trip. Returns the assistant message content on
    success, or None on ANY failure (unconfigured, HTTP >= 400, connection
    error, malformed response). Callers parse/validate the content themselves.

    The `model` arg overrides the default; pass `suggest_model()` from the poll-
    suggestion path.
    """
    if not is_configured():
        return None
    payload = {
        "model": model or _LLM_MODEL,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    headers = {"Content-Type": "application/json"}
    if _LLM_API_KEY:
        headers["Authorization"] = f"Bearer {_LLM_API_KEY}"
    try:
        with httpx.Client(timeout=timeout or _LLM_TIMEOUT) as client:
            resp = client.post(_LLM_URL, headers=headers, json=payload)
        if resp.status_code >= 400:
            log.warning(
                "[llm_client] rejected: status=%s body=%s",
                resp.status_code,
                resp.text[:300],
            )
            return None
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        log.warning("[llm_client] request failed: %s", exc)
        return None
