"""Auto-title generator for multipolls. See docs/multipoll-phasing.md."""

from __future__ import annotations


# Mirrors the labels exposed by components/TypeFieldInput.tsx on the frontend;
# unknown categories fall back to a title-cased version of the raw string.
_CATEGORY_LABELS: dict[str, str] = {
    "yes_no": "Yes/No",
    "yes/no": "Yes/No",
    "restaurant": "Restaurant",
    "location": "Location",
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


def _single_subpoll_default_title(category: str) -> str:
    # Mirrors generateTitle() in app/create-poll/page.tsx for 1-sub-poll cases.
    key = (category or "").strip().lower()
    if key in ("yes_no", "yes/no"):
        return "Yes/No?"
    if key == "time":
        return "Time?"
    label = _label_for(category)
    return f"{label}?" if label else "Poll?"


def generate_multipoll_title(
    sub_poll_categories: list[str],
    multipoll_context: str | None,
) -> str:
    context = (multipoll_context or "").strip() or None
    cats = [c for c in (sub_poll_categories or []) if c and c.strip()]

    if not cats:
        return context or "Poll?"

    if len(cats) == 1:
        if context:
            return f"{_label_for(cats[0])} for {context}"
        return _single_subpoll_default_title(cats[0])

    joined = _join_categories([_label_for(c) for c in cats])
    if context:
        return f"{joined} for {context}"
    return joined
