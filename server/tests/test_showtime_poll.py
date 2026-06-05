"""Showtime question type — winner algorithm (pure) + create/vote/results (API).

Winner rule mirrors the time-preference winner: maximize attendance (fewest
can't-attend) → maximize likes (want) → earliest. plus-one weighting flows
through `vote_weight`.
"""

import uuid

import pytest

from algorithms.showtime import calculate_showtime_results


def _vote(liked=None, disliked=None, plus_ones=None):
    return {
        "liked_slots": liked if liked is not None else [],
        "disliked_slots": disliked if disliked is not None else [],
        "plus_one_names": plus_ones,
    }


class TestShowtimeAlgorithm:
    OPTS = [
        "2026-06-20 19:10-21:56",  # A (earliest)
        "2026-06-20 21:30-00:16",  # B
        "2026-06-21 14:00-16:46",  # C
    ]

    def test_max_attendance_wins(self):
        A, B, C = self.OPTS
        votes = [
            _vote(liked=[A], disliked=[C]),
            _vote(liked=[B], disliked=[C]),
            _vote(disliked=[C]),
        ]
        r = calculate_showtime_results(self.OPTS, votes)
        # C has 3 dislikes; A and B have 0. A is earlier → A wins.
        assert r["winner"] == A
        assert r["dislike_counts"][C] == 3
        # 3 preference respondents; attendance = 3 - dislikes.
        assert r["attendance_counts"][A] == 3
        assert r["attendance_counts"][C] == 0

    def test_likes_break_attendance_tie(self):
        A, B, C = self.OPTS
        votes = [
            _vote(liked=[B]),
            _vote(liked=[B]),
            _vote(),  # all-neutral submission (counts as a respondent)
        ]
        r = calculate_showtime_results(self.OPTS, votes)
        # No dislikes anywhere → attendance tie; B has the most likes.
        assert r["winner"] == B
        assert r["like_counts"][B] == 2
        assert r["attendance_counts"][B] == 3

    def test_earliest_breaks_full_tie(self):
        A, B, C = self.OPTS
        votes = [_vote(), _vote()]
        r = calculate_showtime_results(self.OPTS, votes)
        # No likes, no dislikes → earliest wins.
        assert r["winner"] == A

    def test_plus_one_weighting(self):
        A, B, C = self.OPTS
        votes = [
            _vote(disliked=[A], plus_ones=["Friend1", "Friend2"]),  # weight 3 against A
            _vote(liked=[A]),  # weight 1 for A
        ]
        r = calculate_showtime_results(self.OPTS, votes)
        assert r["dislike_counts"][A] == 3
        # A excluded by 3, B and C by 0 → A loses despite a like.
        assert r["winner"] != A
        assert r["winner"] == B  # earliest of the un-disliked


# --- API integration (requires the test DB; runs in CI) ---


def _showtime_question():
    keys = ["2026-06-20 19:10-21:56", "2026-06-20 21:30-00:16"]
    return {
        "question_type": "showtime",
        "category": "showtime",
        "context": "Dune: Part Two",
        "is_auto_title": True,
        "options": keys,
        "options_metadata": {
            keys[0]: {
                "session_id": "1", "film_name": "Dune: Part Two",
                "cinema_name": "Alamo South Lamar", "format": "70mm",
                "seats_left": 42, "runtime": 166,
            },
            keys[1]: {
                "session_id": "2", "film_name": "Dune: Part Two",
                "cinema_name": "Alamo South Lamar", "format": "Digital",
                "seats_left": 80, "runtime": 166,
            },
        },
    }


def _submit_showtime_vote(client, poll, qid, *, liked, disliked, name="Voter"):
    bid = str(uuid.uuid4())
    body = {
        "voter_name": name,
        "items": [
            {
                "question_id": qid,
                "vote_type": "showtime",
                "liked_slots": liked,
                "disliked_slots": disliked,
            }
        ],
    }
    return client.post(
        f"/api/polls/{poll['id']}/votes", json=body, headers={"X-Browser-Id": bid}
    )


class TestShowtimePollApi:
    def test_create_vote_and_winner(self, client):
        from tests.conftest import create_poll

        poll = create_poll(client, questions=[_showtime_question()])
        assert poll["questions"][0]["question_type"] == "showtime"
        # plus-ones default ON for showtime (group outings), like time.
        assert poll["allow_plus_ones"] is True
        # Auto-title "Showtime for Dune: Part Two".
        assert "Showtime" in poll["title"]

        qid = poll["questions"][0]["id"]
        A, B = poll["questions"][0]["options"]

        # Two voters want A, one can't attend A.
        r1 = _submit_showtime_vote(client, poll, qid, liked=[A], disliked=[], name="Ann")
        assert r1.status_code == 201, r1.text
        _submit_showtime_vote(client, poll, qid, liked=[A], disliked=[], name="Bob")
        _submit_showtime_vote(client, poll, qid, liked=[], disliked=[A], name="Cy")

        res = client.get(f"/api/questions/{qid}/results")
        assert res.status_code == 200, res.text
        data = res.json()
        # A: 2 likes, 1 dislike → attendance 2. B: 0/0 → attendance 3 → B wins.
        assert data["dislike_counts"][A] == 1
        assert data["like_counts"][A] == 2
        assert data["attendance_counts"][A] == 2
        assert data["attendance_counts"][B] == 3
        assert data["winner"] == B
