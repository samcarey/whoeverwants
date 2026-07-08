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
