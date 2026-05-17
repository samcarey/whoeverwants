"""Ranked-choice (IRV) scenarios — both pure and with suggestion phase."""
import time

from .api_helper import Browser, ranked_choice_q, suggestion_q
from .runner import Runner, assert_eq, assert_true, assert_in


def run(runner: Runner):
    _first_round_majority(runner)
    _irv_runoff(runner)
    _equal_rankings_count_for_each(runner)
    _partial_ballot(runner)
    _all_voters_abstain(runner)
    _identical_options_rejected(runner)
    _two_options_binary(runner)
    _suggestion_phase_collect_and_cutoff(runner)
    _suggestion_phase_no_suggestions_rejects_cutoff(runner)
    _pre_ranking_allowed(runner)


def _first_round_majority(runner):
    with runner.case("rc: first-round majority winner", "ranked_choice") as r:
        with Browser("creator") as b:
            poll = b.create_poll([ranked_choice_q(["Pizza", "Tacos", "Sushi"])],
                                 title="Dinner pick")
            qid = poll["questions"][0]["id"]
            for name, ranking in [("A", ["Pizza", "Tacos"]), ("B", ["Pizza", "Sushi"]),
                                  ("C", ["Pizza", "Tacos"]), ("D", ["Tacos", "Pizza"]),
                                  ("E", ["Sushi", "Pizza"])]:
                with Browser(name) as v:
                    v.submit_votes(poll["id"], name, [
                        {"question_id": qid, "vote_type": "ranked_choice",
                         "ranked_choices": ranking}
                    ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_eq(res.get("winner"), "Pizza", "winner should be Pizza")


def _irv_runoff(runner):
    with runner.case("rc: runoff to second round", "ranked_choice") as r:
        with Browser("creator") as b:
            poll = b.create_poll([ranked_choice_q(["A", "B", "C"])],
                                 title="Runoff test")
            qid = poll["questions"][0]["id"]
            ballots = [["A", "B"], ["A", "C"], ["B", "A"], ["C", "A"], ["C", "B"]]
            for i, ranking in enumerate(ballots):
                with Browser(f"v{i}") as v:
                    v.submit_votes(poll["id"], f"Voter{i}", [
                        {"question_id": qid, "vote_type": "ranked_choice",
                         "ranked_choices": ranking}
                    ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            rounds = res.get("ranked_choice_rounds") or []
            r.note(f"rounds={len(rounds)}")
            assert_true(len(rounds) >= 2, f"should have ≥2 rounds, got {len(rounds)}")


def _equal_rankings_count_for_each(runner):
    with runner.case("rc: equal-ranked tier gives 1 vote each", "ranked_choice") as r:
        with Browser("creator") as b:
            poll = b.create_poll([ranked_choice_q(["A", "B", "C"])],
                                 title="Equal-rank test")
            qid = poll["questions"][0]["id"]
            with Browser("v1") as v:
                v.submit_votes(poll["id"], "Voter1", [
                    {"question_id": qid, "vote_type": "ranked_choice",
                     "ranked_choices": ["A", "B", "C"],
                     "ranked_choice_tiers": [["A", "B"], ["C"]]}
                ])
            for nm in ["v2", "v3"]:
                with Browser(nm) as v:
                    v.submit_votes(poll["id"], nm, [
                        {"question_id": qid, "vote_type": "ranked_choice",
                         "ranked_choices": ["C", "A"]}
                    ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_true(res.get("winner") == "C",
                        f"C should win, got {res.get('winner')}")


def _partial_ballot(runner):
    with runner.case("rc: partial ballot is honored", "ranked_choice") as r:
        with Browser("creator") as b:
            poll = b.create_poll([ranked_choice_q(["A", "B", "C", "D"])],
                                 title="Partial ballot")
            qid = poll["questions"][0]["id"]
            with Browser("v1") as v:
                v.submit_votes(poll["id"], "Solo", [
                    {"question_id": qid, "vote_type": "ranked_choice",
                     "ranked_choices": ["A"]}
                ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_eq(res.get("winner"), "A")


def _all_voters_abstain(runner):
    with runner.case("rc: all-abstain returns null winner", "ranked_choice") as r:
        with Browser("creator") as b:
            poll = b.create_poll([ranked_choice_q(["X", "Y", "Z"])],
                                 title="All-abstain rc")
            qid = poll["questions"][0]["id"]
            for nm in ["a", "b", "c"]:
                with Browser(nm) as v:
                    v.submit_votes(poll["id"], nm, [
                        {"question_id": qid, "vote_type": "ranked_choice",
                         "is_abstain": True}
                    ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_true(res.get("winner") is None,
                        f"all-abstain → null winner, got {res.get('winner')!r}")


def _identical_options_rejected(runner):
    with runner.case("rc: identical options should reject", "validation") as r:
        with Browser("creator") as b:
            try:
                poll = b.create_poll([ranked_choice_q(["Same", "Same", "Different"])],
                                     title="Dup options")
                r.evid(created=poll)
                r.finding(category="validation", severity="MAJOR",
                          summary="Duplicate options accepted in ranked choice",
                          detail="POST /api/polls accepted ['Same','Same','Different']. "
                                 "Options should be uniquified server-side or rejected.")
                assert_true(False, "should have been rejected")
            except RuntimeError as e:
                r.evid(error=str(e))


def _two_options_binary(runner):
    with runner.case("rc: 2-option binary ranked choice", "ranked_choice") as r:
        with Browser("creator") as b:
            poll = b.create_poll([ranked_choice_q(["Alice", "Bob"])],
                                 title="Two-option")
            qid = poll["questions"][0]["id"]
            for nm, ranking in [("v1", ["Alice"]), ("v2", ["Alice"]), ("v3", ["Bob"])]:
                with Browser(nm) as v:
                    v.submit_votes(poll["id"], nm, [
                        {"question_id": qid, "vote_type": "ranked_choice",
                         "ranked_choices": ranking}
                    ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_eq(res.get("winner"), "Alice")


def _suggestion_phase_collect_and_cutoff(runner):
    with runner.case("rc-suggest: collect → cutoff → vote", "suggestion") as r:
        with Browser("creator") as b:
            poll = b.create_poll([suggestion_q(suggestion_deadline_minutes=60)],
                                 title="Suggest a place")
            qid = poll["questions"][0]["id"]
            for i, names in enumerate([["Pizza Joint", "Burger Place"],
                                        ["Pizza Joint", "Sushi Spot"],
                                        ["Burger Place", "Taco Town"]]):
                with Browser(f"s{i}") as v:
                    v.submit_votes(poll["id"], f"Voter{i}", [
                        {"question_id": qid, "vote_type": "ranked_choice",
                         "suggestions": names}
                    ])
            cutoff = b.cutoff_suggestions(poll["id"])
            r.evid(after_cutoff=cutoff)
            poll2 = b.get_poll(poll["id"])
            opts = poll2["questions"][0].get("options") or []
            r.evid(options=opts)
            assert_true(len(opts) > 0,
                        f"options should be populated after cutoff, got {opts!r}")
            assert_in("Pizza Joint", opts, "Pizza Joint should be in options")


def _suggestion_phase_no_suggestions_rejects_cutoff(runner):
    with runner.case("rc-suggest: cutoff with zero suggestions is rejected", "suggestion") as r:
        with Browser("creator") as b:
            poll = b.create_poll([suggestion_q(suggestion_deadline_minutes=60)],
                                 title="Empty suggest")
            try:
                b.cutoff_suggestions(poll["id"])
                r.finding(category="validation", severity="MINOR",
                          summary="Cutoff allowed with zero suggestions",
                          detail="Should return 400 — no advancement possible.")
                assert_true(False, "should reject")
            except RuntimeError as e:
                r.evid(error=str(e))


def _pre_ranking_allowed(runner):
    with runner.case("rc-suggest: pre-ranking writes work", "suggestion") as r:
        with Browser("creator") as b:
            poll = b.create_poll([suggestion_q(suggestion_deadline_minutes=60)],
                                 title="Pre-rank test")
            qid = poll["questions"][0]["id"]
            with Browser("v1") as v:
                v.submit_votes(poll["id"], "V1", [
                    {"question_id": qid, "vote_type": "ranked_choice",
                     "suggestions": ["Alpha", "Beta"],
                     "ranked_choices": ["Alpha", "Beta"]}
                ])
            b.cutoff_suggestions(poll["id"])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_eq(res.get("winner"), "Alpha")
