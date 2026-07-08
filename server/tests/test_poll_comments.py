"""Poll comments (migration 146): create / list / delete round-trips, the
name + body validation backstops, the non-public-group member gate, the
commenter auto-join, and account-agnostic ownership on delete."""

import uuid

import psycopg

from tests.conftest import TEST_DB_URL, bid_headers, create_poll, group_members_for


def _post_comment(client, poll, body, *, browser_id, name="Test User"):
    return client.post(
        f"/api/polls/{poll['id']}/comments",
        json={"commenter_name": name, "body": body},
        headers=bid_headers(browser_id),
    )


def _get_comments(client, poll, *, browser_id):
    return client.get(
        f"/api/polls/{poll['id']}/comments", headers=bid_headers(browser_id)
    )


def _set_group_privacy_direct(group_id, privacy):
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "UPDATE groups SET privacy = %s WHERE id = %s",
            (privacy, group_id),
        )


def test_post_and_list_round_trip(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)

    r = _post_comment(client, poll, "First!", browser_id=browser_id)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["body"] == "First!"
    assert created["commenter_name"] == "Test User"
    assert created["poll_id"] == poll["id"]
    assert created["is_mine"] is True

    r2 = _post_comment(
        client, poll, "Agreed.", browser_id=browser_id, name="Second Person"
    )
    assert r2.status_code == 201, r2.text

    listed = _get_comments(client, poll, browser_id=browser_id)
    assert listed.status_code == 200, listed.text
    bodies = [c["body"] for c in listed.json()]
    assert bodies == ["First!", "Agreed."]  # oldest first


def test_is_mine_is_per_caller(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    other = str(uuid.uuid4())
    assert _post_comment(client, poll, "Mine", browser_id=browser_id).status_code == 201

    for_me = _get_comments(client, poll, browser_id=browser_id).json()
    assert [c["is_mine"] for c in for_me] == [True]
    for_other = _get_comments(client, poll, browser_id=other).json()
    assert [c["is_mine"] for c in for_other] == [False]


def test_name_required(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    r = client.post(
        f"/api/polls/{poll['id']}/comments",
        json={"body": "no name"},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 400
    assert "required" in r.json()["detail"]


def test_body_required_and_trimmed(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    r = _post_comment(client, poll, "   ", browser_id=browser_id)
    assert r.status_code == 400

    # Over-cap bodies are silently truncated (join-request message convention).
    r2 = _post_comment(client, poll, "x" * 3000, browser_id=browser_id)
    assert r2.status_code == 201
    assert len(r2.json()["body"]) == 2000


def test_unknown_and_malformed_poll_404(client, browser_id):
    r = client.get(
        f"/api/polls/{uuid.uuid4()}/comments", headers=bid_headers(browser_id)
    )
    assert r.status_code == 404
    r2 = client.get("/api/polls/not-a-uuid/comments", headers=bid_headers(browser_id))
    assert r2.status_code == 404


def test_private_group_comments_are_members_only(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    _set_group_privacy_direct(poll["group_id"], "private")

    stranger = str(uuid.uuid4())
    assert _get_comments(client, poll, browser_id=stranger).status_code == 404
    assert (
        _post_comment(client, poll, "let me in", browser_id=stranger).status_code
        == 404
    )
    # A stranger's blocked POST must NOT have joined them to the group.
    assert stranger not in group_members_for(poll["group_id"])

    # The creator (a member) still reads + writes.
    assert _get_comments(client, poll, browser_id=browser_id).status_code == 200
    assert (
        _post_comment(client, poll, "members only", browser_id=browser_id).status_code
        == 201
    )


def test_commenting_on_public_poll_joins_group(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    commenter = str(uuid.uuid4())
    r = _post_comment(
        client, poll, "drive-by comment", browser_id=commenter, name="Visitor"
    )
    assert r.status_code == 201, r.text
    assert commenter in group_members_for(poll["group_id"])


def test_delete_own_comment(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    created = _post_comment(client, poll, "oops", browser_id=browser_id).json()

    r = client.delete(
        f"/api/polls/{poll['id']}/comments/{created['id']}",
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 204
    assert _get_comments(client, poll, browser_id=browser_id).json() == []


def test_cannot_delete_another_callers_comment(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    created = _post_comment(client, poll, "keep out", browser_id=browser_id).json()

    other = str(uuid.uuid4())
    r = client.delete(
        f"/api/polls/{poll['id']}/comments/{created['id']}",
        headers=bid_headers(other),
    )
    assert r.status_code == 404
    # Still there.
    assert len(_get_comments(client, poll, browser_id=browser_id).json()) == 1


def test_delete_malformed_comment_id_returns_404_not_500(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    r = client.delete(
        f"/api/polls/{poll['id']}/comments/not-a-uuid",
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Migration 147: editing, reactions, @mentions, comment_count
# ---------------------------------------------------------------------------


def _member_account(poll, name):
    """Direct-DB setup (the test_invite_members convention): mint an account
    with a display name, link a browser, and add that browser to the poll's
    group. Returns (user_id, browser_id) strings."""
    bid = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL) as conn:
        uid = conn.execute(
            "INSERT INTO users (display_name) VALUES (%s) RETURNING id", (name,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO user_browsers (browser_id, user_id) VALUES (%s, %s)",
            (bid, uid),
        )
        conn.execute(
            "INSERT INTO group_members (group_id, browser_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (poll["group_id"], bid),
        )
    return str(uid), bid


def test_edit_own_comment(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    created = _post_comment(client, poll, "orignal", browser_id=browser_id).json()
    assert created["edited_at"] is None

    r = client.put(
        f"/api/polls/{poll['id']}/comments/{created['id']}",
        json={"body": "original (fixed typo)"},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["body"] == "original (fixed typo)"
    assert updated["edited_at"] is not None
    assert updated["is_mine"] is True

    listed = _get_comments(client, poll, browser_id=browser_id).json()
    assert listed[0]["body"] == "original (fixed typo)"
    assert listed[0]["edited_at"] is not None


def test_cannot_edit_another_callers_comment(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    created = _post_comment(client, poll, "keep", browser_id=browser_id).json()
    r = client.put(
        f"/api/polls/{poll['id']}/comments/{created['id']}",
        json={"body": "hijacked"},
        headers=bid_headers(str(uuid.uuid4())),
    )
    assert r.status_code == 404
    listed = _get_comments(client, poll, browser_id=browser_id).json()
    assert listed[0]["body"] == "keep"


def test_edit_empty_body_rejected(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    created = _post_comment(client, poll, "x", browser_id=browser_id).json()
    r = client.put(
        f"/api/polls/{poll['id']}/comments/{created['id']}",
        json={"body": "   "},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 400


def _toggle_reaction(client, poll, comment_id, emoji, *, browser_id):
    return client.post(
        f"/api/polls/{poll['id']}/comments/{comment_id}/reactions",
        json={"emoji": emoji},
        headers=bid_headers(browser_id),
    )


def test_reaction_toggle_round_trip(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    created = _post_comment(client, poll, "react to me", browser_id=browser_id).json()

    r = _toggle_reaction(client, poll, created["id"], "👍", browser_id=browser_id)
    assert r.status_code == 200, r.text
    assert r.json() == [{"emoji": "👍", "count": 1, "mine": True}]

    # A second person reacting with the same emoji bumps the count; their
    # view is mine=True, the first person's stays mine=True independently.
    other = str(uuid.uuid4())
    r2 = _toggle_reaction(client, poll, created["id"], "👍", browser_id=other)
    assert r2.json() == [{"emoji": "👍", "count": 2, "mine": True}]
    listed = _get_comments(client, poll, browser_id=browser_id).json()
    assert listed[0]["reactions"] == [{"emoji": "👍", "count": 2, "mine": True}]

    # Toggle off removes only the caller's reaction.
    r3 = _toggle_reaction(client, poll, created["id"], "👍", browser_id=browser_id)
    assert r3.json() == [{"emoji": "👍", "count": 1, "mine": False}]


def test_reaction_rejects_plain_text(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    created = _post_comment(client, poll, "hi", browser_id=browser_id).json()
    r = _toggle_reaction(client, poll, created["id"], "lol", browser_id=browser_id)
    assert r.status_code == 400


def test_mentions_stored_and_pushed(client, browser_id, monkeypatch):
    import routers.polls as polls_router

    calls = []
    monkeypatch.setattr(
        polls_router,
        "fan_out_to_user",
        lambda gid, uid, payload: calls.append((gid, uid, payload)),
    )

    poll = create_poll(client, browser_id=browser_id)
    maya_uid, _ = _member_account(poll, "Maya")
    stranger_uid = None
    with psycopg.connect(TEST_DB_URL) as conn:
        stranger_uid = str(
            conn.execute(
                "INSERT INTO users (display_name) VALUES ('Stranger') RETURNING id"
            ).fetchone()[0]
        )

    r = client.post(
        f"/api/polls/{poll['id']}/comments",
        json={
            "commenter_name": "Sam",
            "body": "@Maya what do you think?",
            # The non-member id must be silently dropped.
            "mentioned_user_ids": [maya_uid, stranger_uid],
        },
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["mentions"] == [{"user_id": maya_uid, "name": "Maya"}]

    assert len(calls) == 1
    gid, uid, payload = calls[0]
    assert uid == maya_uid
    assert payload["title"].startswith("Mentioned in")
    assert "Sam:" in payload["body"]
    assert payload["url"].startswith("/g/")
    assert payload["group_uuid"] == poll["group_id"]


def test_self_mention_not_pushed(client, browser_id, monkeypatch):
    import routers.polls as polls_router

    calls = []
    monkeypatch.setattr(
        polls_router,
        "fan_out_to_user",
        lambda gid, uid, payload: calls.append(uid),
    )

    poll = create_poll(client, browser_id=browser_id)
    # The creator's auto-account: resolve it and give it a display name +
    # (already-linked) browser so a self-mention resolves as a member.
    with psycopg.connect(TEST_DB_URL) as conn:
        me_uid = str(
            conn.execute(
                "SELECT user_id FROM user_browsers WHERE browser_id = %s",
                (browser_id,),
            ).fetchone()[0]
        )
        conn.execute(
            "UPDATE users SET display_name = 'Me' WHERE id = %s", (me_uid,)
        )

    r = client.post(
        f"/api/polls/{poll['id']}/comments",
        json={
            "commenter_name": "Me",
            "body": "note to @Me",
            "mentioned_user_ids": [me_uid],
        },
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 201, r.text
    assert r.json()["mentions"] == [{"user_id": me_uid, "name": "Me"}]
    assert calls == []  # stored, but never pushed to yourself


def test_comment_count_on_poll_response(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    assert poll["comment_count"] == 0
    _post_comment(client, poll, "one", browser_id=browser_id)
    _post_comment(client, poll, "two", browser_id=browser_id)
    r = client.get(f"/api/polls/by-id/{poll['id']}", headers=bid_headers(browser_id))
    assert r.status_code == 200
    assert r.json()["comment_count"] == 2
