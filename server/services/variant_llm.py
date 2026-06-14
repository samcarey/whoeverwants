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
    "- Each must be answerable with a plain YES or NO (NOT an either/or or "
    "multiple-choice question), end with a question mark, and be under 100 "
    "characters.\n"
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


# How many LLM round-trips to make per spawn while topping up to `count`. Small
# local models (nous-hermes2) sometimes return fewer titles than asked, so we
# re-ask (feeding what we have into `avoid`) until we reach `count` or run out
# of attempts. Cheap: spawning runs in a background task.
_MAX_ATTEMPTS = 3


def _one_call(base_title: str, want: int, avoid: list[str]) -> list[str]:
    """One LLM round-trip asking for `want` new yes/no titles. [] on failure."""
    user_lines = [f"Original question: {base_title}"]
    if avoid:
        user_lines.append(
            "Already-used variations to avoid repeating:\n"
            + "\n".join(f"- {a}" for a in avoid)
        )
    user_lines.append(
        f"Write {want} new, meaningfully different yes/no question"
        f"{'s' if want != 1 else ''}."
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
    return _extract_titles(content)


def generate_variant_titles(
    base_title: str, count: int, *, avoid: list[str] | None = None
) -> list[str]:
    """Return up to `count` NEW yes/no question titles derived from `base_title`,
    each meaningfully distinct from it, from each other, and from `avoid` (the
    poll's existing lineage). Re-asks the model (topping up) until it reaches
    `count` or exhausts `_MAX_ATTEMPTS`, since small local models often return
    fewer than requested. Returns [] on total failure / when unconfigured — the
    caller treats [] as "don't spawn this round"."""
    if not is_configured() or count <= 0:
        return []
    avoid = [a for a in (avoid or []) if a]
    blocked = {base_title.strip().lower(), *(a.strip().lower() for a in avoid)}
    collected: list[str] = []
    for _ in range(_MAX_ATTEMPTS):
        remaining = count - len(collected)
        if remaining <= 0:
            break
        # Feed what we already have into `avoid` so the re-ask doesn't repeat it.
        got = _one_call(base_title, remaining, avoid + collected)
        for t in got:
            key = t.lower()
            if key not in blocked:
                blocked.add(key)
                collected.append(t)
        if not got:
            break  # hard failure — don't burn the remaining attempts
    return collected[:count]
