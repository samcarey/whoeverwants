"""Authentication / validation security scenarios."""
import os
from .api_helper import Browser, yes_no_q
from .runner import Runner, assert_eq, assert_true, assert_in


def run(runner: Runner):
    _missing_browser_id_create_poll(runner)
    _missing_browser_id_vote(runner)
    _empty_questions_array(runner)
    _missing_creator_secret(runner)
    _close_unknown_poll(runner)
    _huge_title(runner)
    _bad_question_type(runner)
    _malformed_uuid(runner)
    _missing_question_id_in_item(runner)
    _accessible_question_ids_garbage(runner)


def _missing_browser_id_create_poll(runner):
    with runner.case("security: create poll without X-Browser-Id", "security") as r:
        with Browser("creator") as b:
            payload = {
                "creator_secret": "no-bid-test",
                "questions": [yes_no_q()],
                "title": "No BID poll",
            }
            resp = b.client.post("/api/polls", json=payload,
                                 headers={"Content-Type": "application/json"})
            r.evid(status=resp.status_code, body=resp.text[:300])
            # Middleware should mint one; should still succeed
            assert_in(resp.status_code, [201, 400, 422],
                      f"unexpected status {resp.status_code}")


def _missing_browser_id_vote(runner):
    with runner.case("security: vote without X-Browser-Id", "security") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="BID-vote test")
            qid = poll["questions"][0]["id"]
        # Vote with no headers at all
        import httpx
        with httpx.Client(base_url=os.environ.get("API_BASE", "https://api.latest.whoeverwants.com")) as c:
            resp = c.post(f"/api/polls/{poll['id']}/votes",
                          json={"voter_name": "noBid",
                                "items": [{"question_id": qid,
                                           "vote_type": "yes_no", "yes_no_choice": "yes"}]})
            r.evid(status=resp.status_code, body=resp.text[:300])
            assert_in(resp.status_code, [201, 400, 422],
                      f"unexpected status {resp.status_code}")


def _empty_questions_array(runner):
    with runner.case("security: create poll with no questions", "validation") as r:
        with Browser("creator") as b:
            try:
                resp = b.client.post("/api/polls",
                                     json={"creator_secret": "empty-test",
                                           "questions": []},
                                     headers=b.headers)
                r.evid(status=resp.status_code, body=resp.text[:300])
                assert_true(resp.status_code >= 400,
                            f"empty questions should fail, got {resp.status_code}")
            except Exception as e:
                r.evid(error=str(e))


def _missing_creator_secret(runner):
    with runner.case("security: create poll without creator_secret", "validation") as r:
        with Browser("creator") as b:
            resp = b.client.post("/api/polls",
                                 json={"questions": [yes_no_q()],
                                       "title": "No secret"},
                                 headers=b.headers)
            r.evid(status=resp.status_code, body=resp.text[:300])
            assert_true(resp.status_code >= 400,
                        f"missing creator_secret should fail, got {resp.status_code}")


def _close_unknown_poll(runner):
    with runner.case("security: close nonexistent poll → 404", "validation") as r:
        with Browser("creator") as b:
            resp = b.client.post(
                "/api/polls/00000000-0000-0000-0000-000000000000/close",
                json={"creator_secret": "x"},
                headers=b.headers)
            r.evid(status=resp.status_code)
            assert_eq(resp.status_code, 404)


def _huge_title(runner):
    with runner.case("security: huge title (50KB)", "edge") as r:
        with Browser("creator") as b:
            big = "x" * 50_000
            try:
                poll = b.create_poll([yes_no_q()], title=big)
                stored_len = len(poll.get("title") or "")
                r.evid(stored_title_len=stored_len)
                r.note(f"50KB title accepted, stored length={stored_len}")
                if stored_len == 50_000:
                    r.finding(category="validation", severity="MINOR",
                              summary="No server-side title length limit",
                              detail="A 50KB title was accepted and stored unchanged. "
                                     "May cause UI overflow / DB bloat. Consider a 500-char limit.")
            except RuntimeError as e:
                r.evid(error=str(e))


def _bad_question_type(runner):
    with runner.case("security: bad question_type", "validation") as r:
        with Browser("creator") as b:
            resp = b.client.post(
                "/api/polls",
                json={"creator_secret": "bqtype",
                      "questions": [{"question_type": "telepathy",
                                     "category": "custom"}]},
                headers=b.headers)
            r.evid(status=resp.status_code, body=resp.text[:300])
            assert_true(resp.status_code >= 400,
                        f"bad type should fail, got {resp.status_code}")


def _malformed_uuid(runner):
    with runner.case("security: malformed UUID lookup", "validation") as r:
        with Browser("v") as v:
            resp = v.client.get("/api/polls/by-id/NOT-A-UUID", headers=v.headers)
            r.evid(status=resp.status_code, body=resp.text[:300])
            assert_true(resp.status_code in (400, 404, 422),
                        f"unexpected status {resp.status_code}")


def _missing_question_id_in_item(runner):
    with runner.case("security: vote item without question_id", "validation") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="QID-missing")
        with Browser("v") as v:
            resp = v.client.post(f"/api/polls/{poll['id']}/votes",
                                 json={"items": [{"vote_type": "yes_no",
                                                  "yes_no_choice": "yes"}]},
                                 headers=v.headers)
            r.evid(status=resp.status_code, body=resp.text[:300])
            assert_true(resp.status_code >= 400,
                        f"missing qid should fail, got {resp.status_code}")


def _accessible_question_ids_garbage(runner):
    with runner.case("security: /groups/mine with non-UUID accessible_question_ids", "validation") as r:
        with Browser("v") as v:
            resp = v.client.post("/api/groups/mine",
                                 json={"accessible_question_ids":
                                       ["not-a-uuid", "12345", "broken-id-xxx"]},
                                 headers=v.headers)
            r.evid(status=resp.status_code, body=resp.text[:300])
            # CLAUDE.md says this is now filtered server-side; should return 200 with empty/legitimate list
            assert_eq(resp.status_code, 200,
                      f"garbage IDs should be filtered, got {resp.status_code}")
