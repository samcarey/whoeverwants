"""Coverage for the poll-category recency ordering that drives the
group page's category bubble bar.

Exercises `services/poll_categories.py` + the
`GET /api/users/me/poll-category-history` endpoint:

  * empty history → both lists empty
  * general recency reflects creation order, most-recent-first
  * per-group `group` list scoped to one group; other groups' polls
    show up in `general` but not in `group`
  * a time question is recorded as "time" (not its stored "custom"
    category) so the value matches the bubble the user tapped
  * re-creating a category bumps it to the front of recency
  * anonymous request → empty lists (never errors)
  * cross-browser: a signed-in user's two browsers share one ordering
"""

import uuid

import psycopg
import pytest

from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import (
    TEST_DB_URL,
    bid_headers,
    create_poll,
)


def _category_question(category, **overrides):
    # question_type stays yes_no so we don't fight time-question
    # validation; only the stored `category` varies, which is what the
    # recency recorder keys on (via `_category_for_title`).
    base = {"question_type": "yes_no", "category": category}
    base.update(overrides)
    return base


def _history(client, browser_id=None, token=None, group=None):
    qs = f"?group={group}" if group else ""
    headers = bid_headers(browser_id)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = client.get(f"/api/users/me/poll-category-history{qs}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _sign_in(client, browser_id, email=None):
    raw_email = email or f"cat-{uuid.uuid4().hex[:8]}@example.com"
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            """
            INSERT INTO magic_link_tokens (token_hash, email, browser_id, expires_at)
            VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')
            """,
            (hash_token(token), normalize_email(raw_email), browser_id),
        )
        conn.commit()
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"]


def test_empty_history_returns_empty_lists(client):
    body = _history(client, browser_id=str(uuid.uuid4()))
    assert body == {"group": [], "general": []}


def test_anonymous_request_returns_empty(client):
    # No X-Browser-Id header → TestClient still gets a minted one via
    # middleware, but it has created nothing → empty lists, not an error.
    resp = client.get("/api/users/me/poll-category-history")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"group": [], "general": []}


def test_general_recency_most_recent_first(client, creator_secret):
    bid = str(uuid.uuid4())
    # Create in this order: movie, then yes_no, then location.
    create_poll(client, creator_secret, browser_id=bid, questions=[_category_question("movie")])
    create_poll(client, creator_secret, browser_id=bid, questions=[_category_question("yes_no")])
    create_poll(client, creator_secret, browser_id=bid, questions=[_category_question("location")])

    body = _history(client, browser_id=bid)
    assert body["general"][:3] == ["location", "yes_no", "movie"]


def test_per_group_scoping(client, creator_secret):
    bid = str(uuid.uuid4())
    # Group A gets a movie poll; group B gets a location poll.
    poll_a = create_poll(
        client, creator_secret, browser_id=bid, questions=[_category_question("movie")]
    )
    group_a = poll_a["group_id"]
    create_poll(
        client,
        creator_secret,
        browser_id=bid,
        group_id=group_a,
        questions=[_category_question("video_game")],
    )
    create_poll(
        client, creator_secret, browser_id=bid, questions=[_category_question("location")]
    )

    # Group A's per-group list has movie + video_game, NOT location.
    body = _history(client, browser_id=bid, group=group_a)
    assert set(body["group"]) == {"movie", "video_game"}
    assert "location" not in body["group"]
    # General spans all groups.
    assert set(body["general"]) >= {"movie", "video_game", "location"}


def test_time_question_recorded_as_time(client, creator_secret):
    bid = str(uuid.uuid4())
    # Time bubble stores category="custom" but question_type="time"; the
    # recorder normalizes to "time" so it matches the bubble.
    create_poll(
        client,
        creator_secret,
        browser_id=bid,
        questions=[{"question_type": "time", "category": "custom"}],
    )
    body = _history(client, browser_id=bid)
    assert "time" in body["general"]
    assert "custom" not in body["general"]


def test_recreating_category_bumps_recency(client, creator_secret):
    bid = str(uuid.uuid4())
    create_poll(client, creator_secret, browser_id=bid, questions=[_category_question("movie")])
    create_poll(client, creator_secret, browser_id=bid, questions=[_category_question("location")])
    # location is now most recent. Re-create movie → it jumps back to front.
    create_poll(client, creator_secret, browser_id=bid, questions=[_category_question("movie")])

    body = _history(client, browser_id=bid)
    assert body["general"][0] == "movie"


def test_cross_browser_union_for_signed_in_user(client, creator_secret):
    # One user, two browsers. Sign in on both with the same email so they
    # link to one user_id; categories created on browser A are visible
    # when querying from browser B.
    email = f"cat-{uuid.uuid4().hex[:8]}@example.com"
    bid_a = str(uuid.uuid4())
    bid_b = str(uuid.uuid4())
    token_a, user_a = _sign_in(client, bid_a, email)
    token_b, user_b = _sign_in(client, bid_b, email)
    assert user_a == user_b  # same person, two devices

    create_poll(client, creator_secret, browser_id=bid_a, questions=[_category_question("movie")])

    # Querying from browser B (with the linked session token) sees A's
    # category via the user_browsers union.
    body = _history(client, browser_id=bid_b, token=token_b)
    assert "movie" in body["general"]
