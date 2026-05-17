"""Yes/no question scenarios — the most common interaction."""
import time

from .api_helper import Browser, yes_no_q
from .runner import Runner, assert_eq, assert_true, assert_in


def run(runner: Runner):
    _basic_majority(runner)
    _tied_split(runner)
    _abstain_only(runner)
    _single_voter(runner)
    _vote_change(runner)
    _abstain_then_yes(runner)
    _closed_poll_rejects_votes(runner)
    _reopen_resets_state(runner)
    _wrong_creator_secret_cannot_close(runner)
    _voter_name_with_emoji(runner)
    _long_voter_name(runner)
    _anonymous_voter_no_name(runner)


def _basic_majority(runner):
    with runner.case("yes_no: clear majority yes", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Pizza tonight?", creator_name="Marcus")
            qid = poll["questions"][0]["id"]
            for name, choice in [("A", "yes"), ("B", "yes"), ("C", "yes"), ("D", "no")]:
                with Browser(name) as v:
                    v.submit_votes(poll["id"], name, [
                        {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": choice}
                    ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_eq(res["winner"], "yes", "winner")
            assert_eq(res["yes_count"], 3, "yes_count")
            assert_eq(res["no_count"], 1, "no_count")


def _tied_split(runner):
    with runner.case("yes_no: exact tie", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Coffee break now?")
            qid = poll["questions"][0]["id"]
            for name, c in [("A", "yes"), ("B", "yes"), ("C", "no"), ("D", "no")]:
                with Browser(name) as v:
                    v.submit_votes(poll["id"], name, [
                        {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": c}
                    ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_eq(res["winner"], "tie", "tie expected")


def _abstain_only(runner):
    with runner.case("yes_no: all abstain → no winner (not 'tie')", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="All-abstain test?")
            qid = poll["questions"][0]["id"]
            for name in ["A", "B", "C"]:
                with Browser(name) as v:
                    v.submit_votes(poll["id"], name, [
                        {"question_id": qid, "vote_type": "yes_no", "is_abstain": True}
                    ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_true(res["winner"] is None,
                        f"winner should be None for all-abstain, got {res['winner']!r}")


def _single_voter(runner):
    with runner.case("yes_no: only creator votes", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Solo vote?")
            qid = poll["questions"][0]["id"]
            b.submit_votes(poll["id"], "Marcus", [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
            ])
            b.close_poll(poll["id"])
            res = b.get_question_results(qid)
            r.evid(results=res)
            assert_eq(res["winner"], "yes")


def _vote_change(runner):
    with runner.case("yes_no: voter can edit yes → no", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Vote edit test")
            qid = poll["questions"][0]["id"]
        with Browser("voter") as v:
            vote = v.submit_votes(poll["id"], "Alice", [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
            ])[0]
            edited = v.submit_votes(poll["id"], "Alice", [
                {"question_id": qid, "vote_id": vote["id"],
                 "vote_type": "yes_no", "yes_no_choice": "no"}
            ])
            r.evid(orig=vote, edited=edited)
            assert_eq(edited[0]["yes_no_choice"], "no")


def _abstain_then_yes(runner):
    with runner.case("yes_no: abstain → switch to yes", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Abstain switch")
            qid = poll["questions"][0]["id"]
        with Browser("voter") as v:
            vote = v.submit_votes(poll["id"], "Charlie", [
                {"question_id": qid, "vote_type": "yes_no", "is_abstain": True}
            ])[0]
            edited = v.submit_votes(poll["id"], "Charlie", [
                {"question_id": qid, "vote_id": vote["id"],
                 "vote_type": "yes_no", "yes_no_choice": "yes", "is_abstain": False}
            ])
            r.evid(edited=edited)
            assert_eq(edited[0]["yes_no_choice"], "yes")
            assert_eq(edited[0]["is_abstain"], False)


def _closed_poll_rejects_votes(runner):
    with runner.case("yes_no: closed poll rejects new votes", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Closing test")
            qid = poll["questions"][0]["id"]
            b.close_poll(poll["id"])
        with Browser("late_voter") as v:
            try:
                v.submit_votes(poll["id"], "LateBob", [
                    {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
                ])
                r.finding(category="auth/state", severity="MAJOR",
                          summary="Closed poll accepted a new vote",
                          detail="POST /api/polls/{id}/votes returned success on a closed poll")
                assert_true(False, "should have been rejected")
            except RuntimeError as e:
                assert_in("closed", str(e).lower(), "expected 'closed' in error")


def _reopen_resets_state(runner):
    with runner.case("yes_no: reopen → new vote accepted", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Reopen test")
            qid = poll["questions"][0]["id"]
            b.close_poll(poll["id"])
            b.reopen_poll(poll["id"])
            check = b.get_poll(poll["id"])
            assert_eq(check["is_closed"], False, "should be open")
        with Browser("v") as v:
            res = v.submit_votes(poll["id"], "Dana", [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
            ])
            r.evid(vote=res)
            assert_true(len(res) == 1)


def _wrong_creator_secret_cannot_close(runner):
    with runner.case("yes_no: wrong creator_secret cannot close", "auth") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Auth test")
        with Browser("attacker") as a:
            resp = a.client.post(f"/api/polls/{poll['id']}/close",
                                 json={"creator_secret": "wrong-key"},
                                 headers=a.headers)
            r.evid(status=resp.status_code, body=resp.text[:200])
            assert_true(resp.status_code >= 400,
                        f"should reject wrong secret, got {resp.status_code}")
        with Browser("creator") as b2:
            check = b2.get_poll(poll["id"])
            assert_eq(check["is_closed"], False, "should still be open")


def _voter_name_with_emoji(runner):
    with runner.case("yes_no: voter name with emoji + unicode", "edge") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Emoji vote?")
            qid = poll["questions"][0]["id"]
        with Browser("e") as v:
            res = v.submit_votes(poll["id"], "李明 🎉 José", [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
            ])
            r.evid(vote=res)
            assert_eq(res[0]["voter_name"], "李明 🎉 José")


def _long_voter_name(runner):
    with runner.case("yes_no: 1000-char voter name", "edge") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Long name")
            qid = poll["questions"][0]["id"]
        long_name = "A" * 1000
        with Browser("v") as v:
            try:
                res = v.submit_votes(poll["id"], long_name, [
                    {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
                ])
                r.evid(stored_len=len(res[0].get("voter_name") or ""))
                r.note(f"1000-char name was accepted, stored length={len(res[0].get('voter_name') or '')}")
                if len(res[0].get("voter_name") or "") == 1000:
                    r.finding(category="validation", severity="MINOR",
                              summary="No server-side limit on voter_name length",
                              detail="1000-character voter_name accepted unchanged. UI may not display gracefully.")
            except RuntimeError as e:
                r.note(f"Rejected: {e}")


def _anonymous_voter_no_name(runner):
    with runner.case("yes_no: anonymous voter (no name)", "yes_no") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Anon test")
            qid = poll["questions"][0]["id"]
        with Browser("anon") as v:
            res = v.submit_votes(poll["id"], None, [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
            ])
            r.evid(vote=res)
            assert_true(res[0].get("voter_name") in (None, ""),
                        f"expected null voter_name, got {res[0].get('voter_name')!r}")
