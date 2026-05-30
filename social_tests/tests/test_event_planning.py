"""Event Planning — multi-question polls, the marquee real-life use case.

The biggest capability the original suite never covered: a single poll can
bundle several category ballots (Dinner ranked-choice + "Bring partners?"
yes/no + Activity ranked-choice). One shareable link, one Submit, atomic
across all questions. This is "plan the whole night in one place" — the
feature most likely to pull a group off their endless chat thread.
"""


class TestOffsitePlan:
    """A team plans an offsite in one multi-question poll."""

    def test_three_question_offsite(self, api, result):
        """One poll, three questions, four voters, atomic submission.

        SCENARIO: The organizer bundles three decisions into one poll:
          Q0 (ranked) Dinner: Italian / Thai / BBQ
          Q1 (yes/no) Bring partners?
          Q2 (ranked) Activity: Bowling / Escape Room / Karaoke
        Four teammates each answer all three in one go. One teammate abstains
        on the partners question only (partial abstain).

        EXPECTATION: All three questions resolve independently from one batch;
        the partial abstain affects only Q1.
        """
        poll = api.create_multi_poll(
            None,
            [
                {"poll_type": "ranked_choice", "context": "Dinner", "options": ["Italian", "Thai", "BBQ"]},
                {"poll_type": "yes_no", "context": "Bring partners?"},
                {"poll_type": "ranked_choice", "context": "Activity", "options": ["Bowling", "Escape Room", "Karaoke"]},
            ],
            creator_name="Organizer",
        )

        result.assert_technical("Poll has 3 questions", len(poll["questions"]) == 3)

        api.vote_batch(poll["id"], "Aisha", [
            {"question_index": 0, "vote_type": "ranked_choice", "ranked_choices": ["Thai", "Italian", "BBQ"]},
            {"question_index": 1, "vote_type": "yes_no", "yes_no_choice": "yes"},
            {"question_index": 2, "vote_type": "ranked_choice", "ranked_choices": ["Escape Room", "Bowling", "Karaoke"]},
        ])
        api.vote_batch(poll["id"], "Marcus", [
            {"question_index": 0, "vote_type": "ranked_choice", "ranked_choices": ["Thai", "BBQ", "Italian"]},
            {"question_index": 1, "vote_type": "yes_no", "yes_no_choice": "no"},
            {"question_index": 2, "vote_type": "ranked_choice", "ranked_choices": ["Escape Room", "Karaoke", "Bowling"]},
        ])
        api.vote_batch(poll["id"], "Priya", [
            {"question_index": 0, "vote_type": "ranked_choice", "ranked_choices": ["Italian", "Thai", "BBQ"]},
            {"question_index": 1, "vote_type": "yes_no", "yes_no_choice": "yes"},
            {"question_index": 2, "vote_type": "ranked_choice", "ranked_choices": ["Bowling", "Escape Room", "Karaoke"]},
        ])
        # Jordan votes on dinner + activity but ABSTAINS on the partners question.
        api.vote_batch(poll["id"], "Jordan", [
            {"question_index": 0, "vote_type": "ranked_choice", "ranked_choices": ["Thai", "Italian", "BBQ"]},
            {"question_index": 1, "vote_type": "yes_no", "is_abstain": True},
            {"question_index": 2, "vote_type": "ranked_choice", "ranked_choices": ["Escape Room", "Bowling", "Karaoke"]},
        ])

        api.close_poll(poll["id"])
        dinner = api.get_results(poll["id"], 0)
        partners = api.get_results(poll["id"], 1)
        activity = api.get_results(poll["id"], 2)

        result.record("dinner", dinner)
        result.record("partners", partners)
        result.record("activity", activity)
        result.assert_technical("Dinner winner is Thai", dinner["ranked_choice_winner"] == "Thai")
        result.assert_technical("Activity winner is Escape Room", activity["ranked_choice_winner"] == "Escape Room")
        result.assert_technical("Partners: 2 yes, 1 no, 1 abstain",
                                partners["yes_count"] == 2 and partners["no_count"] == 1 and partners["abstain_count"] == 1)
        result.mark_social(
            "FAIR",
            "A whole evening decided in one poll, one link, one Submit: Thai for "
            "dinner, Escape Room after, partners optional (2-1). Per-question "
            "abstain (Jordan skipped the partners question) keeps each decision "
            "honest without forcing an all-or-nothing ballot. This is the app's "
            "best answer to the 'so what's the plan??' group chat.",
        )

    def test_batch_is_atomic(self, api, result):
        """A batch with one bad item rolls back the whole submission.

        SCENARIO: A malformed client sends a batch where one item targets a
        question that belongs to a DIFFERENT poll.

        EXPECTATION: The entire batch is rejected (400) and NO partial vote
        lands on the valid question — submission is all-or-nothing.
        """
        poll_a = api.create_multi_poll(
            None,
            [{"poll_type": "yes_no", "context": "Q1?"}, {"poll_type": "yes_no", "context": "Q2?"}],
            creator_name="Organizer",
        )
        poll_b = api.create_poll("Other poll", "yes_no", creator_name="Organizer")
        foreign_qid = poll_b["questions"][0]["id"]

        # Batch: one valid item for poll_a's Q0, one item referencing poll_b's question.
        resp = api.vote_batch(poll_a["id"], "Tester", [
            {"question_index": 0, "vote_type": "yes_no", "yes_no_choice": "yes"},
            {"question_id": foreign_qid, "vote_type": "yes_no", "yes_no_choice": "yes"},
        ], expect=400)

        api.close_poll(poll_a["id"])
        q0_results = api.get_results(poll_a["id"], 0)

        result.record("status", resp.status_code)
        result.record("q0_results", q0_results)
        result.assert_technical("Cross-poll batch rejected (400)", resp.status_code == 400)
        result.assert_technical("No partial vote landed on the valid question",
                                q0_results["total_votes"] == 0)
        result.mark_social(
            "FAIR",
            "Atomic batch submission is the right guarantee for a multi-question "
            "poll: a voter never ends up half-recorded. Either the whole ballot "
            "lands or none of it does, so there's no 'I answered dinner but my "
            "activity vote vanished' confusion.",
        )
