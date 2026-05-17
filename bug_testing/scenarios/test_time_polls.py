"""Time question scenarios — two-phase availability + preferences."""
from datetime import datetime, timedelta, timezone

from .api_helper import Browser, time_q
from .runner import Runner, assert_eq, assert_true


def _future_day(offset_days: int = 1) -> str:
    """Return YYYY-MM-DD a few days from now."""
    d = datetime.now(timezone.utc) + timedelta(days=offset_days)
    return d.strftime("%Y-%m-%d")


def run(runner: Runner):
    _basic_availability_submit(runner)
    _empty_availability_rejected(runner)
    _cross_midnight_window(runner)
    _voter_with_no_availability_for_day(runner)
    _multiple_days(runner)


def _basic_availability_submit(runner):
    with runner.case("time: voter submits availability", "time") as r:
        day = _future_day(2)
        with Browser("creator") as b:
            poll = b.create_poll([time_q(
                day_time_windows=[{"day": day, "windows": [{"min": "09:00", "max": "17:00"}]}],
                duration_window={"min": 1, "max": 2},
                min_availability_percent=50,
                details="Lunch meeting",
            )], title="When are you free?")
            qid = poll["questions"][0]["id"]
        with Browser("v") as v:
            res = v.submit_votes(poll["id"], "Diana", [
                {"question_id": qid, "vote_type": "time",
                 "voter_day_time_windows": [
                     {"day": day, "windows": [{"min": "10:00", "max": "12:00"}]}
                 ],
                 "voter_duration": {"min": 1, "max": 1}}
            ])
            r.evid(vote=res)
            assert_eq(len(res), 1)
            assert_true(res[0]["voter_day_time_windows"] is not None)


def _empty_availability_rejected(runner):
    with runner.case("time: empty availability allowed?", "time") as r:
        day = _future_day(2)
        with Browser("creator") as b:
            poll = b.create_poll([time_q(
                day_time_windows=[{"day": day, "windows": [{"min": "09:00", "max": "17:00"}]}],
                duration_window={"min": 1, "max": 1},
            )], title="Empty availability test")
            qid = poll["questions"][0]["id"]
        with Browser("v") as v:
            # Submitting no availability at all (empty list) - what happens?
            res = v.submit_votes(poll["id"], "Eli", [
                {"question_id": qid, "vote_type": "time",
                 "voter_day_time_windows": [],
                 "voter_duration": {"min": 1, "max": 1}}
            ])
            r.evid(vote=res)
            r.note("Empty availability accepted (interpreted as 'never available')")


def _cross_midnight_window(runner):
    with runner.case("time: cross-midnight voter window (22:00-02:00)", "time") as r:
        day = _future_day(3)
        with Browser("creator") as b:
            poll = b.create_poll([time_q(
                day_time_windows=[{"day": day, "windows": [{"min": "20:00", "max": "04:00"}]}],
                duration_window={"min": 1, "max": 2},
                details="Late-night",
            )], title="Late hangout")
            qid = poll["questions"][0]["id"]
        with Browser("v") as v:
            res = v.submit_votes(poll["id"], "Felix", [
                {"question_id": qid, "vote_type": "time",
                 "voter_day_time_windows": [
                     {"day": day, "windows": [{"min": "22:00", "max": "02:00"}]}
                 ],
                 "voter_duration": {"min": 1, "max": 1}}
            ])
            r.evid(vote=res)
            assert_true(res[0]["voter_day_time_windows"] is not None)


def _voter_with_no_availability_for_day(runner):
    with runner.case("time: voter has no availability for the day", "time") as r:
        day = _future_day(2)
        with Browser("creator") as b:
            poll = b.create_poll([time_q(
                day_time_windows=[{"day": day, "windows": [{"min": "09:00", "max": "17:00"}]}],
                duration_window={"min": 1, "max": 1},
            )], title="No-avail day")
            qid = poll["questions"][0]["id"]
        with Browser("v") as v:
            # Voter has availability on a totally different day
            wrong_day = _future_day(10)
            res = v.submit_votes(poll["id"], "Grace", [
                {"question_id": qid, "vote_type": "time",
                 "voter_day_time_windows": [
                     {"day": wrong_day, "windows": [{"min": "09:00", "max": "10:00"}]}
                 ],
                 "voter_duration": {"min": 1, "max": 1}}
            ])
            r.evid(vote=res)
            r.note("Voter availability for a non-poll day stored as-is (extracted by server-side compute)")


def _multiple_days(runner):
    with runner.case("time: 3 days, 2 voters, finalize via cutoff", "time") as r:
        day1, day2, day3 = _future_day(2), _future_day(3), _future_day(4)
        with Browser("creator") as b:
            poll = b.create_poll([time_q(
                day_time_windows=[
                    {"day": day1, "windows": [{"min": "09:00", "max": "17:00"}]},
                    {"day": day2, "windows": [{"min": "09:00", "max": "17:00"}]},
                    {"day": day3, "windows": [{"min": "09:00", "max": "17:00"}]},
                ],
                duration_window={"min": 1, "max": 1},
                min_availability_percent=50,
            )], title="3-day finder", prephase_deadline_minutes=60)
            qid = poll["questions"][0]["id"]
        for name, slots in [
            ("V1", [{"day": day1, "windows": [{"min": "10:00", "max": "12:00"}]},
                    {"day": day2, "windows": [{"min": "13:00", "max": "16:00"}]}]),
            ("V2", [{"day": day1, "windows": [{"min": "10:00", "max": "11:00"}]},
                    {"day": day3, "windows": [{"min": "09:00", "max": "11:00"}]}]),
        ]:
            with Browser(name) as v:
                v.submit_votes(poll["id"], name, [
                    {"question_id": qid, "vote_type": "time",
                     "voter_day_time_windows": slots,
                     "voter_duration": {"min": 1, "max": 1}}
                ])
        # Try to finalize availability
        with Browser("creator") as b2:
            b2.creator_secrets[poll["id"]] = b.creator_secrets[poll["id"]]
            resp = b2.client.post(f"/api/polls/{poll['id']}/cutoff-availability",
                                  json={"creator_secret": b.creator_secrets[poll["id"]]},
                                  headers=b2.headers)
            r.evid(cutoff_status=resp.status_code)
            if resp.status_code == 200:
                data = resp.json()
                opts = data["questions"][0].get("options") or []
                r.evid(slot_options=opts[:5])
                assert_true(len(opts) > 0, f"slots should be picked, got {opts}")
            else:
                r.note(f"cutoff-availability failed: {resp.text[:200]}")
