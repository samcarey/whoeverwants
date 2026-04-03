# Social Test Report — 2026-04-03 20:09 UTC

<details>
<summary><strong>Testing Philosophy & Strategy</strong></summary>

# Social Testing Strategy for WhoeverWants

## Philosophy

WhoeverWants is a tool for *people* making *group decisions*. Technical correctness is necessary but not sufficient — the app must also produce results that feel **fair, intuitive, and socially appropriate** to the humans using it.

This test suite evaluates the application across two dimensions:

### 1. Technical Soundness
- Do vote counts add up correctly?
- Are algorithmic guarantees (IRV majority, participation priority) upheld?
- Do edge cases (ties, abstentions, empty polls) resolve without errors?
- Is data integrity maintained across create → vote → close → results lifecycle?

### 2. Social Conventions
- When there's a clear group consensus, does the result reflect it?
- When preferences conflict, does the resolution feel fair to reasonable people?
- Do anonymous voters and named voters have equal influence?
- Does the system handle awkward social dynamics gracefully (e.g., only one person shows up, everyone abstains, the organizer's suggestion loses)?
- Would a person looking at these results feel the tool helped or hindered their group?

## Methodology

Each test simulates a **realistic social scenario** with a cast of characters making decisions together. Tests are written as stories: who are these people, what are they deciding, and what do they each want?

### Test Categories

| Category | Focus | Poll Types |
|----------|-------|------------|
| **Casual Decisions** | Friend groups making low-stakes choices | yes/no, suggestion |
| **Ranked Preferences** | Groups with diverse, ordered preferences | ranked_choice |
| **Event Planning** | Scheduling with availability constraints | participation |
| **Edge Cases & Dynamics** | Adversarial inputs, social pressure, anonymity | all types |
| **Multi-Stage Workflows** | Suggestion → preference pipelines, follow-ups | suggestion + ranked_choice |

### Voter Archetypes

Tests use recurring voter archetypes to model real group dynamics:

- **The Organizer** — Creates polls, has opinions but tries to be fair
- **The Enthusiast** — Votes quickly, has strong preferences, uses their name
- **The Lurker** — Votes anonymously, minimal engagement
- **The Contrarian** — Often disagrees with the majority
- **The Peacemaker** — Votes to maximize group harmony (middle options, abstains on controversy)
- **The Late Joiner** — Votes last, sometimes after seeing partial results
- **The Flake** — RSVPs yes then doesn't follow through (for participation polls)

### Evaluation Criteria

Each test produces a result evaluated on:

| Badge | Meaning |
|-------|---------|
| `PASS` | Technical assertion passed |
| `FAIL` | Technical assertion failed |
| `FAIR` | Result is socially reasonable |
| `AWKWARD` | Result is technically correct but socially suboptimal |
| `INSIGHT` | Test reveals an interesting property of the system |

### Report Format

The generated report includes:
1. This strategy document (collapsible)
2. Per-test sections with scenario description, technical results, and social critique
3. Badges summarizing each dimension at a glance
4. An AI-generated critique considering fairness, clarity, and user experience

### Iterative Refinement

Reports are tracked over time. Each iteration:
1. Runs all tests against the current API
2. Compares critique to previous iteration
3. Notes improvements, regressions, and persistent issues
4. Updates the critique only where warranted — stability in assessment is valued


</details>

## Summary

| Metric | Count |
|--------|-------|
| Total tests | 33 |
| <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> Technical pass | 31 |
| <span style="background:#dc3545;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIL</span> Technical fail | 2 |
| <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> Socially fair | 23 |
| <span style="background:#f0883e;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">AWKWARD</span> Socially awkward | 2 |
| <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> Insights | 8 |

## Tests.Casual Decisions

<details id="test_clear_majority_yes">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_clear_majority_yes</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/bf536fe2-4950-49f1-a9ac-52a06dda0622/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Friday drinks: 4 yes, 1 no, 1 abstain.**

**SCENARIO:** Marcus creates a poll asking "Drinks after work Friday?"
Four coworkers say yes (two named, two anonymous). One says no
(anonymous — maybe they're shy about being the dissenter). One
abstains (they're not sure yet but want to acknowledge the poll).

**EXPECTATION:** Clear yes wins. The abstainer shouldn't dilute the
percentage. Anonymous dissenters should feel safe.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Winner is yes | &#x2705; |
| Yes count is 4 | &#x2705; |
| No count is 1 | &#x2705; |
| Abstain count is 1 | &#x2705; |
| Yes percentage based on total votes (including abstain) | &#x2705; |

#### Social Evaluation

> Clear majority respected. Anonymous no vote preserved dissenter's comfort.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "bf536fe2-4950-49f1-a9ac-52a06dda0622",
    "title": "Drinks after work Friday?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T20:09:07.128524+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 4,
    "no_count": 1,
    "abstain_count": 1,
    "total_yes_votes": null,
    "total_votes": 6,
    "yes_percentage": 67,
    "no_percentage": 17,
    "winner": "yes",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_exact_tie">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_exact_tie</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/78af0ea2-5ce0-49a2-93b1-6a9dc322ea28/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Friday drinks: exactly split — 3 yes, 3 no.**

**SCENARIO:** The group is evenly divided. Three want to go, three don't.

**EXPECTATION:** Result should be "tie". The system shouldn't arbitrarily
pick a side. This is a socially important case — a forced "yes" when
half the group doesn't want to go creates resentment.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Result is tie | &#x2705; |
| Equal counts | &#x2705; |

#### Social Evaluation

> Tie correctly reported — group needs to discuss further.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "78af0ea2-5ce0-49a2-93b1-6a9dc322ea28",
    "title": "Drinks after work?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T20:09:07.936755+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 3,
    "no_count": 3,
    "abstain_count": 0,
    "total_yes_votes": null,
    "total_votes": 6,
    "yes_percentage": 50,
    "no_percentage": 50,
    "winner": "tie",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_single_voter">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#f0883e;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">AWKWARD</span> <code>test_single_voter</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/ab8f632d-a2e9-4996-9b30-107dbf1fcc03/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Friday drinks: only the organizer votes.**

**SCENARIO:** Marcus creates the poll and is the only one who votes yes.
Everyone else ignores it.

**SOCIAL QUESTION:** Is a 1-0 victory meaningful? Technically yes wins,
but socially this means nobody else cared enough to respond.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Winner is yes | &#x2705; |
| Total votes is 1 | &#x2705; |

#### Social Evaluation

> Technically yes wins with 100%, but a single-voter poll suggests the group didn't engage. The app could surface low participation as a signal (e.g., '1 of ? responded').

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "ab8f632d-a2e9-4996-9b30-107dbf1fcc03",
    "title": "Drinks after work?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T20:09:08.907646+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 1,
    "no_count": 0,
    "abstain_count": 0,
    "total_yes_votes": null,
    "total_votes": 1,
    "yes_percentage": 100,
    "no_percentage": 0,
    "winner": "yes",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_all_abstain">
<summary><span style="background:#dc3545;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIL</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_all_abstain</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/10690a2a-ae4f-461b-b9e6-915b729d33e1/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Friday drinks: everyone abstains.**

**SCENARIO:** People see the poll but nobody commits. Maybe they're
waiting to see what others do first.

**EXPECTATION:** No winner. The system should handle this gracefully.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| No winner when all abstain | &#x274C; |
| Zero yes votes | &#x2705; |
| Zero no votes | &#x2705; |
| Abstain count is 3 | &#x2705; |

#### Social Evaluation

> All-abstain is a valid social signal: the group is indecisive or uninterested. Showing '0-0 with 3 abstentions' communicates this clearly.

#### Critique

Technical failure: . Needs investigation before social evaluation is meaningful.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "10690a2a-ae4f-461b-b9e6-915b729d33e1",
    "title": "Drinks after work?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T20:09:09.308866+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 0,
    "no_count": 0,
    "abstain_count": 3,
    "total_yes_votes": null,
    "total_votes": 3,
    "yes_percentage": 0,
    "no_percentage": 0,
    "winner": "tie",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_anonymous_majority">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_anonymous_majority</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/b0857f4d-b0f0-4173-b38e-f3049455d0d4/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Should we switch to a 4-day work week? All anonymous votes.**

**SCENARIO:** Someone asks a potentially political workplace question.
Everyone votes anonymously because they don't want their boss
to know their preference.

**EXPECTATION:** Results are clean — just counts, no names.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Yes wins | &#x2705; |
| All votes anonymous | &#x2705; |
| 70% yes | &#x2705; |

#### Social Evaluation

> Anonymous voting protects voters on sensitive topics. No names leaked.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "b0857f4d-b0f0-4173-b38e-f3049455d0d4",
    "title": "Switch to 4-day work week?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T20:09:09.879982+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 7,
    "no_count": 3,
    "abstain_count": 0,
    "total_yes_votes": null,
    "total_votes": 10,
    "yes_percentage": 70,
    "no_percentage": 30,
    "winner": "yes",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_convergent_suggestions">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_convergent_suggestions</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/b3b538ac-e333-4016-baba-a6f621594e17/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Lunch brainstorm: multiple people suggest the same place.**

**SCENARIO:** A team of 5 is deciding where to eat. Several people
independently suggest the same places, showing organic consensus.

**EXPECTATION:** Popular suggestions bubble to the top. The count
reflects how many people independently thought of each place.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Thai Palace is most popular | &#x2705; |
| Burger Barn has 2 votes | &#x2705; |
| Sushi Roll has 2 votes | &#x2705; |
| Taco Town has 1 vote | &#x2705; |
| Results sorted by count descending | &#x2705; |

#### Social Evaluation

> Organic consensus emerged around Thai Palace. The starter option from the creator didn't get unfair advantage — it was genuinely popular.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "b3b538ac-e333-4016-baba-a6f621594e17",
    "title": "Where should we eat?",
    "poll_type": "suggestion",
    "created_at": "2026-04-03T20:09:11.077305+00:00",
    "response_deadline": null,
    "options": [
      "Thai Palace"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": 0,
    "total_yes_votes": null,
    "total_votes": 5,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": null,
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": [
      {
        "option": "Thai Palace",
        "count": 4
      },
      {
        "option": "Burger Barn",
        "count": 2
      },
      {
        "option": "Sushi Roll",
        "count": 2
      },
      {
        "option": "Taco Town",
        "count": 1
      }
    ],
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  },
  "suggestion_map": {
    "Thai Palace": 4,
    "Burger Barn": 2,
    "Sushi Roll": 2,
    "Taco Town": 1
  }
}
```

</details>

</details>

<details id="test_all_unique_suggestions">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#f0883e;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">AWKWARD</span> <code>test_all_unique_suggestions</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/a5b5e3e6-ea1f-48ff-858d-90ad06216164/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Lunch brainstorm: everyone suggests something different.**

**SCENARIO:** Nobody agrees. Five people, five completely different ideas.

**SOCIAL QUESTION:** When there's no overlap, what does the sorted list
communicate? Alphabetical tiebreaking is technically fair but
arbitrary — "Arby's" shouldn't win over "Zaxby's" just by name.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| All suggestions have count 1 | &#x2705; |
| Tiebreak is alphabetical | &#x2705; |

#### Social Evaluation

> All-unique suggestions with alphabetical tiebreak means 'Arby's' appears first not because anyone prefers it more, but because of its name. This is where a follow-up ranked choice poll is essential to resolve the deadlock meaningfully.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "a5b5e3e6-ea1f-48ff-858d-90ad06216164",
    "title": "Where should we eat?",
    "poll_type": "suggestion",
    "created_at": "2026-04-03T20:09:11.767476+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": null,
    "no_count": null,
    "abstain_count": 0,
    "total_yes_votes": null,
    "total_votes": 5,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": null,
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": [
      {
        "option": "Arby's",
        "count": 1
      },
      {
        "option": "KFC",
        "count": 1
      },
      {
        "option": "McDonald's",
        "count": 1
      },
      {
        "option": "Wendy's",
        "count": 1
      },
      {
        "option": "Zaxby's",
        "count": 1
      }
    ],
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_abstainer_in_brainstorm">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_abstainer_in_brainstorm</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/407eeeac-0784-4012-af2e-301a2304440f/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Lunch brainstorm: one person abstains, signaling they'll go anywhere.**

**SCENARIO:** Four people suggest places, one person abstains (they're
happy with whatever the group picks).

**EXPECTATION:** Abstainer doesn't dilute suggestion counts.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Thai Palace has 2 votes | &#x2705; |
| Burger Barn has 1 vote | &#x2705; |
| Abstain count is 1 | &#x2705; |

#### Social Evaluation

> Abstaining in a suggestion poll is a valid social signal: 'I'm flexible.' The abstainer participates without steering the outcome.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "407eeeac-0784-4012-af2e-301a2304440f",
    "title": "Where should we eat?",
    "poll_type": "suggestion",
    "created_at": "2026-04-03T20:09:12.491872+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": null,
    "no_count": null,
    "abstain_count": 1,
    "total_yes_votes": null,
    "total_votes": 4,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": null,
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": [
      {
        "option": "Thai Palace",
        "count": 2
      },
      {
        "option": "Burger Barn",
        "count": 1
      }
    ],
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

## Tests.Edge Cases

<details id="test_all_anonymous_yes_no">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_all_anonymous_yes_no</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/c0998f3b-605e-4bed-b707-ba3b33f3583a/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Fully anonymous vote: nobody attaches their name.**

**SCENARIO:** A group uses the poll for a sensitive decision.
All 8 voters are anonymous. The creator didn't name themselves either.

**EXPECTATION:** Results should be purely numerical. No way to trace
who voted what. This is the privacy promise of the app.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Yes wins (5-3) | &#x2705; |
| All voters anonymous | &#x2705; |

#### Social Evaluation

> Full anonymity maintained. The app provides a safe space for group decisions on sensitive topics where individuals might face pressure for their vote.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "c0998f3b-605e-4bed-b707-ba3b33f3583a",
    "title": "Should we file a complaint?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T20:09:13.333649+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 5,
    "no_count": 3,
    "abstain_count": 0,
    "total_yes_votes": null,
    "total_votes": 8,
    "yes_percentage": 62,
    "no_percentage": 38,
    "winner": "yes",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_mixed_named_and_anonymous">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_mixed_named_and_anonymous</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/9afc77ed-850f-4f71-8878-f413dec16b8c/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Mixed poll: some named, some anonymous.**

**SCENARIO:** In a friend group, some people proudly attach their name
to their vote, others prefer anonymity. Does the mix work?

**SOCIAL QUESTION:** Can you tell which anonymous votes belong to which
people by process of elimination? (If 5 people in a group and 3
named voters, the 2 anonymous ones are identifiable.)

#### Technical Results

| Assertion | Result |
|-----------|--------|
| 3 named voters | &#x2705; |
| 1 anonymous voter | &#x2705; |

#### Social Evaluation

> In a known group of 4, the 1 anonymous voter is trivially identifiable (it's whoever isn't Alice, Bob, or Dave). The app can't prevent social deduction in small groups — this is a fundamental limitation of anonymous voting when the voter pool is known. Consider noting this in UX.


</details>

<details id="test_change_vote_flips_result">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_change_vote_flips_result</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/a6284b1a-a224-406e-ad9b-7f4df0dd3814/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Vote change: a voter switches sides and flips the outcome.**

**SCENARIO:** 3-2 in favor of yes. One yes-voter changes to no,
making it 2-3. The swing voter changed the entire outcome.

**EXPECTATION:** Results reflect the final state, not vote history.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Result flipped to no | &#x2705; |
| No count is now 3 | &#x2705; |
| Yes count is now 2 | &#x2705; |

#### Social Evaluation

> Vote editing is transparent — the result reflects current preferences, not historical ones. This is correct for decision-making (you want the group's final answer), though it means early results are unreliable.


</details>

<details id="test_edit_ranked_choice">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_edit_ranked_choice</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/b3b3fc25-49b7-4dcc-bdad-995be23d0195/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Ranked choice edit: voter reorders their preferences.**

**SCENARIO:** A voter initially ranks A > B > C, then changes to C > A > B.
This tests that the ranking replacement is clean.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| C wins after edit | &#x2705; |

#### Social Evaluation

> Vote editing in ranked choice works cleanly. The edited ballot is treated the same as any other ballot — no trace of the original ranking.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "b3b3fc25-49b7-4dcc-bdad-995be23d0195",
    "title": "Favorite?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T20:09:15.828670+00:00",
    "response_deadline": null,
    "options": [
      "A",
      "B",
      "C"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": null,
    "total_yes_votes": null,
    "total_votes": 3,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": "C",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": [
      {
        "round_number": 1,
        "option_name": "C",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "A",
        "vote_count": 0,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "B",
        "vote_count": 0,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      }
    ],
    "ranked_choice_winner": "C",
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_creator_closes_losing_poll">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_creator_closes_losing_poll</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/1aeb093a-f921-45a5-953f-d562d6feeb86/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Creator closes a poll they're losing.**

**SCENARIO:** The creator votes yes on their own poll, but the group
votes no. The creator then closes the poll. The result should
still reflect the group's decision, not the creator's preference.

**EXPECTATION:** Closing a poll doesn't change the outcome.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| No wins (1-3) | &#x2705; |
| Result is honest despite creator loss | &#x2705; |

#### Social Evaluation

> The creator can close the poll but can't change the outcome. This is an important integrity guarantee — poll creators have administrative power (close/reopen) but not voting power beyond their single vote.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "1aeb093a-f921-45a5-953f-d562d6feeb86",
    "title": "My idea is great, right?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T20:09:16.427962+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 1,
    "no_count": 3,
    "abstain_count": 0,
    "total_yes_votes": null,
    "total_votes": 4,
    "yes_percentage": 25,
    "no_percentage": 75,
    "winner": "no",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_creator_reopens_and_more_votes">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_creator_reopens_and_more_votes</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/855a5016-48b6-447c-93a9-491de1c84f7c/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Creator reopens a closed poll to collect more votes.**

**SCENARIO:** Poll is closed at 2-2 tie. Creator reopens it.
One more person votes and breaks the tie.

**EXPECTATION:** Reopening is legitimate when the creator wants more input.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Initially tied | &#x2705; |
| Yes wins after reopen | &#x2705; |

#### Social Evaluation

> Reopening a tied poll to collect a tiebreaker vote is a legitimate use of creator power. The system supports this workflow cleanly.


</details>

<details id="test_twenty_voter_yes_no">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_twenty_voter_yes_no</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/d6aba2ae-433d-4866-825e-f5ef42ce1655/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Large group: 20 voters on a yes/no question.**

**SCENARIO:** A class of 20 students votes on whether to have a study
session. 12 yes (mix of named/anonymous), 6 no, 2 abstain.

**EXPECTATION:** Percentages and counts are correct at scale.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Yes wins | &#x2705; |
| 12 yes votes | &#x2705; |
| 6 no votes | &#x2705; |
| 2 abstentions | &#x2705; |
| 20 total votes | &#x2705; |
| 60% yes | &#x2705; |

#### Social Evaluation

> Scales cleanly. Mix of named/anonymous voters works at 20-person scale.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "d6aba2ae-433d-4866-825e-f5ef42ce1655",
    "title": "Study session before the exam?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T20:09:17.947115+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 12,
    "no_count": 6,
    "abstain_count": 2,
    "total_yes_votes": null,
    "total_votes": 20,
    "yes_percentage": 60,
    "no_percentage": 30,
    "winner": "yes",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_ten_option_ranked_choice">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_ten_option_ranked_choice</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/f8e69e6e-fc82-4889-bb7b-241dea2bb136/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Large ranked choice: 10 options, 8 voters.**

**SCENARIO:** A group has too many ideas. 10 restaurant options,
8 voters with varied preferences. Tests IRV at higher option counts.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Winner determined | &#x2705; |
| Multiple elimination rounds | &#x2705; |

#### Social Evaluation

> With 10 options and 8 voters, IRV took 9 rounds to find winner: Thai. Italian and Thai appear frequently across ballots — the winner likely has broad second/third choice support, which is the whole point of ranked choice.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "f8e69e6e-fc82-4889-bb7b-241dea2bb136",
    "title": "Restaurant for team dinner?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T20:09:19.984154+00:00",
    "response_deadline": null,
    "options": [
      "Italian",
      "Thai",
      "Mexican",
      "Indian",
      "Chinese",
      "Japanese",
      "Korean",
      "Ethiopian",
      "Greek",
      "American"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": null,
    "total_yes_votes": null,
    "total_votes": 8,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": "Thai",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": [
      {
        "round_number": 1,
        "option_name": "Thai",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "American",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Ethiopian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Indian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Italian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Korean",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Mexican",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Chinese",
        "vote_count": 0,
        "is_eliminated": false,
        "borda_score": 25,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 1,
        "option_name": "Greek",
        "vote_count": 0,
        "is_eliminated": true,
        "borda_score": 18,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 1,
        "option_name": "Japanese",
        "vote_count": 0,
        "is_eliminated": false,
        "borda_score": 26,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 2,
        "option_name": "Thai",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "American",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Ethiopian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Indian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Italian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Korean",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Mexican",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Chinese",
        "vote_count": 0,
        "is_eliminated": true,
        "borda_score": 25,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 2,
        "option_name": "Japanese",
        "vote_count": 0,
        "is_eliminated": false,
        "borda_score": 26,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 3,
        "option_name": "Thai",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 3,
        "option_name": "American",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 3,
        "option_name": "Ethiopian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 3,
        "option_name": "Indian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 3,
        "option_name": "Italian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 3,
        "option_name": "Korean",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 3,
        "option_name": "Mexican",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 3,
        "option_name": "Japanese",
        "vote_count": 0,
        "is_eliminated": true,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 4,
        "option_name": "Thai",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 4,
        "option_name": "American",
        "vote_count": 1,
        "is_eliminated": true,
        "borda_score": 18,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 4,
        "option_name": "Ethiopian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 23,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 4,
        "option_name": "Indian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 26,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 4,
        "option_name": "Italian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 65,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 4,
        "option_name": "Korean",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 24,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 4,
        "option_name": "Mexican",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 27,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 5,
        "option_name": "Mexican",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 5,
        "option_name": "Thai",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 5,
        "option_name": "Ethiopian",
        "vote_count": 1,
        "is_eliminated": true,
        "borda_score": 23,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 5,
        "option_name": "Indian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 26,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 5,
        "option_name": "Italian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 65,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 5,
        "option_name": "Korean",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 24,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 6,
        "option_name": "Indian",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 6,
        "option_name": "Mexican",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 6,
        "option_name": "Thai",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 6,
        "option_name": "Italian",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 65,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 6,
        "option_name": "Korean",
        "vote_count": 1,
        "is_eliminated": true,
        "borda_score": 24,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 7,
        "option_name": "Thai",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 7,
        "option_name": "Indian",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 7,
        "option_name": "Mexican",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 7,
        "option_name": "Italian",
        "vote_count": 1,
        "is_eliminated": true,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 8,
        "option_name": "Thai",
        "vote_count": 4,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 8,
        "option_name": "Indian",
        "vote_count": 2,
        "is_eliminated": true,
        "borda_score": 26,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 8,
        "option_name": "Mexican",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": 27,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 9,
        "option_name": "Thai",
        "vote_count": 6,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 9,
        "option_name": "Mexican",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      }
    ],
    "ranked_choice_winner": "Thai",
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  },
  "winner": "Thai",
  "num_rounds": 9
}
```

</details>

</details>

## Tests.Event Planning

<details id="test_everyone_flexible">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_everyone_flexible</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/39448a87-0ad3-48a2-bede-22f67837c567/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Dinner party: 5 people say yes with no constraints.**

**SCENARIO:** Simple case — everyone's available and flexible about
group size. No constraints to conflict.

**EXPECTATION:** All 5 should be included.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| All 5 participate | &#x2705; |

#### Social Evaluation

> No constraints means everyone's in. Simple and correct.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "39448a87-0ad3-48a2-bede-22f67837c567",
    "title": "Dinner at my place Saturday?",
    "poll_type": "participation",
    "created_at": "2026-04-03T20:09:22.053435+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 5,
    "no_count": 0,
    "abstain_count": 0,
    "total_yes_votes": 5,
    "total_votes": 5,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": null,
    "min_participants": 2,
    "max_participants": 10,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": [
      "c45146f2-3f4b-4e50-a979-2b65abbc8a42",
      "b75291ed-f0eb-4d81-9e76-1d44c1cf8cde",
      "ca4dc56a-3abb-4f07-9c2b-31d64ea63501",
      "904e0a43-901b-48cf-b59d-6d33164abe3b",
      "654530fa-795f-4cb3-ba44-7d39cca5471e"
    ],
    "participating_voter_names": [
      "Alice",
      "Bob",
      "Carol",
      "Dave",
      "Eve"
    ]
  }
}
```

</details>

</details>

<details id="test_introvert_vs_extrovert">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_introvert_vs_extrovert</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/ed4c2fca-0370-42d8-9ca5-2048d6ad2997/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Dinner party: introvert wants small group, extrovert wants big group.**

**SCENARIO:** Alice only wants to come if it's intimate (max 3 people).
Bob only wants to come if it's a party (min 5 people). Three others
are flexible. The poll allows 1-10 participants.

**SOCIAL QUESTION:** The algorithm prioritizes flexible voters. Alice
(max=3) is restrictive and may get deprioritized. Is that fair?
She has a legitimate social preference.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| At least 3 participants | &#x2705; |
| Flexible voters included | &#x2705; |

#### Social Evaluation

> Neither constrained voter was included. The algorithm prioritized the 3 flexible voters, giving count=3. Alice (max=3) *could* fit, but the algorithm may not have tried her. Worth investigating if the algorithm should attempt to include constrained voters after selecting the flexible core.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "ed4c2fca-0370-42d8-9ca5-2048d6ad2997",
    "title": "Dinner party Saturday?",
    "poll_type": "participation",
    "created_at": "2026-04-03T20:09:22.841077+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 3,
    "no_count": 0,
    "abstain_count": 0,
    "total_yes_votes": 5,
    "total_votes": 5,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": null,
    "min_participants": 1,
    "max_participants": 10,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": [
      "c2156815-4e08-4a97-8719-b74b9b8915a4",
      "65e72325-b96b-4d1b-b0dc-982020d32836",
      "acc585b0-1cff-47f0-a1ee-daec068b90a9"
    ],
    "participating_voter_names": [
      "Carol",
      "Dave",
      "Eve"
    ]
  },
  "participant_names": [
    "Carol",
    "Dave",
    "Eve"
  ]
}
```

</details>

</details>

<details id="test_minimum_not_met">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_minimum_not_met</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/de26d5be-5288-4229-9346-2346de380d57/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Dinner party: not enough people to meet the creator's minimum.**

**SCENARIO:** The creator sets min_participants=4 (they don't want a
dinner party with fewer than 4 people). Only 2 people say yes.

**NOTE:** The participation algorithm only enforces *individual voter*
constraints, not the poll-level min. So Alice and Bob (who have no
personal constraints) are both included — count=2.

**SOCIAL QUESTION:** Should the poll-level minimum be enforced? A creator
who says "minimum 4" probably expects the event to be cancelled if
only 2 people show up.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Participants returned | &#x2705; |  |
| Participant count (2) vs poll min (4) | &#x2705; | count=2, poll_min=4 |

#### Social Evaluation

> Only 2 participants vs creator's minimum of 4. The algorithm included willing voters but didn't enforce the poll-level minimum. The creator would see 2 participants and have to decide whether that's enough — the system doesn't auto-cancel for them.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "de26d5be-5288-4229-9346-2346de380d57",
    "title": "Dinner party?",
    "poll_type": "participation",
    "created_at": "2026-04-03T20:09:23.589962+00:00",
    "response_deadline": null,
    "options": null,
    "yes_count": 2,
    "no_count": 1,
    "abstain_count": 0,
    "total_yes_votes": 2,
    "total_votes": 3,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": null,
    "min_participants": 4,
    "max_participants": 10,
    "suggestion_counts": null,
    "ranked_choice_rounds": null,
    "ranked_choice_winner": null,
    "time_slot_rounds": null,
    "participating_vote_ids": [
      "6b745386-57ed-4781-82fd-de4e569d7fd0",
      "a0960465-e1f9-470c-b914-aad9369c530a"
    ],
    "participating_voter_names": [
      "Alice",
      "Bob"
    ]
  }
}
```

</details>

</details>

<details id="test_mixed_yes_no_and_abstain">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_mixed_yes_no_and_abstain</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/65ecffd7-d576-4655-a268-f33f1334fd7b/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Dinner party: mix of yes, no, and abstain votes.**

**SCENARIO:** 3 yes, 2 no, 1 abstain. Min is 2.

**EXPECTATION:** Only yes voters can be participants. No and abstain
voters are excluded from the participant pool.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| 3 participants | &#x2705; |
| All are yes voters | &#x2705; |

#### Social Evaluation

> Only willing participants included. No/abstain correctly excluded.


</details>

<details id="test_exactly_one_person_event">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_exactly_one_person_event</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/f72b6046-aca6-4582-abf3-3ba2be05c8f0/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Solo activity: 'Anyone want my extra concert ticket?'**

**SCENARIO:** One ticket available (max=1). Three people want it.
With max_participants=1, the poll auto-closes after the first
"yes" vote, so only the first responder gets in.

**SOCIAL QUESTION:** Is first-come-first-served fair, or should it
be random? FCFS rewards people who check their phone more often.

**NOTE:** The auto-close behavior means later voters can't even submit.
This test verifies that the auto-close works correctly for this case
and that the first voter is selected.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Poll auto-closed | &#x2705; |
| Exactly 1 participant | &#x2705; |
| First voter wins | &#x2705; |

#### Social Evaluation

> 'Eager Eve' got the ticket. With max_participants=1, the poll auto-closes immediately after the first 'yes' vote — later respondents can't even submit. This is effectively first-come-first-served enforced by the system. Transparent, but may feel unfair to people in different time zones or who check their phone less frequently.

<details>
<summary>Raw data</summary>

```json
{
  "winner": "Eager Eve"
}
```

</details>

</details>

<details id="test_driver_needs_riders">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_driver_needs_riders</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/f3a61ea0-b578-4540-b179-6f2a6df8adc1/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Carpool: driver needs at least 2 riders to justify the trip.**

**SCENARIO:** A driver is offering a carpool to an event but only
wants to drive if at least 2 other people are coming.

**EXPECTATION:** If 2+ people say yes, the carpool happens. Otherwise
it doesn't, and the driver knows not to bother.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| 3 participants (within capacity) | &#x2705; |

#### Social Evaluation

> Carpool happens with 3 riders. Driver gets clear confirmation.


</details>

<details id="test_conflicting_rider_constraints">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_conflicting_rider_constraints</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/a10d5713-298b-4860-abfb-af88ba77ff80/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Carpool: riders have conflicting preferences about group size.**

**SCENARIO:** Car seats 4. Rider A only wants to go with at least 3
others (min=3). Rider B wants a quiet ride (max=2). Riders C and D
are flexible.

The algorithm must choose between satisfying A or B.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| At least 2 participants | &#x2705; |
| Both flexible riders included | &#x2705; |

#### Social Evaluation

> Participants: ['Flex Chris', 'Flex Dana', 'Social Sam']. The algorithm prioritizes flexible voters, then tries to include constrained voters. Social Sam (min=3) and Quiet Quinn (max=2) have fundamentally incompatible preferences — the system can satisfy at most one of them.

<details>
<summary>Raw data</summary>

```json
{
  "participant_names": [
    "Flex Chris",
    "Flex Dana",
    "Social Sam"
  ]
}
```

</details>

</details>

## Tests.Multi Stage

<details id="test_suggestion_to_ranked_choice_pipeline">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_suggestion_to_ranked_choice_pipeline</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/d8497599-7678-4ccd-a6c4-55a9bf3e9cfa/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Full pipeline: suggestions collected, then ranked.**

**SCENARIO:** A team is picking a name for their project. Phase 1:
everyone suggests names (suggestion poll). Phase 2: the top
suggestions go to a ranked choice vote.

This simulates the manual version of the pipeline (creator
creates the follow-up ranked choice poll themselves).

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Top suggestions carried forward | &#x2705; |
| Ranked choice produced winner | &#x2705; |
| Follow-up link preserved | &#x2705; |

#### Social Evaluation

> Two-phase process: brainstorm surfaced top ideas, ranked choice picked 'Moonshot'. This mimics natural group decision-making: diverge (suggest), then converge (rank).


</details>

<details id="test_auto_preferences_workflow">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_auto_preferences_workflow</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/dd4ac2f9-5717-4734-8e35-d476737cdb35/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Auto-preferences: suggestion poll automatically creates a follow-up ranked choice.**

**SCENARIO:** Creator enables auto_create_preferences. When the
suggestion poll closes, the server automatically creates a
ranked choice poll with the suggestions as options.

**EXPECTATION:** The follow-up poll exists, is linked, and contains
the right options.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Suggestion poll is closed | &#x2705; |
| Follow-up is ranked_choice | &#x2705; |
| Follow-up linked to original | &#x2705; |
| Follow-up has options from suggestions | &#x2705; |

#### Social Evaluation

> Auto-preferences seamlessly creates the second phase. Users don't need to manually extract suggestions and create a new poll — the workflow handles the transition automatically.


</details>

<details id="test_fork_preserves_context">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_fork_preserves_context</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/61e31430-c3d8-4c16-ae6f-70f7e1d2719d/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Fork: someone creates a variant of an existing poll.**

**SCENARIO:** Original poll asks "Best pizza topping?" with options.
Someone forks it to ask "Best pizza topping for KIDS?" — same
concept, different audience.

**EXPECTATION:** Fork link is preserved. Both polls function independently.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Fork linked to original | &#x2705; |
| Both have winners | &#x2705; |
| Polls are independent (different option sets) | &#x2705; |

#### Social Evaluation

> Fork maintains provenance while allowing the new poll to diverge. Different options, different voters, independent results — but the link back to the original provides context for why this poll exists.


</details>

<details id="test_follow_up_after_tie">
<summary><span style="background:#dc3545;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIL</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_follow_up_after_tie</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/492bcd56-a95e-4678-ba7a-6e923b73df6a/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Follow-up: tie leads to a runoff with fewer options.**

**SCENARIO:** A yes/no poll ties 3-3. The creator creates a follow-up
with more context to break the tie.

**EXPECTATION:** The follow-up is linked and can reference the tied result.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| First poll tied | &#x2705; |
| Second poll has a winner | &#x274C; |
| Follow-up linked | &#x2705; |

#### Social Evaluation

> Following up a tie with more context is a natural group behavior. The link between polls preserves the decision history: 'We tied, so we added more info and voted again.' Result: tie (3-3).

#### Critique

Technical failure: . Needs investigation before social evaluation is meaningful.


</details>

## Tests.Ranked Preferences

<details id="test_clear_favorite">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_clear_favorite</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/157322f6-cee7-4c04-9528-9244600d3eb8/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Movie night: one film is everyone's top or second pick.**

**SCENARIO:** Five friends rank movies. "Dune" is everyone's first or
second choice, even though first-place votes are split.

**EXPECTATION:** Dune should win. IRV should surface the consensus
pick even when first-choice votes are fragmented.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Dune wins | &#x2705; |

#### Social Evaluation

> Dune is the consensus pick — universally liked even if not everyone's #1. IRV correctly identifies the 'least objectionable' choice.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "157322f6-cee7-4c04-9528-9244600d3eb8",
    "title": "What movie should we watch?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T20:09:31.229976+00:00",
    "response_deadline": null,
    "options": [
      "Dune",
      "Barbie",
      "Oppenheimer",
      "Spider-Verse"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": null,
    "total_yes_votes": null,
    "total_votes": 5,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": "Dune",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": [
      {
        "round_number": 1,
        "option_name": "Dune",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Barbie",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Oppenheimer",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Spider-Verse",
        "vote_count": 0,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      }
    ],
    "ranked_choice_winner": "Dune",
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_condorcet_scenario">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_condorcet_scenario</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/3769d9a0-10be-436e-b18d-a8ddd7510330/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Movie night: the group is polarized but there's a compromise option.**

**SCENARIO:** Half the group loves action, half loves comedy.
A dramedy (mix) is everyone's second choice. In a simple
plurality vote, the dramedy would lose. Does IRV find it?

This is the classic case where ranked choice voting should
outperform simple majority.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| A winner was determined | &#x2705; |

#### Social Evaluation

> IRV picked 'Romantic Comedy' instead of the compromise 'Dramedy'. This can happen when the compromise is eliminated first (having fewest first-place votes). This is a known limitation of IRV — it doesn't always find the Condorcet winner.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "3769d9a0-10be-436e-b18d-a8ddd7510330",
    "title": "Movie genre tonight?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T20:09:31.948217+00:00",
    "response_deadline": null,
    "options": [
      "Action Blockbuster",
      "Romantic Comedy",
      "Dramedy"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": null,
    "total_yes_votes": null,
    "total_votes": 7,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": "Romantic Comedy",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": [
      {
        "round_number": 1,
        "option_name": "Action Blockbuster",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Romantic Comedy",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Dramedy",
        "vote_count": 1,
        "is_eliminated": true,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Romantic Comedy",
        "vote_count": 4,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Action Blockbuster",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      }
    ],
    "ranked_choice_winner": "Romantic Comedy",
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  },
  "winner": "Romantic Comedy"
}
```

</details>

</details>

<details id="test_spoiler_effect">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_spoiler_effect</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/c3d25b93-95ae-4c69-868c-b94c0cb87c27/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Movie night: a niche option splits the vote of similar options.**

**SCENARIO:** Two sci-fi films and one comedy. Sci-fi fans split
between the two sci-fi options, potentially letting comedy win
even though sci-fi is more popular overall.

Does IRV handle vote-splitting better than plurality?

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| A winner exists | &#x2705; |  |
| Sci-fi wins (IRV resolves vote splitting) | &#x2705; | Winner was Interstellar |

#### Social Evaluation

> IRV correctly consolidates the sci-fi vote after eliminating the weaker sci-fi option. In simple plurality, Mean Girls would have won despite 4/7 voters preferring sci-fi.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "c3d25b93-95ae-4c69-868c-b94c0cb87c27",
    "title": "Movie pick?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T20:09:32.842777+00:00",
    "response_deadline": null,
    "options": [
      "Dune",
      "Interstellar",
      "Mean Girls"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": null,
    "total_yes_votes": null,
    "total_votes": 7,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": "Interstellar",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": [
      {
        "round_number": 1,
        "option_name": "Mean Girls",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Dune",
        "vote_count": 2,
        "is_eliminated": true,
        "borda_score": 14,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 1,
        "option_name": "Interstellar",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": 15,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 2,
        "option_name": "Interstellar",
        "vote_count": 4,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Mean Girls",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      }
    ],
    "ranked_choice_winner": "Interstellar",
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  },
  "winner": "Interstellar"
}
```

</details>

</details>

<details id="test_partial_rankings">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_partial_rankings</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/24ce599e-c563-428f-bd28-517c083bc8a8/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Movie night: some people only rank their top picks.**

**SCENARIO:** Not everyone ranks all options. Some people only care
about their top 1-2 choices and don't bother ranking the rest.

**EXPECTATION:** Partial ballots should still count. Exhausted ballots
(all ranked options eliminated) are handled gracefully.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| Winner determined | &#x2705; |

#### Social Evaluation

> Partial rankings are a natural expression of preference: 'I only care about these options.' The system should respect this rather than forcing voters to rank options they're indifferent about.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "24ce599e-c563-428f-bd28-517c083bc8a8",
    "title": "Movie?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T20:09:33.750370+00:00",
    "response_deadline": null,
    "options": [
      "A",
      "B",
      "C",
      "D"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": null,
    "total_yes_votes": null,
    "total_votes": 5,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": "C",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": [
      {
        "round_number": 1,
        "option_name": "C",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "A",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 7,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 1,
        "option_name": "B",
        "vote_count": 1,
        "is_eliminated": true,
        "borda_score": 7,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 1,
        "option_name": "D",
        "vote_count": 1,
        "is_eliminated": false,
        "borda_score": 10,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 2,
        "option_name": "A",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "C",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "D",
        "vote_count": 1,
        "is_eliminated": true,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 3,
        "option_name": "A",
        "vote_count": 2,
        "is_eliminated": true,
        "borda_score": 7,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 3,
        "option_name": "C",
        "vote_count": 2,
        "is_eliminated": false,
        "borda_score": 11,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 4,
        "option_name": "C",
        "vote_count": 4,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      }
    ],
    "ranked_choice_winner": "C",
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_unanimity">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_unanimity</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/b0c7eb78-d1a3-4e14-85f7-d85a5b60f2d1/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Movie night: everyone agrees on the same first choice.**

**SCENARIO:** Rare but it happens — everyone wants the same thing.
Should resolve in round 1 with no eliminations.

#### Technical Results

| Assertion | Result |
|-----------|--------|
| The Matrix wins | &#x2705; |
| Decided in round 1 | &#x2705; |

#### Social Evaluation

> Unanimous agreement resolved instantly. No wasted rounds.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "b0c7eb78-d1a3-4e14-85f7-d85a5b60f2d1",
    "title": "Movie?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T20:09:34.490527+00:00",
    "response_deadline": null,
    "options": [
      "The Matrix",
      "Star Wars",
      "Titanic"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": null,
    "total_yes_votes": null,
    "total_votes": 5,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": "The Matrix",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": [
      {
        "round_number": 1,
        "option_name": "The Matrix",
        "vote_count": 5,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Star Wars",
        "vote_count": 0,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 1,
        "option_name": "Titanic",
        "vote_count": 0,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      }
    ],
    "ranked_choice_winner": "The Matrix",
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  }
}
```

</details>

</details>

<details id="test_borda_tiebreaker">
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_borda_tiebreaker</code> <a href="https://test-at-test-com.dev.whoeverwants.com/p/c3467c92-44b0-49f2-87b5-9b84baab2868/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a></summary>

#### Scenario

**Team retreat: three-way tie in first-place votes, broken by Borda.**

**SCENARIO:** 9 team members, 3 destinations. Each destination has
exactly 3 first-place votes. The Borda count (positional scoring)
breaks the tie by considering all ranking positions.

**EXPECTATION:** The destination with the best overall rankings wins,
not just the one with the most first-place votes.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Winner determined | &#x2705; |  |
| Mountain Lodge wins (best overall ranking) | &#x2705; | Actual winner: Mountain Lodge |

#### Social Evaluation

> Mountain Lodge is ranked 1st or 2nd by everyone — the Borda tiebreaker correctly identifies it as the most broadly acceptable choice.

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "c3467c92-44b0-49f2-87b5-9b84baab2868",
    "title": "Team retreat destination?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T20:09:35.187227+00:00",
    "response_deadline": null,
    "options": [
      "Lake House",
      "Mountain Lodge",
      "Beach Resort"
    ],
    "yes_count": null,
    "no_count": null,
    "abstain_count": null,
    "total_yes_votes": null,
    "total_votes": 9,
    "yes_percentage": null,
    "no_percentage": null,
    "winner": "Mountain Lodge",
    "min_participants": null,
    "max_participants": null,
    "suggestion_counts": null,
    "ranked_choice_rounds": [
      {
        "round_number": 1,
        "option_name": "Beach Resort",
        "vote_count": 3,
        "is_eliminated": true,
        "borda_score": 15,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 1,
        "option_name": "Lake House",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": 18,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 1,
        "option_name": "Mountain Lodge",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": 21,
        "tie_broken_by_borda": true
      },
      {
        "round_number": 2,
        "option_name": "Mountain Lodge",
        "vote_count": 6,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      },
      {
        "round_number": 2,
        "option_name": "Lake House",
        "vote_count": 3,
        "is_eliminated": false,
        "borda_score": null,
        "tie_broken_by_borda": false
      }
    ],
    "ranked_choice_winner": "Mountain Lodge",
    "time_slot_rounds": null,
    "participating_vote_ids": null,
    "participating_voter_names": null
  },
  "winner": "Mountain Lodge"
}
```

</details>

</details>
