"""Auto-title generator for polls. See docs/poll-phasing.md.

Rules (from the user spec):
- Single question: title is just the question's own title (category + its own
  context as "for X" suffix).
- Multiple questions, all sharing the same context: comma-join the categories
  + "for X", e.g. "Restaurant, Movie for Tonight". If that would overflow the
  one-line cap, fall back to "Questions for X".
- Multiple questions, distinct per-question contexts: greedily list as many
  "Category for Context" pairs as fit on one line, then append ", etc." Falls
  back to "Questions" if even one pair doesn't fit.
- No context anywhere: comma-join the category labels.

A poll-level context (polls.context, drives the "for X" suffix) overrides any
per-question contexts: if it's set, every question's contribution to the title
shares that suffix.
"""

from __future__ import annotations


# Mirrors the labels exposed by components/TypeFieldInput.tsx on the frontend;
# unknown categories fall back to a title-cased version of the raw string.
_CATEGORY_LABELS: dict[str, str] = {
    "yes_no": "Yes/No",
    "yes/no": "Yes/No",
    "restaurant": "Restaurant",
    "location": "Place",
    "time": "Time",
    "movie": "Movie",
    "videogame": "Video Game",
    "petname": "Pet Name",
    "custom": "Custom",
}


# Approximation of "fits on one line" on mobile. Matches the FE TITLE_LIMIT
# in app/create-poll/createPollHelpers.ts so the draft preview and the
# server-stored title agree on when to fall back.
_TITLE_CHAR_LIMIT = 40


def _label_for(category: str) -> str:
    if not category:
        return ""
    key = category.strip().lower()
    if key in _CATEGORY_LABELS:
        return _CATEGORY_LABELS[key]
    return " ".join(word.capitalize() for word in category.strip().split())


def _single_question_default_title(category: str) -> str:
    # Mirrors generateTitle() in app/create-question/page.tsx for 1-question cases.
    key = (category or "").strip().lower()
    if key in ("yes_no", "yes/no"):
        return "Yes/No?"
    if key == "time":
        return "Time?"
    label = _label_for(category)
    return f"{label}?" if label else "Question?"


def _shared_context(contexts: list[str | None]) -> str | None:
    """Return the single context shared by every question, or None when any
    context is missing or the values diverge. Comparison is
    case-insensitive but the returned string preserves the first occurrence's
    casing."""
    if not contexts:
        return None
    normalized = [(c or "").strip() for c in contexts]
    if not all(normalized):
        return None
    if len({c.lower() for c in normalized}) != 1:
        return None
    return normalized[0]


def _comma_join(parts: list[str]) -> str:
    return ", ".join(parts)


def _build_distinct_contexts_title(
    cats: list[str],
    contexts: list[str | None],
    char_limit: int,
) -> str:
    """Greedy 'Cat1 for Ctx1, Cat2 for Ctx2, etc.' builder. Adds entries
    until the next one (with a trailing ", etc.") would overflow, then stops
    and appends ", etc." if any entries were dropped. Falls back to
    'Questions' when not even one entry fits."""
    parts: list[str] = []
    for cat, ctx in zip(cats, contexts):
        ctx_stripped = (ctx or "").strip()
        label = _label_for(cat)
        if ctx_stripped:
            parts.append(f"{label} for {ctx_stripped}")
        else:
            parts.append(label)

    accumulated: list[str] = []
    for i, part in enumerate(parts):
        is_last = i == len(parts) - 1
        # "candidate" = full title if we stop after appending part. When part
        # isn't the last item we'd need to append ", etc." too.
        candidate_full = _comma_join(accumulated + [part])
        candidate_with_etc = candidate_full if is_last else candidate_full + ", etc."
        if accumulated and len(candidate_with_etc) > char_limit:
            return _comma_join(accumulated) + ", etc."
        accumulated.append(part)

    if not accumulated:
        return "Questions"
    return _comma_join(accumulated)


def generate_poll_title(
    question_categories: list[str],
    poll_context: str | None,
    question_contexts: list[str | None] | None = None,
) -> str:
    poll_ctx = (poll_context or "").strip() or None
    cats = [c for c in (question_categories or []) if c and c.strip()]

    if not cats:
        return poll_ctx or "Question?"

    # Pad question_contexts to len(cats) so zip-style iteration is safe even
    # when the caller didn't supply them.
    raw_contexts = list(question_contexts or [])
    while len(raw_contexts) < len(cats):
        raw_contexts.append(None)
    raw_contexts = raw_contexts[: len(cats)]

    if len(cats) == 1:
        # Prefer the poll-level context when set; otherwise use the
        # question's own context. This makes the 1-question title equal to
        # the question's auto-title (e.g. "Restaurant for Tonight").
        ctx = poll_ctx or ((raw_contexts[0] or "").strip() or None)
        if ctx:
            return f"{_label_for(cats[0])} for {ctx}"
        return _single_question_default_title(cats[0])

    shared = poll_ctx or _shared_context(raw_contexts)

    if shared:
        joined = _comma_join([_label_for(c) for c in cats])
        candidate = f"{joined} for {shared}"
        if len(candidate) <= _TITLE_CHAR_LIMIT:
            return candidate
        return f"Questions for {shared}"

    has_any_context = any((c or "").strip() for c in raw_contexts)
    if has_any_context:
        return _build_distinct_contexts_title(cats, raw_contexts, _TITLE_CHAR_LIMIT)

    # No context anywhere — just comma-join category labels.
    return _comma_join([_label_for(c) for c in cats])
