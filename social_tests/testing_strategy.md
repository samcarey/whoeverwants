# Social Testing Strategy for WhoeverWants

## Philosophy

WhoeverWants is a tool for *people* making *group decisions*. Technical
correctness is necessary but not sufficient — the app must also produce
results that feel **fair, intuitive, and socially appropriate** to the humans
using it.

This suite evaluates the app across two dimensions:

### 1. Technical Soundness
- Do vote counts add up? Are algorithmic guarantees (IRV majority, Borda
  tiebreak, time-poll availability filter) upheld?
- Do edge cases (ties, abstentions, empty polls, partial ballots) resolve
  without errors?
- Is integrity maintained across the create → vote → close → results
  lifecycle, including multi-question atomic submission and identity-based
  authorization?

### 2. Social Conventions
- When there's a clear group consensus, does the result reflect it?
- When preferences conflict, does the resolution feel fair to reasonable
  people?
- Does the system handle awkward dynamics gracefully (one person shows up,
  everyone abstains, the organizer loses, a name collision, a latecomer)?
- Would a person looking at these results feel the tool **helped or hindered**
  their group?

## What changed since the last report (May 2026 refresh)

The original suite was written against an API that has since shifted in three
load-bearing ways. **Every test in the old report now fails against the live
app.** The suite was rebuilt around the current contract:

1. **A name (or alias) is required to participate.** The app no longer offers
   a hidden ballot — `POST /api/polls` rejects a blank creator name and every
   vote rejects a blank voter name. "Anonymous" now means "no durable
   account," not "no visible identity." This is the single biggest social
   change and the source of the suite's sharpest findings.
2. **Authorship is identity-based.** The shareable `creator_secret` was
   retired; the creator is the account resolved from the request (a signed-in
   user, or a lightweight account auto-minted for an anonymous creator and
   bound to their device). Only that identity can close / reopen / cut off a
   poll.
3. **Groups, not chains.** `follow_up_to` and forks are gone. Related polls
   live in flat **groups** keyed by `group_id`. A poll can now also bundle
   several category ballots (a multi-question "plan the whole event" poll) that
   vote and close atomically.

## Test Categories

| File | Focus |
|------|-------|
| **Casual Decisions** | Yes/No + suggestion basics; the name-required model in low-stakes use |
| **Ranked Preferences** | IRV / Borda scenarios — consensus, Condorcet, spoiler, partial ballots, scale |
| **Edge Cases & Dynamics** | Vote editing, creator power, scale, identity-based authorization |
| **Multi-Stage Workflows** | Groups as the unit — diverge→converge, follow-up-after-tie, group-as-hub |
| **Event Planning** | Multi-question polls (the marquee real-life use), atomic batch submission |
| **Time Coordination** | Two-phase scheduling (availability → preferences), min-availability filter |
| **Suggestion Collaboration** | Brainstorm-then-rank in one poll: seed → collect → cut off → rank |
| **Identity & Naming** | The name-required gate, pseudonymity, collisions, viewers-vs-voters, late-joiner visibility |

## Voter Archetypes

- **The Organizer** — creates polls, tries to be fair, holds admin power
- **The Enthusiast** — votes quickly, strong preferences, uses their real name
- **The Lurker** — opens the poll (now *tracked*) but often doesn't vote
- **The Aliased Dissenter** — votes against the grain under a pseudonym
- **The Latecomer** — joins the group after some polls have already closed
- **The Flake** — suggests early, never comes back to rank

## Evaluation Criteria

| Badge | Meaning |
|-------|---------|
| `PASS` / `FAIL` | Technical assertion passed / failed |
| `FAIR` | Result is socially reasonable |
| `AWKWARD` | Technically correct but socially suboptimal — a UX hazard |
| `INSIGHT` | Reveals an interesting property or trade-off of the system |

---

## Key findings & recommendations

These are the social/usability themes that emerged from the refreshed suite,
ordered by impact. Each is grounded in a specific test (see the per-test
sections below).

### 1. The loss of a true hidden ballot is the biggest regression
*(test_identity_and_naming: test_vote_requires_name, test_alias_voting)*

The app's original promise was anonymous group decisions. Today every vote
carries a visible name/alias. For "pizza or sushi?" this is harmless; for
anything with a power imbalance (a complaint, a vote of no confidence, "should
we keep this vendor?") attaching a name suppresses honest dissent, and an
alias is a thin disguise in a small known group.
**Recommendation:** add an opt-in, per-poll **hidden-ballot mode** where the
server stores votes without a name (counts only). The infrastructure already
separates tallies from rosters, so this is mostly a creation-time flag plus a
roster-suppression rule — and it restores the original safety for exactly the
cases that need it.

### 2. Names aren't identities — collisions and aliases confuse the roster
*(test_identity_and_naming: test_name_collision_collapses_in_roster)*

Two different "Alex"es collapse to one chip in the participant roster, so the
group sees "3 voters" but only two names. In a real group this causes "wait,
did the other Alex vote?" confusion.
**Recommendation:** disambiguate duplicate names in the roster (e.g. "Alex
×2", or a subtle per-person marker) so the count and the roster agree.

### 3. Viewers-vs-voters is a powerful, under-surfaced signal
*(test_casual_decisions: test_single_voter; test_identity_and_naming: test_view_does_not_count_as_vote)*

The app already tracks who *opened* a poll separately from who *voted*. A
1-vote poll that 6 people saw is a very different social signal ("no
consensus") than one nobody saw ("no attention"). Right now a hollow 1-0 win
looks decisive.
**Recommendation:** surface "viewed by N, voted M" on the result, and let it
gently prompt the lurkers.

### 4. Late-joiner visibility has a sharp, silent edge
*(test_identity_and_naming: test_poll_closed_before_join_is_hidden)*

Hiding polls that closed *before* a member joined is a sensible default (don't
flood newcomers with decided history). But if you share a link to show someone
a result you just closed, they silently can't see it — the link looks broken.
**Recommendation:** when a shared link targets a poll the recipient can't see
(closed pre-join), show "this poll closed before you joined" rather than
omitting it.

### 5. Multi-question event polls are the strongest real-life feature — lean in
*(test_event_planning, test_multi_stage: test_group_as_ongoing_conversation)*

Planning a whole evening (dinner + activity + "bring partners?") in one
shareable poll, and a group reusing one group as their decision hub over weeks,
are the uses most likely to pull a circle off their chat thread. Atomic
submission and per-question abstain already work well.
**Recommendation:** invest in the group-as-hub experience — title/avatar,
"what's still open" at-a-glance, and new-poll notifications make the group feel
like a lightweight shared space rather than a series of one-off links.

### 6. Two-round scheduling risks drop-off; strict availability can dead-end
*(test_time_coordination)*

The two-phase time poll is a real when2meet replacement, but it asks the group
to engage *twice* (submit availability, then come back to mark preferences) —
many groups will only finish round one. Separately, a 100% availability
threshold can finalize to **zero** slots if no single time works for everyone.
**Recommendations:** (a) for small groups, auto-surface a decisive result
after availability if one slot already works for everyone; (b) when a strict
threshold yields no slots, fall back to the best-attended slot(s) with a "no
time worked for everyone — here's the closest" message instead of an empty
ballot.

### 7. Empty brainstorms and IRV surprises need gentle explanation
*(test_suggestion_collaboration: test_cutoff_requires_a_suggestion; test_ranked_preferences: test_condorcet_scenario)*

Cutting off a zero-suggestion brainstorm is correctly blocked, but the creator
is then stuck with no obvious next step. And IRV can eliminate a broadly-liked
compromise that had few first-place votes, producing a winner that feels wrong
to a group that wanted "the option everyone's okay with."
**Recommendations:** (a) surface "no suggestions yet — share the link or add
the first idea" on an empty brainstorm; (b) when IRV eliminates a strong
compromise, briefly explain *why* the winner won (the round-by-round view
exists; a one-line summary would help non-experts trust the result).

---

## Report mechanics

Each test produces a scenario description, technical assertions, and a social
evaluation. Reports are tracked over time: each run compares its critique to
the previous one and notes only meaningful changes — stability of assessment
is valued. Tests run against a live API (a per-branch dev server or the canary
tier); poll links in the report open the real polls.
