"""LLM client for generating poll variants (the /explore evolution feature).

Provider-agnostic: speaks the OpenAI-compatible `/v1/chat/completions` shape,
which Ollama (the Mac-mini dev box, model `nous-hermes2:10.7b`), OpenAI, vLLM,
LM Studio, etc. all expose. Configure via env vars:

    POLL_VARIANT_LLM_URL      full chat-completions URL, e.g.
                              http://host.docker.internal:11434/v1/chat/completions
    POLL_VARIANT_LLM_MODEL    model id, e.g. nous-hermes2:10.7b
    POLL_VARIANT_LLM_API_KEY  optional bearer (unset for Ollama)
    POLL_VARIANT_LLM_TIMEOUT  request timeout seconds (default 60)

Graceful degradation, like RESEND_API_KEY / TMDB_API_KEY: when
POLL_VARIANT_LLM_URL is unset, `is_configured()` is false and the spawner
skips generation (logged) — the rest of the explore feed still works.

Sync (httpx.Client) on purpose: the spawner runs as a FastAPI BackgroundTask
(threadpool), alongside the sync psycopg DB helpers — mirrors services/email.py.
"""
from __future__ import annotations

import json
import logging
import os
import re

import httpx

log = logging.getLogger("variant_llm")

_LLM_URL = os.environ.get("POLL_VARIANT_LLM_URL", "").strip()
_LLM_MODEL = os.environ.get("POLL_VARIANT_LLM_MODEL", "").strip()
_LLM_API_KEY = os.environ.get("POLL_VARIANT_LLM_API_KEY", "").strip()
try:
    _LLM_TIMEOUT = float(os.environ.get("POLL_VARIANT_LLM_TIMEOUT", "60"))
except ValueError:
    _LLM_TIMEOUT = 60.0

# Keep variant prompts short + bounded so the cards stay readable.
_MAX_TITLE_CHARS = 100


def is_configured() -> bool:
    """True when an LLM endpoint + model are configured. The spawner short-
    circuits when false so an unconfigured tier just doesn't evolve polls."""
    return bool(_LLM_URL and _LLM_MODEL)


_SYSTEM_PROMPT = (
    "You help a polling app evolve a yes/no question into fresh variants. "
    "Given one yes/no poll question, write NEW yes/no questions that another "
    "group of people might find more interesting or decision-relevant.\n"
    "RULES:\n"
    "- Each variant must be MEANINGFULLY DIFFERENT from the original AND from "
    "the others: change the angle, scope, stakes, or the specific decision "
    "being asked. Do NOT just swap synonyms or rephrase the same question.\n"
    "- Stay on the same broad topic so they read as siblings, not random.\n"
    "- Each must be answerable with yes or no, end with a question mark, and be "
    "under 100 characters.\n"
    "- Output ONLY a JSON array of strings (the questions). No prose, no keys."
)


def _extract_titles(content: str) -> list[str]:
    """Pull the JSON array of strings out of the model's reply, tolerating
    markdown fences / stray prose around it."""
    content = content.strip()
    # Strip ```json ... ``` fences if present.
    fenced = re.search(r"```(?:json)?\s*(.+?)```", content, re.DOTALL)
    if fenced:
        content = fenced.group(1).strip()
    candidates: list = []
    try:
        candidates = json.loads(content)
    except (ValueError, TypeError):
        # Fallback: first bracketed array anywhere in the text.
        m = re.search(r"\[.*\]", content, re.DOTALL)
        if m:
            try:
                candidates = json.loads(m.group(0))
            except (ValueError, TypeError):
                candidates = []
    out: list[str] = []
    seen: set[str] = set()
    for c in candidates if isinstance(candidates, list) else []:
        if not isinstance(c, str):
            continue
        t = " ".join(c.split()).strip()[:_MAX_TITLE_CHARS].strip()
        key = t.lower()
        if t and key not in seen:
            seen.add(key)
            out.append(t)
    return out


def generate_variant_titles(
    base_title: str, count: int, *, avoid: list[str] | None = None
) -> list[str]:
    """Return up to `count` NEW yes/no question titles derived from `base_title`,
    each meaningfully distinct from it, from each other, and from `avoid` (the
    poll's existing lineage). Returns [] on any failure / when unconfigured —
    the caller treats [] as "don't spawn this round"."""
    if not is_configured() or count <= 0:
        return []
    avoid = [a for a in (avoid or []) if a]
    user_lines = [f"Original question: {base_title}"]
    if avoid:
        user_lines.append(
            "Already-used variations to avoid repeating:\n"
            + "\n".join(f"- {a}" for a in avoid)
        )
    user_lines.append(
        f"Write {count} new, meaningfully different yes/no question"
        f"{'s' if count != 1 else ''}."
    )
    payload = {
        "model": _LLM_MODEL,
        "temperature": 0.95,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": "\n\n".join(user_lines)},
        ],
    }
    headers = {"Content-Type": "application/json"}
    if _LLM_API_KEY:
        headers["Authorization"] = f"Bearer {_LLM_API_KEY}"
    try:
        with httpx.Client(timeout=_LLM_TIMEOUT) as client:
            resp = client.post(_LLM_URL, headers=headers, json=payload)
        if resp.status_code >= 400:
            log.warning(
                "[variant_llm] LLM rejected request: status=%s body=%s",
                resp.status_code,
                resp.text[:300],
            )
            return []
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        log.warning("[variant_llm] generation failed: %s", exc)
        return []
    titles = _extract_titles(content)
    # Drop any that collide with the original or the avoid set (case-insensitive).
    blocked = {base_title.strip().lower(), *(a.strip().lower() for a in avoid)}
    titles = [t for t in titles if t.lower() not in blocked]
    return titles[:count]
