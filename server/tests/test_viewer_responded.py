"""Account-aware `viewer_responded` on the group reads.

A vote cast on one device must clear the To Do classification on the user's
other signed-in devices, whose localStorage voted/abstained sets are empty.
The server unions votes across the account's linked browsers (mirroring the
to-do badge's `compute_badge_count`) and surfaces the result as
`PollResponse.viewer_responded`; the FE ORs it into `pollHasResponse`.
"""

import uuid

from tests.conftest import create_poll
from tests.test_badge_account import _add_member, _bearer, _sign_in


def _read_poll(client, poll_id, bid, token=None):
    resp = client.post(
        "/api/groups/mine",
        json={"include_results": False},
        headers=_bearer(bid, token),
    )
    assert resp.status_code == 200, resp.text
    for mp in resp.json():
        if mp["id"] == poll_id:
            return mp
    raise AssertionError(f"poll {poll_id} not in /mine for browser {bid}")


def _vote(client, poll, bid, token=None, name="Aye"):
    qid = poll["questions"][0]["id"]
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=_bearer(bid, token),
        json={
            "voter_name": name,
            "items": [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
            ],
        },
    )
    assert resp.status_code in (200, 201), resp.text


def test_vote_on_one_device_sets_viewer_responded_on_another(client):
    """Vote on browser A → the same account's browser B reads
    viewer_responded=True; an unrelated member still reads False."""
    email = f"responded-{uuid.uuid4().hex[:8]}@example.com"
    bid_a, bid_b = str(uuid.uuid4()), str(uuid.uuid4())
    creator = str(uuid.uuid4())
    token_a = _sign_in(client, bid_a, email)
    token_b = _sign_in(client, bid_b, email)

    poll = create_poll(client, browser_id=creator)
    group_id = poll["group_id"]
    _add_member(group_id, bid_a)
    _add_member(group_id, bid_b)

    # Neither device has voted yet.
    assert _read_poll(client, poll["id"], bid_b, token_b)["viewer_responded"] is False

    _vote(client, poll, bid_a, token_a)

    # The vote follows the account: both devices read responded.
    assert _read_poll(client, poll["id"], bid_a, token_a)["viewer_responded"] is True
    assert _read_poll(client, poll["id"], bid_b, token_b)["viewer_responded"] is True

    # An unrelated member of the same group is unaffected.
    stranger = str(uuid.uuid4())
    _add_member(group_id, stranger)
    assert _read_poll(client, poll["id"], stranger)["viewer_responded"] is False


def test_anonymous_vote_marks_own_browser_responded(client):
    """An anonymous (no-bearer) voter's own browser reads responded; the
    non-voting creator does not."""
    creator = str(uuid.uuid4())
    voter = str(uuid.uuid4())

    poll = create_poll(client, browser_id=creator)
    _add_member(poll["group_id"], voter)
    _vote(client, poll, voter, name="Anon")

    assert _read_poll(client, poll["id"], voter)["viewer_responded"] is True
    assert _read_poll(client, poll["id"], creator)["viewer_responded"] is False
