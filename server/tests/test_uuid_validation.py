"""Malformed UUID handling — every {poll_id} / {question_id} / {browser_id}
path param must 404 instead of 500.

Repro: before the fix, `GET /api/polls/by-id/NOT-A-UUID` would crash with
`psycopg.errors.InvalidTextRepresentation: invalid input syntax for type
uuid: "NOT-A-UUID"` and return 500. The router now rejects malformed UUIDs
with 404 before the DB query.
"""

import uuid
import pytest


BAD_INPUTS = [
    "NOT-A-UUID",
    "12345",
    "abc-def-ghi",
    "",
    "../../etc/passwd",
    "00000000-0000-0000-0000-00000000000",  # 31 hex (too short)
    "00000000-0000-0000-0000-0000000000000",  # 33 hex (too long)
]


class TestBadUuidPaths:
    @pytest.mark.parametrize("bad", BAD_INPUTS)
    def test_get_poll_by_id_404s_on_bad_uuid(self, client, bad):
        resp = client.get(f"/api/polls/by-id/{bad}")
        # 404 is the expected outcome; FastAPI may also return 405 if the route
        # doesn't match at all (e.g. empty path), but it must NEVER 500.
        assert resp.status_code < 500, f"{bad!r}: {resp.status_code} {resp.text}"

    @pytest.mark.parametrize("bad", BAD_INPUTS)
    def test_get_question_404s_on_bad_uuid(self, client, bad):
        resp = client.get(f"/api/questions/{bad}")
        assert resp.status_code < 500, f"{bad!r}: {resp.status_code} {resp.text}"

    @pytest.mark.parametrize("bad", BAD_INPUTS)
    def test_get_results_404s_on_bad_uuid(self, client, bad):
        resp = client.get(f"/api/questions/{bad}/results")
        assert resp.status_code < 500, f"{bad!r}: {resp.status_code} {resp.text}"

    @pytest.mark.parametrize("bad", BAD_INPUTS)
    def test_get_votes_404s_on_bad_uuid(self, client, bad):
        resp = client.get(f"/api/questions/{bad}/votes")
        assert resp.status_code < 500, f"{bad!r}: {resp.status_code} {resp.text}"

    @pytest.mark.parametrize("bad", BAD_INPUTS)
    def test_get_user_image_404s_on_bad_uuid(self, client, bad):
        resp = client.get(f"/api/users/by-browser-id/{bad}/image")
        assert resp.status_code < 500, f"{bad!r}: {resp.status_code} {resp.text}"

    def test_close_poll_with_bad_uuid_404s(self, client):
        resp = client.post(
            "/api/polls/NOT-A-UUID/close",
            json={"creator_secret": "x", "close_reason": "manual"},
        )
        assert resp.status_code == 404

    def test_reopen_poll_with_bad_uuid_404s(self, client):
        resp = client.post(
            "/api/polls/NOT-A-UUID/reopen",
            json={"creator_secret": "x"},
        )
        assert resp.status_code == 404

    def test_cutoff_suggestions_with_bad_uuid_404s(self, client):
        resp = client.post(
            "/api/polls/NOT-A-UUID/cutoff-suggestions",
            json={"creator_secret": "x"},
        )
        assert resp.status_code == 404

    def test_submit_poll_votes_with_bad_uuid_404s(self, client):
        resp = client.post(
            "/api/polls/NOT-A-UUID/votes",
            json={"items": [{"question_id": str(uuid.uuid4()),
                             "vote_type": "yes_no", "yes_no_choice": "yes"}]},
        )
        assert resp.status_code == 404

    def test_valid_uuid_still_404s_when_not_found(self, client):
        """Sanity check: valid UUID that doesn't exist still 404s (not 500)."""
        resp = client.get(f"/api/polls/by-id/{uuid.uuid4()}")
        assert resp.status_code == 404
