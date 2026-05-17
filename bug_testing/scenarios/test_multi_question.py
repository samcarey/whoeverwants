"""Multi-question poll scenarios — atomic vote submission across sibling questions."""

from .api_helper import Browser, yes_no_q, ranked_choice_q
from .runner import Runner, assert_eq, assert_true, assert_in


def run(runner: Runner):
    _all_yes_no_batch(runner)
    _mixed_yes_no_and_rc(runner)
    _partial_abstain(runner)
    _atomic_rollback_on_bad_item(runner)
    _same_kind_distinct_context(runner)
    _same_kind_same_context_rejected(runner)
    _question_belongs_to_poll_check(runner)


def _all_yes_no_batch(runner):
    with runner.case("multi: 3 yes_no in one poll, batch submit", "multi") as r:
        with Browser("creator") as b:
            poll = b.create_poll([
                yes_no_q(details="Tonight"),
                yes_no_q(details="Tomorrow"),
                yes_no_q(details="Saturday"),
            ], title="Movie night when?")
            qids = [q["id"] for q in poll["questions"]]
        with Browser("v") as v:
            res = v.submit_votes(poll["id"], "Alice", [
                {"question_id": qids[0], "vote_type": "yes_no", "yes_no_choice": "yes"},
                {"question_id": qids[1], "vote_type": "yes_no", "yes_no_choice": "no"},
                {"question_id": qids[2], "vote_type": "yes_no", "yes_no_choice": "yes"},
            ])
            r.evid(votes=res)
            assert_eq(len(res), 3)


def _mixed_yes_no_and_rc(runner):
    with runner.case("multi: yes_no + ranked_choice in one poll", "multi") as r:
        with Browser("creator") as b:
            poll = b.create_poll([
                yes_no_q(details="Come out?"),
                ranked_choice_q(["Pizza", "Tacos", "Sushi"], details="Food"),
            ], title="Dinner planning")
            qids = [q["id"] for q in poll["questions"]]
        with Browser("v") as v:
            res = v.submit_votes(poll["id"], "Bob", [
                {"question_id": qids[0], "vote_type": "yes_no", "yes_no_choice": "yes"},
                {"question_id": qids[1], "vote_type": "ranked_choice",
                 "ranked_choices": ["Pizza", "Tacos"]},
            ])
            r.evid(votes=res)
            assert_eq(len(res), 2)


def _partial_abstain(runner):
    with runner.case("multi: abstain on one question while voting on another", "multi") as r:
        with Browser("creator") as b:
            poll = b.create_poll([
                yes_no_q(details="A"),
                yes_no_q(details="B"),
            ], title="Partial abstain")
            qids = [q["id"] for q in poll["questions"]]
        with Browser("v") as v:
            res = v.submit_votes(poll["id"], "Carla", [
                {"question_id": qids[0], "vote_type": "yes_no", "is_abstain": True},
                {"question_id": qids[1], "vote_type": "yes_no", "yes_no_choice": "yes"},
            ])
            r.evid(votes=res)
            assert_eq(res[0]["is_abstain"], True)
            assert_eq(res[1]["is_abstain"], False)


def _atomic_rollback_on_bad_item(runner):
    with runner.case("multi: bad item rolls back all votes in batch", "multi") as r:
        with Browser("creator") as b:
            poll = b.create_poll([
                yes_no_q(details="X"),
                yes_no_q(details="Y"),
            ], title="Atomic test")
            qids = [q["id"] for q in poll["questions"]]
        with Browser("v") as v:
            # First item valid, second item references nonexistent question
            try:
                v.submit_votes(poll["id"], "Eric", [
                    {"question_id": qids[0], "vote_type": "yes_no", "yes_no_choice": "yes"},
                    {"question_id": "00000000-0000-0000-0000-000000000000",
                     "vote_type": "yes_no", "yes_no_choice": "no"},
                ])
                r.finding(category="atomicity", severity="MAJOR",
                          summary="Batch with nonexistent question_id was accepted",
                          detail="A bogus question_id should reject the entire batch.")
                assert_true(False, "should have been rejected")
            except RuntimeError as e:
                r.evid(error=str(e))
            # Verify no vote landed for qids[0]
            votes = v.get_question_votes(qids[0])
            r.evid(votes_on_qid0=votes)
            assert_true(len(votes) == 0,
                        f"transaction should have rolled back, found {len(votes)} votes")


def _same_kind_distinct_context(runner):
    with runner.case("multi: two yes_no with distinct details OK", "multi") as r:
        with Browser("creator") as b:
            poll = b.create_poll([
                yes_no_q(details="Movie A?"),
                yes_no_q(details="Movie B?"),
            ], title="Two yes/no")
            r.evid(poll=poll["id"])
            assert_eq(len(poll["questions"]), 2)


def _same_kind_same_context_rejected(runner):
    with runner.case("multi: two yes_no with identical details should reject", "validation") as r:
        with Browser("creator") as b:
            try:
                poll = b.create_poll([
                    yes_no_q(details="Movie?"),
                    yes_no_q(details="Movie?"),
                ], title="Dup context")
                r.evid(created=poll)
                r.finding(category="validation", severity="MAJOR",
                          summary="Two yes_no questions with identical context were accepted",
                          detail="Server should reject same-kind same-context per the poll paradigm.")
                assert_true(False, "should have been rejected")
            except RuntimeError as e:
                r.evid(error=str(e))


def _question_belongs_to_poll_check(runner):
    with runner.case("multi: vote on question from a different poll rejected", "validation") as r:
        with Browser("creator") as b:
            poll_a = b.create_poll([yes_no_q()], title="Poll A")
            poll_b = b.create_poll([yes_no_q()], title="Poll B")
            qid_b = poll_b["questions"][0]["id"]
        # Try to vote on poll_a's URL with poll_b's question_id
        with Browser("v") as v:
            try:
                v.submit_votes(poll_a["id"], "Eve", [
                    {"question_id": qid_b, "vote_type": "yes_no", "yes_no_choice": "yes"}
                ])
                r.finding(category="auth/cross-poll", severity="CRITICAL",
                          summary="Cross-poll vote ID injection accepted",
                          detail="Voting via poll A's endpoint succeeded with poll B's question_id. "
                                 "Could let a user vote on a question they shouldn't see.")
                assert_true(False, "should have been rejected")
            except RuntimeError as e:
                r.evid(error=str(e))
