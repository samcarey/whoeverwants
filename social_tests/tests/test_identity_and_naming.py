"""Identity & Naming — the social consequences of the name-required model.

The single biggest shift since the original suite: the app no longer offers a
hidden ballot. Creating a poll or casting a vote requires a *name or alias*
(1-50 chars) that the rest of the group sees. "Anonymous" now means "no
durable account," not "no visible identity." These tests document the new
contract and the social dynamics it creates.
"""


class TestNameRequiredGate:
    """The server enforces a name on creation and on every vote."""

    def test_create_requires_name(self, api, result):
        """Creating a poll with no name is rejected.

        SCENARIO: A user tries to spin up a poll without identifying themselves.

        EXPECTATION: 400 — the creator must supply a name/alias. The FE surfaces
        this as an account-setup modal before the poll is ever created.
        """
        # create_poll defaults a name; hit the endpoint directly with a blank one.
        resp = api.organizer._request(
            "POST", "/api/polls", None, "create",
            json={"creator_name": "  ", "title": "x",
                  "questions": [{"question_type": "yes_no", "category": "yes_no"}]},
        )
        result.record("status", resp.status_code)
        result.assert_technical("Blank creator name rejected (400)", resp.status_code == 400)
        result.mark_social(
            "INSIGHT",
            "Requiring a creator name is reasonable (someone owns the poll), and "
            "it can be an alias. The cost is that the app's old 'no sign-up, "
            "fully anonymous' promise is softer now — you still need no account, "
            "but you can't be invisible.",
        )

    def test_vote_requires_name(self, api, result):
        """Voting with no name is rejected — no hidden ballot.

        SCENARIO: On a sensitive question ('Should we file a complaint?'), a
        voter wants to weigh in without anyone — including the creator — seeing
        who they are.

        EXPECTATION: The server rejects a nameless vote (400). True anonymous
        voting is not supported; the voter must attach a name or alias.
        """
        poll = api.create_poll("Should we file a complaint?", "yes_no", creator_name="Rep")
        resp = api.vote_anonymous(poll["id"], vote_type="yes_no", yes_no_choice="yes")

        result.record("status", resp.status_code)
        result.assert_technical("Nameless vote rejected (400)", resp.status_code == 400)
        result.mark_social(
            "AWKWARD",
            "This is the sharpest regression from the original design. For "
            "low-stakes 'pizza or sushi?' it's fine. For genuinely sensitive "
            "group decisions (complaints, votes-of-no-confidence, anything with "
            "a power imbalance) the lack of a true hidden ballot can suppress "
            "honest dissent — people self-censor when their name is attached. "
            "RECOMMENDATION: consider an opt-in per-poll 'hidden ballot' mode "
            "where the server stores votes without a name (counts only). The "
            "infrastructure already separates counts from rosters; this would "
            "restore the original safety for the cases that need it most.",
        )


class TestPseudonymity:
    """Aliases work, but they have limits."""

    def test_alias_voting(self, api, result):
        """A dissenter votes under an alias instead of their real name.

        SCENARIO: On a workplace question, 'Anonymous Coworker' (an alias) votes
        no while named colleagues vote yes.

        EXPECTATION: The alias is accepted and shown verbatim. Pseudonymity is
        the only privacy on offer.
        """
        poll = api.create_poll("Switch to a 4-day work week?", "yes_no", creator_name="HR")
        for name in ["Dana", "Priya", "Marco"]:
            api.vote(poll["id"], name, vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "Anonymous Coworker", vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"])
        votes = api.get_votes(poll["id"])
        names = sorted(v["voter_name"] for v in votes)

        result.record("voter_names", names)
        result.assert_technical("Alias accepted verbatim", "Anonymous Coworker" in names)
        result.assert_technical("4 votes recorded", len(votes) == 4)
        result.mark_social(
            "INSIGHT",
            "An alias is a fig leaf, not a curtain. In a small known group, "
            "'Anonymous Coworker' is the obvious odd-one-out — everyone can "
            "guess who isn't Dana/Priya/Marco. Pseudonymity protects against "
            "casual scanning, not against deduction in a bounded group.",
        )

    def test_name_collision_collapses_in_roster(self, api, result):
        """Two different people both vote as 'Alex'.

        SCENARIO: Two genuinely different people happen to use the same name.
        One votes yes, the other no.

        EXPECTATION: Both votes count (2 total), but the participant roster
        (distinct names) shows a single 'Alex' — the two are indistinguishable.
        """
        poll = api.create_poll("Onsite or remote?", "yes_no", creator_name="Lead")
        api.vote(poll["id"], "Alex", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "Alex", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], "Sam", vote_type="yes_no", yes_no_choice="yes")

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        poll_full = api.get_poll(poll["id"])

        result.record("results", results)
        result.record("roster", poll_full.get("voter_names"))
        result.assert_technical("All 3 votes counted", results["total_votes"] == 3)
        result.assert_technical("Roster dedupes the two Alexes",
                                poll_full.get("voter_names", []).count("Alex") == 1)
        result.mark_social(
            "AWKWARD",
            "Names aren't identities. Two 'Alex'es collapse to one chip in the "
            "roster, so the group can't tell both Alexes participated — the "
            "count says 3 voters but the roster lists 2 names. In a real group "
            "this causes 'wait, did the other Alex vote?' confusion. A subtle "
            "de-dupe indicator (e.g. 'Alex ×2') or a per-vote distinguisher "
            "would help.",
        )


class TestViewerVsVoter:
    """Opening a poll is tracked separately from voting on it."""

    def test_view_does_not_count_as_vote(self, api, result):
        """A person opens the poll but doesn't vote.

        SCENARIO: Several people open the poll (recorded via the 'viewed'
        watermark) but only some vote. The app distinguishes 'saw it' from
        'voted'.

        EXPECTATION: Viewing is a no-op on the tally. The creator can later see
        engagement ('N viewed, M voted') — useful signal for low-turnout polls.
        """
        poll = api.create_poll("Quarterly all-hands time?", "yes_no", creator_name="Chief")
        api.vote(poll["id"], "Pat", vote_type="yes_no", yes_no_choice="yes")

        # Two lurkers open the poll without voting.
        for name in ["Lurker One", "Lurker Two"]:
            person = api.person(name)
            person.view_poll(poll["id"])

        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Only 1 vote counted despite 2 extra viewers",
                                results["total_votes"] == 1)
        result.mark_social(
            "INSIGHT",
            "Separating viewers from voters is a quietly powerful feature. A "
            "1-vote poll that 6 people OPENED is a very different social signal "
            "than a 1-vote poll nobody saw. Surfacing 'viewed by N' next to the "
            "result would let organizers distinguish 'no consensus' from 'no "
            "attention' — and gently prompt the lurkers.",
        )


class TestLateJoinerVisibility:
    """Group membership has a join-time watermark: polls closed BEFORE you
    joined are hidden from you."""

    def test_poll_closed_before_join_is_hidden(self, api, result):
        """A friend joins the group after the first decision was already closed.

        SCENARIO: The organizer runs a dinner poll, closes it, then opens a
        movie poll. They share the group link. A friend who taps it now becomes
        a member as of *now* — and can see the (still-open) movie poll but NOT
        the (already-closed) dinner poll.

        EXPECTATION: The late joiner sees the open poll but not the
        closed-before-they-joined one. The organizer sees both.
        """
        dinner = api.create_poll("Dinner spot?", "yes_no", creator_name="Host")
        api.vote(dinner["id"], "Host", vote_type="yes_no", yes_no_choice="yes")
        api.close_poll(dinner["id"])

        movie = api.create_poll("Movie after?", "yes_no", creator_name="Host", group_id=dinner["group_id"])
        api.vote(movie["id"], "Host", vote_type="yes_no", yes_no_choice="yes")

        route = dinner["group_short_id"]
        organizer_view = {p["id"] for p in api.get_group(route)}

        latecomer = api.person("Latecomer")
        latecomer_view = {p["id"] for p in latecomer.get_group(route)}

        result.record("organizer_sees", sorted(organizer_view))
        result.record("latecomer_sees", sorted(latecomer_view))
        result.assert_technical("Organizer sees both polls",
                                {dinner["id"], movie["id"]} <= organizer_view)
        result.assert_technical("Latecomer sees the open movie poll", movie["id"] in latecomer_view)
        result.assert_technical("Latecomer does NOT see the closed dinner poll",
                                dinner["id"] not in latecomer_view)
        result.mark_social(
            "INSIGHT",
            "The closed-before-join filter prevents a new member from being "
            "flooded with old, decided polls — sensible default. But it has a "
            "sharp edge: if you share the group link to show someone a result "
            "you JUST closed, they can't see it. RECOMMENDATION: when a shared "
            "link targets a specific poll the recipient can't see (closed "
            "pre-join), show a 'this poll closed before you joined' note rather "
            "than silently omitting it — otherwise the sharer thinks the link "
            "is broken.",
        )
