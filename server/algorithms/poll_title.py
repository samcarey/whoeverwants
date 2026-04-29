"""Auto-title generator for polls. See docs/poll-phasing.md."""

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


def _label_for(category: str) -> str:
    if not category:
        return ""
    key = category.strip().lower()
    if key in _CATEGORY_LABELS:
        return _CATEGORY_LABELS[key]
    return " ".join(word.capitalize() for word in category.strip().split())


def _join_categories(labels: list[str]) -> str:
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} and {labels[1]}"
    return ", ".join(labels[:-1]) + f", and {labels[-1]}"


def _single_question_default_title(category: str) -> str:
    # Mirrors generateTitle() in app/create-question/page.tsx for 1-question cases.
    key = (category or "").strip().lower()
    if key in ("yes_no", "yes/no"):
        return "Yes/No?"
    if key == "time":
        return "Time?"
    label = _label_for(category)
    return f"{label}?" if label else "Question?"


def generate_poll_title(
    question_categories: list[str],
    poll_context: str | None,
) -> str:
    context = (poll_context or "").strip() or None
    cats = [c for c in (question_categories or []) if c and c.strip()]

    if not cats:
        return context or "Question?"

    if len(cats) == 1:
        if context:
            return f"{_label_for(cats[0])} for {context}"
        return _single_question_default_title(cats[0])

    joined = _join_categories([_label_for(c) for c in cats])
    if context:
        return f"{joined} for {context}"
    return joined
