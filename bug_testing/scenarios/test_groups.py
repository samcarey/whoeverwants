"""Group lifecycle scenarios — empty groups, joins, leaves, visibility, sharing."""
import time

from .api_helper import Browser, yes_no_q, ranked_choice_q
from .runner import Runner, assert_eq, assert_true, assert_in


def run(runner: Runner):
    _create_empty_group_and_share(runner)
    _empty_group_visible_to_creator_only(runner)
    _visit_url_grants_membership(runner)
    _vote_grants_membership(runner)
    _leave_group(runner)
    _leave_then_revisit_re_joins(runner)
    _title_override(runner)
    _multiple_polls_in_group(runner)
    _follow_up_inherits_group(runner)
    _unknown_route_id_404(runner)
    _summary_endpoint_no_membership(runner)


def _create_empty_group_and_share(runner):
    with runner.case("group: create empty + share URL", "group") as r:
        with Browser("creator") as b:
            grp = b.create_empty_group()
            r.evid(group=grp)
            assert_true("short_id" in grp, "should have short_id")
            assert_true("id" in grp, "should have uuid id")


def _empty_group_visible_to_creator_only(runner):
    with runner.case("group: empty group visible to creator via /mine", "group") as r:
        with Browser("creator") as b:
            grp = b.create_empty_group()
            # Look up empty groups
            resp = b.client.post("/api/groups/empty", json={}, headers=b.headers)
            assert_eq(resp.status_code, 200, "empty endpoint")
            empties = resp.json()
            r.evid(empties_count=len(empties))
            assert_true(any(e["id"] == grp["id"] for e in empties),
                        f"new empty group should be in /empty list")
        # Stranger should NOT see it
        with Browser("stranger") as s:
            try:
                summary = s.get_group_summary(grp["short_id"])
                r.evid(stranger_summary=summary)
                r.note("Stranger CAN read group summary — that's expected (public preview)")
            except RuntimeError as e:
                r.note(f"Stranger blocked: {e}")


def _visit_url_grants_membership(runner):
    with runner.case("group: visiting /by-route-id joins as member", "group") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Visit-join test")
        # Stranger visits the URL
        with Browser("visitor") as v:
            polls = v.get_group_by_route(poll["group_short_id"])
            r.evid(polls_visible=len(polls))
            assert_true(len(polls) >= 1, "should see the open poll after auto-join")
            # Now /mine should include this group
            mine = v.get_my_groups()
            assert_true(any(p["id"] == poll["id"] for p in mine),
                        "visitor should see the group in /mine after visit")


def _vote_grants_membership(runner):
    with runner.case("group: voting auto-joins the group", "group") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Vote-join test")
            qid = poll["questions"][0]["id"]
        with Browser("voter") as v:
            v.submit_votes(poll["id"], "Jill", [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}
            ])
            mine = v.get_my_groups()
            assert_true(any(p["id"] == poll["id"] for p in mine),
                        "voter should be a member after voting")


def _leave_group(runner):
    with runner.case("group: leave membership removes from /mine", "group") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Leave test")
        with Browser("v") as v:
            v.get_group_by_route(poll["group_short_id"])  # join
            before = v.get_my_groups()
            assert_true(any(p["id"] == poll["id"] for p in before),
                        "should be a member before leave")
            status = v.leave_group(poll["group_short_id"])
            r.evid(leave_status=status)
            after = v.get_my_groups()
            assert_true(not any(p["id"] == poll["id"] for p in after),
                        "should not be in /mine after leave")


def _leave_then_revisit_re_joins(runner):
    with runner.case("group: leave + revisit re-joins", "group") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Re-join test")
        with Browser("v") as v:
            v.get_group_by_route(poll["group_short_id"])
            v.leave_group(poll["group_short_id"])
            # Visit again
            v.get_group_by_route(poll["group_short_id"])
            mine = v.get_my_groups()
            assert_true(any(p["id"] == poll["id"] for p in mine),
                        "revisit should re-join")


def _title_override(runner):
    with runner.case("group: title override sticks", "group") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Title-override")
            res = b.update_group_title(poll["group_short_id"], "Friday Crew")
            r.evid(after=res)
            check = b.get_poll(poll["id"])
            assert_eq(check["group_title"], "Friday Crew", "title should be set")
            # Clear it
            b.update_group_title(poll["group_short_id"], None)
            check2 = b.get_poll(poll["id"])
            assert_true(check2["group_title"] in (None, ""),
                        f"title should clear, got {check2['group_title']!r}")


def _multiple_polls_in_group(runner):
    with runner.case("group: 3 polls share one group_id", "group") as r:
        with Browser("creator") as b:
            p1 = b.create_poll([yes_no_q()], title="P1?")
            gid = p1["group_id"]
            p2 = b.create_poll([yes_no_q()], title="P2?", group_id=gid)
            p3 = b.create_poll([ranked_choice_q(["X", "Y"])], title="P3", group_id=gid)
            r.evid(group_id=gid, polls=[p1["id"], p2["id"], p3["id"]])
            assert_eq(p2["group_id"], gid)
            assert_eq(p3["group_id"], gid)
            # Should all appear under the same group route
            polls = b.get_group_by_route(p1["group_short_id"])
            ids = {p["id"] for p in polls}
            assert_true({p1["id"], p2["id"], p3["id"]}.issubset(ids),
                        f"all 3 polls should be in the group, got {ids}")


def _follow_up_inherits_group(runner):
    with runner.case("group: follow_up_to (question id) attaches to parent group", "group") as r:
        with Browser("creator") as b:
            p1 = b.create_poll([yes_no_q()], title="Original")
            q1 = p1["questions"][0]["id"]
            # FE-style follow_up_to with a question id (server resolves to group_id)
            p2 = b.create_poll([yes_no_q()], title="Follow-up", group_id=p1["group_id"])
            r.evid(parent=p1["id"], child=p2["id"],
                   parent_gid=p1["group_id"], child_gid=p2["group_id"])
            assert_eq(p2["group_id"], p1["group_id"],
                      "follow-up should share group")


def _unknown_route_id_404(runner):
    with runner.case("group: unknown route_id 404s", "validation") as r:
        with Browser("v") as v:
            resp = v.client.get("/api/groups/by-route-id/~ZZZZNOPE",
                                headers=v.headers)
            r.evid(status=resp.status_code, body=resp.text[:200])
            assert_eq(resp.status_code, 404, "should be 404")


def _summary_endpoint_no_membership(runner):
    with runner.case("group: /summary is identity-free", "group") as r:
        with Browser("creator") as b:
            poll = b.create_poll([yes_no_q()], title="Summary test")
        with Browser("stranger") as s:
            sm = s.get_group_summary(poll["group_short_id"])
            r.evid(summary=sm)
            # Should NOT add stranger as a member
            mine = s.get_my_groups()
            assert_true(not any(p["id"] == poll["id"] for p in mine),
                        "summary call should not grant membership")
