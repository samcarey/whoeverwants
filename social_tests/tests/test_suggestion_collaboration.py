"""Suggestion Collaboration — brainstorm and decide inside ONE poll.

A ranked-choice question can open in a *suggestion-collection* phase: the
creator can seed a few starter options, voters add their own, and at the
cutoff the poll converts in-place into a ranked-choice ballot over everything
collected. This is the single-poll version of the diverge→converge workflow —
no second poll, one shareable link.
"""


class TestCollaborativeShortlist:
    """Seed → collect → cut off → rank, all in one poll."""

    def test_seed_add_cutoff_rank(self, api, result):
        """The creator seeds two options; the group adds more, then ranks.

        SCENARIO: Sam starts a "where for dinner?" suggestion poll pre-seeded
        with Pho House and Taqueria. Friends add their own ideas (one repeats
        Pho House, showing momentum; one adds a brand-new Ramen Bar). Sam cuts
        off suggestions, which opens ranking over the full collected list.
        Everyone ranks; IRV picks the winner.

        EXPECTATION: seeds appear as the creator's suggestions; the cutoff
        ballot is the union of all suggestions; ranking yields a winner.
        """
        poll = api.create_poll(
            "Where for dinner?", "ranked_choice", creator_name="Sam",
            prephase_deadline_minutes=120, suggestion_deadline_minutes=120,
            initial_suggestions=["Pho House", "Taqueria"],
        )
        result.assert_technical("Suggestion phase (options null at create)",
                                poll["questions"][0].get("options") is None)

        seeded = api.get_results(poll["id"])
        seeded_map = {s["option"]: s["count"] for s in seeded.get("suggestion_counts") or []}
        result.record("seeded_suggestions", seeded_map)
        result.assert_technical("Creator seeds present", {"Pho House", "Taqueria"} <= set(seeded_map))

        api.vote(poll["id"], "Ana", vote_type="ranked_choice", suggestions=["Pho House"], is_ranking_abstain=True)
        api.vote(poll["id"], "Ben", vote_type="ranked_choice", suggestions=["Ramen Bar", "Pho House"], is_ranking_abstain=True)
        api.vote(poll["id"], "Cas", vote_type="ranked_choice", suggestions=["Taqueria"], is_ranking_abstain=True)

        api.cutoff_suggestions(poll["id"])
        ballot = api.get_poll(poll["id"])["questions"][0]["options"]
        result.record("ballot_options", ballot)
        result.assert_technical("Ballot is the union of suggestions",
                                set(ballot) == {"Pho House", "Taqueria", "Ramen Bar"})

        # Ranking phase: the group ranks the collected shortlist.
        api.vote(poll["id"], "Ana", vote_type="ranked_choice", ranked_choices=["Pho House", "Ramen Bar", "Taqueria"])
        api.vote(poll["id"], "Ben", vote_type="ranked_choice", ranked_choices=["Ramen Bar", "Pho House", "Taqueria"])
        api.vote(poll["id"], "Cas", vote_type="ranked_choice", ranked_choices=["Pho House", "Taqueria", "Ramen Bar"])
        api.vote(poll["id"], "Sam", vote_type="ranked_choice", ranked_choices=["Pho House", "Taqueria", "Ramen Bar"])

        api.close_poll(poll["id"])
        res = api.get_results(poll["id"])
        result.record("winner", res.get("ranked_choice_winner"))
        result.assert_technical("Ranking produced a winner", res.get("ranked_choice_winner") is not None)
        result.mark_social(
            "FAIR",
            "Brainstorm-then-rank in a single poll is the app's strongest "
            "decision primitive — it captures the real arc of a group choosing "
            "a restaurant (throw out ideas, then narrow). Seeding lets the "
            "organizer prime the pump without dominating; the seeds compete on "
            "equal footing. The one social hazard: people who suggested early "
            "but never came back to rank are silently absent from the final "
            "decision — a nudge ('the ballot is ready, rank now') matters here.",
        )

    def test_cutoff_requires_a_suggestion(self, api, result):
        """You can't cut off an empty brainstorm.

        SCENARIO: A creator opens a suggestion poll, nobody (not even them)
        suggests anything, and they try to cut off straight to ranking.

        EXPECTATION: 400 — there's nothing to rank. The guard prevents an empty
        ballot.
        """
        poll = api.create_poll(
            "Ideas for the team name?", "ranked_choice", creator_name="Lead",
            prephase_deadline_minutes=120, suggestion_deadline_minutes=120,
        )
        resp = api.cutoff_suggestions(poll["id"], expect=400)

        result.record("status", resp.status_code)
        result.assert_technical("Empty-brainstorm cutoff rejected (400)", resp.status_code == 400)
        result.mark_social(
            "INSIGHT",
            "Guarding against a zero-suggestion cutoff is correct — an empty "
            "ranking ballot is meaningless. But the creator can still be stuck: "
            "if nobody suggests anything before the deadline, what happens? "
            "RECOMMENDATION: surface 'no suggestions yet — share the link or "
            "add the first idea yourself' so a quiet brainstorm has an obvious "
            "next step rather than a dead end.",
        )
