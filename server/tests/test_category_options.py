"""Coverage for previously-referenced category options that prime the
create-poll autocomplete dropdown.

Exercises `services/category_options.py` + the
`GET /api/users/me/category-options` endpoint:

  * empty history → both lists empty
  * finalized ballot options surface for their category, with metadata
  * vote suggestions surface too (recency from the vote)
  * category filter: a restaurant query never returns movie options
  * per-group scoping: `group` is the one group; `general` spans all and
    excludes labels already in `group`
  * recency: most-recent reference first
  * anonymous request → empty lists (never errors)
"""

import uuid
from datetime import datetime, timedelta, timezone

from tests.conftest import bid_headers, create_poll

JOE = {
    "name": "Joe's Pizza",
    "rating": 4.5,
    "cuisine": "pizza",
    "imageUrl": "https://example.com/joe.ico",
}
SUSHI = {
    "name": "Sushi Place",
    "rating": 4.8,
    "cuisine": "sushi",
    "imageUrl": "https://example.com/sushi.ico",
}


def _ranked_question(category, options, metadata=None, **overrides):
    base = {
        "question_type": "ranked_choice",
        "category": category,
        "title": f"Pick a {category}?",
        "options": options,
    }
    if metadata:
        base["options_metadata"] = metadata
    base.update(overrides)
    return base


def _options(client, category, *, browser_id=None, group=None):
    qs = f"?category={category}"
    if group:
        qs += f"&group={group}"
    resp = client.get(
        f"/api/users/me/category-options{qs}", headers=bid_headers(browser_id)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _labels(entries):
    return [e["label"] for e in entries]


def test_empty_returns_empty_lists(client):
    body = _options(client, "restaurant", browser_id=str(uuid.uuid4()))
    assert body == {"group": [], "general": []}


def test_anonymous_request_returns_empty(client):
    resp = client.get("/api/users/me/category-options?category=restaurant")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"group": [], "general": []}


def test_finalized_options_surface_with_metadata(client, creator_secret):
    bid = str(uuid.uuid4())
    poll = create_poll(
        client,
        creator_secret,
        browser_id=bid,
        questions=[
            _ranked_question(
                "restaurant",
                ["Joe's Pizza", "Sushi Place"],
                metadata={"Joe's Pizza": JOE, "Sushi Place": SUSHI},
            )
        ],
    )
    group_id = poll["group_id"]

    body = _options(client, "restaurant", browser_id=bid, group=group_id)
    assert set(_labels(body["group"])) == {"Joe's Pizza", "Sushi Place"}
    # Metadata round-trips so the dropdown can render the favicon + rating.
    by_label = {e["label"]: e["metadata"] for e in body["group"]}
    assert by_label["Joe's Pizza"] == JOE
    # `general` excludes labels already in `group`.
    assert _labels(body["general"]) == []


def test_category_filter(client, creator_secret):
    bid = str(uuid.uuid4())
    create_poll(
        client,
        creator_secret,
        browser_id=bid,
        questions=[_ranked_question("restaurant", ["Joe's Pizza", "Sushi Place"])],
    )
    create_poll(
        client,
        creator_secret,
        browser_id=bid,
        questions=[_ranked_question("movie", ["Dune", "Barbie"])],
    )

    rest = _options(client, "restaurant", browser_id=bid)
    assert set(_labels(rest["general"])) == {"Joe's Pizza", "Sushi Place"}
    assert "Dune" not in _labels(rest["general"])

    movies = _options(client, "movie", browser_id=bid)
    assert set(_labels(movies["general"])) == {"Dune", "Barbie"}


def test_per_group_scoping_and_general_dedup(client, creator_secret):
    bid = str(uuid.uuid4())
    poll_a = create_poll(
        client,
        creator_secret,
        browser_id=bid,
        questions=[_ranked_question("restaurant", ["Joe's Pizza", "Sushi Place"])],
    )
    group_a = poll_a["group_id"]
    # A second group with a different restaurant option.
    create_poll(
        client,
        creator_secret,
        browser_id=bid,
        questions=[_ranked_question("restaurant", ["Taco Stand", "Joe's Pizza"])],
    )

    body = _options(client, "restaurant", browser_id=bid, group=group_a)
    # group scope = only group A's options.
    assert set(_labels(body["group"])) == {"Joe's Pizza", "Sushi Place"}
    # general spans both groups but excludes labels already in group (Joe's
    # Pizza appears in A, so general only carries the other group's Taco Stand).
    assert "Taco Stand" in _labels(body["general"])
    assert "Joe's Pizza" not in _labels(body["general"])
    assert "Sushi Place" not in _labels(body["general"])


def test_recency_most_recent_first(client, creator_secret):
    bid = str(uuid.uuid4())
    create_poll(
        client,
        creator_secret,
        browser_id=bid,
        questions=[_ranked_question("movie", ["Dune", "Barbie"])],
    )
    create_poll(
        client,
        creator_secret,
        browser_id=bid,
        questions=[_ranked_question("movie", ["Oppenheimer", "Wonka"])],
    )
    body = _options(client, "movie", browser_id=bid)
    labels = _labels(body["general"])
    # The most-recent poll's options come first.
    assert labels.index("Oppenheimer") < labels.index("Dune")
    assert labels.index("Wonka") < labels.index("Barbie")


def test_vote_suggestions_surface(client):
    """A suggestion submitted during the prephase counts as a 'referenced'
    option and surfaces (with the vote's metadata)."""
    creator = str(uuid.uuid4())
    prephase = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    deadline = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    resp = client.post(
        "/api/polls",
        json={
            "creator_name": "Alice",
            "response_deadline": deadline,
            "prephase_deadline": prephase,
            "allow_pre_ranking": True,
            "questions": [
                {
                    "question_type": "ranked_choice",
                    "category": "restaurant",
                    "title": "Dinner?",
                    "options": [],
                    "suggestion_deadline_minutes": 1440,
                }
            ],
        },
        headers={"X-Browser-Id": creator},
    )
    assert resp.status_code == 201, resp.text
    poll = resp.json()
    qid = poll["questions"][0]["id"]

    # The creator suggests a restaurant (so it's referenced by the creator's
    # browser → visible to them).
    sub = client.post(
        f"/api/polls/{poll['id']}/votes",
        json={
            "voter_name": "Alice",
            "items": [
                {
                    "question_id": qid,
                    "vote_type": "ranked_choice",
                    "suggestions": ["Joe's Pizza"],
                    "options_metadata": {"Joe's Pizza": JOE},
                }
            ],
        },
        headers={"X-Browser-Id": creator},
    )
    assert sub.status_code == 201, sub.text

    body = _options(client, "restaurant", browser_id=creator)
    assert "Joe's Pizza" in _labels(body["general"])
    by_label = {e["label"]: e["metadata"] for e in body["general"]}
    assert by_label["Joe's Pizza"] == JOE
