# Social Test Report — 2026-04-03 19:13 UTC

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
| <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> Technical pass | 30 |
| <span style="background:#dc3545;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIL</span> Technical fail | 3 |
| <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> Socially fair | 24 |
| <span style="background:#f0883e;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">AWKWARD</span> Socially awkward | 2 |
| <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> Insights | 7 |

## Tests.Casual Decisions

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_clear_majority_yes</code></summary>

#### Scenario

Friday drinks: 4 yes, 1 no, 1 abstain.

        SCENARIO: Marcus creates a poll asking "Drinks after work Friday?"
        Four coworkers say yes (two named, two anonymous). One says no
        (anonymous — maybe they're shy about being the dissenter). One
        abstains (they're not sure yet but want to acknowledge the poll).

        EXPECTATION: Clear yes wins. The abstainer shouldn't dilute the
        percentage. Anonymous dissenters should feel safe.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Winner is yes | &#x2705; |  |
| Yes count is 4 | &#x2705; |  |
| No count is 1 | &#x2705; |  |
| Abstain count is 1 | &#x2705; |  |
| Yes percentage based on total votes (including abstain) | &#x2705; |  |

#### Social Evaluation

> Clear majority respected. Anonymous no vote preserved dissenter's comfort.

#### Critique

_System behaves as expected for this social scenario._

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "99373863-cbb7-45b8-9964-68297baf4d18",
    "title": "Drinks after work Friday?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T19:13:03.977694+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_exact_tie</code></summary>

#### Scenario

Friday drinks: exactly split — 3 yes, 3 no.

        SCENARIO: The group is evenly divided. Three want to go, three don't.

        EXPECTATION: Result should be "tie". The system shouldn't arbitrarily
        pick a side. This is a socially important case — a forced "yes" when
        half the group doesn't want to go creates resentment.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Result is tie | &#x2705; |  |
| Equal counts | &#x2705; |  |

#### Social Evaluation

> Tie correctly reported — group needs to discuss further.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "0a1a8de6-4192-4b87-b45c-0e71cb7bdb8d",
    "title": "Drinks after work?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T19:13:04.961042+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#f0883e;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">AWKWARD</span> <code>test_single_voter</code></summary>

#### Scenario

Friday drinks: only the organizer votes.

        SCENARIO: Marcus creates the poll and is the only one who votes yes.
        Everyone else ignores it.

        SOCIAL QUESTION: Is a 1-0 victory meaningful? Technically yes wins,
        but socially this means nobody else cared enough to respond.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Winner is yes | &#x2705; |  |
| Total votes is 1 | &#x2705; |  |

#### Social Evaluation

> Technically yes wins with 100%, but a single-voter poll suggests the group didn't engage. The app could surface low participation as a signal (e.g., '1 of ? responded').

#### Critique

_This test highlights a genuine UX concern. The core issue: Technically yes wins with 100%, but a single-voter poll suggests the group didn't engage. The app could surface low participation as a signal (e.g., '1 of ? responded'). (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "29878648-8285-4867-a8d0-7df4e11581fd",
    "title": "Drinks after work?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T19:13:05.815276+00:00",
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

<details>
<summary><span style="background:#dc3545;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIL</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_all_abstain</code></summary>

#### Scenario

Friday drinks: everyone abstains.

        SCENARIO: People see the poll but nobody commits. Maybe they're
        waiting to see what others do first.

        EXPECTATION: No winner. The system should handle this gracefully.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| No winner when all abstain | &#x274C; |  |
| Zero yes votes | &#x2705; |  |
| Zero no votes | &#x2705; |  |
| Abstain count is 3 | &#x2705; |  |

#### Social Evaluation

> All-abstain is a valid social signal: the group is indecisive or uninterested. Showing '0-0 with 3 abstentions' communicates this clearly.

#### Critique

_Technical failure detected: . This needs investigation before social evaluation is meaningful. (Previous assessment: "This test highlights a genuine UX concern. The core issue: Technically yes wins with 100%, but a sin..." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "d39da08b-3be0-4093-ab21-9d42f1560503",
    "title": "Drinks after work?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T19:13:06.180022+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_anonymous_majority</code></summary>

#### Scenario

Should we switch to a 4-day work week? All anonymous votes.

        SCENARIO: Someone asks a potentially political workplace question.
        Everyone votes anonymously because they don't want their boss
        to know their preference.

        EXPECTATION: Results are clean — just counts, no names.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Yes wins | &#x2705; |  |
| All votes anonymous | &#x2705; |  |
| 70% yes | &#x2705; |  |

#### Social Evaluation

> Anonymous voting protects voters on sensitive topics. No names leaked.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "Technical failure detected: . This needs investigation before social evaluation is meaningful...." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "0951fe52-ddc5-46ec-9180-5cf023cbad8e",
    "title": "Switch to 4-day work week?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T19:13:06.786630+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_convergent_suggestions</code></summary>

#### Scenario

Lunch brainstorm: multiple people suggest the same place.

        SCENARIO: A team of 5 is deciding where to eat. Several people
        independently suggest the same places, showing organic consensus.

        EXPECTATION: Popular suggestions bubble to the top. The count
        reflects how many people independently thought of each place.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Thai Palace is most popular | &#x2705; |  |
| Burger Barn has 2 votes | &#x2705; |  |
| Sushi Roll has 2 votes | &#x2705; |  |
| Taco Town has 1 vote | &#x2705; |  |
| Results sorted by count descending | &#x2705; |  |

#### Social Evaluation

> Organic consensus emerged around Thai Palace. The starter option from the creator didn't get unfair advantage — it was genuinely popular.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "491481df-06ae-4afc-97a6-6bd84c52eec5",
    "title": "Where should we eat?",
    "poll_type": "suggestion",
    "created_at": "2026-04-03T19:13:08.102143+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#f0883e;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">AWKWARD</span> <code>test_all_unique_suggestions</code></summary>

#### Scenario

Lunch brainstorm: everyone suggests something different.

        SCENARIO: Nobody agrees. Five people, five completely different ideas.

        SOCIAL QUESTION: When there's no overlap, what does the sorted list
        communicate? Alphabetical tiebreaking is technically fair but
        arbitrary — "Arby's" shouldn't win over "Zaxby's" just by name.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| All suggestions have count 1 | &#x2705; |  |
| Tiebreak is alphabetical | &#x2705; |  |

#### Social Evaluation

> All-unique suggestions with alphabetical tiebreak means 'Arby's' appears first not because anyone prefers it more, but because of its name. This is where a follow-up ranked choice poll is essential to resolve the deadlock meaningfully.

#### Critique

_This test highlights a genuine UX concern. The core issue: All-unique suggestions with alphabetical tiebreak means 'Arby's' appears first not because anyone prefers it more, but because of its name. This is where a follow-up ranked choice poll is essential to resolve the deadlock meaningfully. (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "3f783a29-b5bd-4f0f-a9bb-684136f037e2",
    "title": "Where should we eat?",
    "poll_type": "suggestion",
    "created_at": "2026-04-03T19:13:08.946116+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_abstainer_in_brainstorm</code></summary>

#### Scenario

Lunch brainstorm: one person abstains, signaling they'll go anywhere.

        SCENARIO: Four people suggest places, one person abstains (they're
        happy with whatever the group picks).

        EXPECTATION: Abstainer doesn't dilute suggestion counts.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Thai Palace has 2 votes | &#x2705; |  |
| Burger Barn has 1 vote | &#x2705; |  |
| Abstain count is 1 | &#x2705; |  |

#### Social Evaluation

> Abstaining in a suggestion poll is a valid social signal: 'I'm flexible.' The abstainer participates without steering the outcome.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "This test highlights a genuine UX concern. The core issue: All-unique suggestions with alphabetical ..." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "6b429d9b-8ca4-4d78-8254-72a9ea23a953",
    "title": "Where should we eat?",
    "poll_type": "suggestion",
    "created_at": "2026-04-03T19:13:09.673472+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_all_anonymous_yes_no</code></summary>

#### Scenario

Fully anonymous vote: nobody attaches their name.

        SCENARIO: A group uses the poll for a sensitive decision.
        All 8 voters are anonymous. The creator didn't name themselves either.

        EXPECTATION: Results should be purely numerical. No way to trace
        who voted what. This is the privacy promise of the app.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Yes wins (5-3) | &#x2705; |  |
| All voters anonymous | &#x2705; |  |

#### Social Evaluation

> Full anonymity maintained. The app provides a safe space for group decisions on sensitive topics where individuals might face pressure for their vote.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "a7780001-54e8-427b-9e05-d27024d899d8",
    "title": "Should we file a complaint?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T19:13:10.315061+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_mixed_named_and_anonymous</code></summary>

#### Scenario

Mixed poll: some named, some anonymous.

        SCENARIO: In a friend group, some people proudly attach their name
        to their vote, others prefer anonymity. Does the mix work?

        SOCIAL QUESTION: Can you tell which anonymous votes belong to which
        people by process of elimination? (If 5 people in a group and 3
        named voters, the 2 anonymous ones are identifiable.)

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| 3 named voters | &#x2705; |  |
| 1 anonymous voter | &#x2705; |  |

#### Social Evaluation

> In a known group of 4, the 1 anonymous voter is trivially identifiable (it's whoever isn't Alice, Bob, or Dave). The app can't prevent social deduction in small groups — this is a fundamental limitation of anonymous voting when the voter pool is known. Consider noting this in UX.

#### Critique

_This test reveals an interesting system property worth documenting. In a known group of 4, the 1 anonymous voter is trivially identifiable (it's whoever isn't Alice, Bob, or Dave). The app can't prevent social deduction in small groups — this is a fundamental limitation of anonymous voting when the voter pool is known. Consider noting this in UX. (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_


</details>

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_change_vote_flips_result</code></summary>

#### Scenario

Vote change: a voter switches sides and flips the outcome.

        SCENARIO: 3-2 in favor of yes. One yes-voter changes to no,
        making it 2-3. The swing voter changed the entire outcome.

        EXPECTATION: Results reflect the final state, not vote history.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Result flipped to no | &#x2705; |  |
| No count is now 3 | &#x2705; |  |
| Yes count is now 2 | &#x2705; |  |

#### Social Evaluation

> Vote editing is transparent — the result reflects current preferences, not historical ones. This is correct for decision-making (you want the group's final answer), though it means early results are unreliable.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "This test reveals an interesting system property worth documenting. In a known group of 4, the 1 ano..." — assessment updated.)_


</details>

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_edit_ranked_choice</code></summary>

#### Scenario

Ranked choice edit: voter reorders their preferences.

        SCENARIO: A voter initially ranks A > B > C, then changes to C > A > B.
        This tests that the ranking replacement is clean.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| C wins after edit | &#x2705; |  |

#### Social Evaluation

> Vote editing in ranked choice works cleanly. The edited ballot is treated the same as any other ballot — no trace of the original ranking.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "d44c5b73-7c2e-4037-bd18-e5041daf3041",
    "title": "Favorite?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T19:13:13.068723+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_creator_closes_losing_poll</code></summary>

#### Scenario

Creator closes a poll they're losing.

        SCENARIO: The creator votes yes on their own poll, but the group
        votes no. The creator then closes the poll. The result should
        still reflect the group's decision, not the creator's preference.

        EXPECTATION: Closing a poll doesn't change the outcome.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| No wins (1-3) | &#x2705; |  |
| Result is honest despite creator loss | &#x2705; |  |

#### Social Evaluation

> The creator can close the poll but can't change the outcome. This is an important integrity guarantee — poll creators have administrative power (close/reopen) but not voting power beyond their single vote.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "32594007-ae2d-49b6-904a-11747d194daa",
    "title": "My idea is great, right?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T19:13:13.857534+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_creator_reopens_and_more_votes</code></summary>

#### Scenario

Creator reopens a closed poll to collect more votes.

        SCENARIO: Poll is closed at 2-2 tie. Creator reopens it.
        One more person votes and breaks the tie.

        EXPECTATION: Reopening is legitimate when the creator wants more input.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Initially tied | &#x2705; |  |
| Yes wins after reopen | &#x2705; |  |

#### Social Evaluation

> Reopening a tied poll to collect a tiebreaker vote is a legitimate use of creator power. The system supports this workflow cleanly.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_


</details>

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_twenty_voter_yes_no</code></summary>

#### Scenario

Large group: 20 voters on a yes/no question.

        SCENARIO: A class of 20 students votes on whether to have a study
        session. 12 yes (mix of named/anonymous), 6 no, 2 abstain.

        EXPECTATION: Percentages and counts are correct at scale.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Yes wins | &#x2705; |  |
| 12 yes votes | &#x2705; |  |
| 6 no votes | &#x2705; |  |
| 2 abstentions | &#x2705; |  |
| 20 total votes | &#x2705; |  |
| 60% yes | &#x2705; |  |

#### Social Evaluation

> Scales cleanly. Mix of named/anonymous voters works at 20-person scale.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "c6bbe294-6c5d-45c8-943e-9477e2773d09",
    "title": "Study session before the exam?",
    "poll_type": "yes_no",
    "created_at": "2026-04-03T19:13:15.463220+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_ten_option_ranked_choice</code></summary>

#### Scenario

Large ranked choice: 10 options, 8 voters.

        SCENARIO: A group has too many ideas. 10 restaurant options,
        8 voters with varied preferences. Tests IRV at higher option counts.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Winner determined | &#x2705; |  |
| Multiple elimination rounds | &#x2705; |  |

#### Social Evaluation

> With 10 options and 8 voters, IRV took 9 rounds to find winner: Thai. Italian and Thai appear frequently across ballots — the winner likely has broad second/third choice support, which is the whole point of ranked choice.

#### Critique

_This test reveals an interesting system property worth documenting. With 10 options and 8 voters, IRV took 9 rounds to find winner: Thai. Italian and Thai appear frequently across ballots — the winner likely has broad second/third choice support, which is the whole point of ranked choice. (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "c765c343-20dd-4665-a6f4-09967112f08c",
    "title": "Restaurant for team dinner?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T19:13:17.635908+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_everyone_flexible</code></summary>

#### Scenario

Dinner party: 5 people say yes with no constraints.

        SCENARIO: Simple case — everyone's available and flexible about
        group size. No constraints to conflict.

        EXPECTATION: All 5 should be included.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| All 5 participate | &#x2705; |  |

#### Social Evaluation

> No constraints means everyone's in. Simple and correct.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "This test reveals an interesting system property worth documenting. With 10 options and 8 voters, IR..." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "be9758ae-e9c0-4935-91c2-de8772c36706",
    "title": "Dinner at my place Saturday?",
    "poll_type": "participation",
    "created_at": "2026-04-03T19:13:18.605311+00:00",
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
      "cf37ba15-e281-49c4-bbd0-997d59cd3d78",
      "fe41b013-6ca5-4f89-94d2-b0bc8ae9f5dd",
      "7e9906e8-0247-413c-8c52-1199e67707ff",
      "df76d0f3-3cff-4181-bd48-3a56cf8d635d",
      "4e5f69ef-05ec-4e99-bdf4-a4ce0583b334"
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_introvert_vs_extrovert</code></summary>

#### Scenario

Dinner party: introvert wants small group, extrovert wants big group.

        SCENARIO: Alice only wants to come if it's intimate (max 3 people).
        Bob only wants to come if it's a party (min 5 people). Three others
        are flexible. The poll allows 1-10 participants.

        SOCIAL QUESTION: The algorithm prioritizes flexible voters. Alice
        (max=3) is restrictive and may get deprioritized. Is that fair?
        She has a legitimate social preference.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| At least 3 participants | &#x2705; |  |
| Flexible voters included | &#x2705; |  |

#### Social Evaluation

> Neither constrained voter was included. The algorithm prioritized the 3 flexible voters, giving count=3. Alice (max=3) *could* fit, but the algorithm may not have tried her. Worth investigating if the algorithm should attempt to include constrained voters after selecting the flexible core.

#### Critique

_This test reveals an interesting system property worth documenting. Neither constrained voter was included. The algorithm prioritized the 3 flexible voters, giving count=3. Alice (max=3) *could* fit, but the algorithm may not have tried her. Worth investigating if the algorithm should attempt to include constrained voters after selecting the flexible core. (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "30ea1957-aade-4805-b4d8-6e7508a79ba4",
    "title": "Dinner party Saturday?",
    "poll_type": "participation",
    "created_at": "2026-04-03T19:13:19.434118+00:00",
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
      "4bb5a96d-845c-460c-bd8d-3feba1f04ed7",
      "a0cf9875-cb76-4840-a40c-c81f8182b0a0",
      "d493eeab-0ddf-4e8b-99de-ce40dc3de52c"
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

<details>
<summary><span style="background:#dc3545;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIL</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_minimum_not_met</code></summary>

#### Scenario

Dinner party: not enough people to meet the minimum.

        SCENARIO: Poll requires minimum 4 participants, but only 2 people
        say yes.

        EXPECTATION: The event doesn't happen (0 participants).

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| No participants (minimum not met) | &#x274C; |  |

#### Social Evaluation

> Event correctly cancelled — not enough interest. Better to cancel cleanly than to have 2 people show up expecting a group of 4+.

#### Critique

_Technical failure detected: . This needs investigation before social evaluation is meaningful. (Previous assessment: "This test reveals an interesting system property worth documenting. Neither constrained voter was in..." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "9bb13d5f-1475-4da8-a350-b4aba2ae36cc",
    "title": "Dinner party?",
    "poll_type": "participation",
    "created_at": "2026-04-03T19:13:20.228865+00:00",
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
      "a0e85263-98d1-4107-8c77-a3b911cab0a2",
      "37c1d270-9d51-481b-bce5-5fcc31c88c3d"
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_mixed_yes_no_and_abstain</code></summary>

#### Scenario

Dinner party: mix of yes, no, and abstain votes.

        SCENARIO: 3 yes, 2 no, 1 abstain. Min is 2.

        EXPECTATION: Only yes voters can be participants. No and abstain
        voters are excluded from the participant pool.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| 3 participants | &#x2705; |  |
| All are yes voters | &#x2705; |  |

#### Social Evaluation

> Only willing participants included. No/abstain correctly excluded.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "Technical failure detected: . This needs investigation before social evaluation is meaningful...." — assessment updated.)_


</details>

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_exactly_one_person_event</code></summary>

#### Scenario

Solo activity: 'Anyone want my extra concert ticket?'

        SCENARIO: One ticket available (max=1). Three people want it.
        With max_participants=1, the poll auto-closes after the first
        "yes" vote, so only the first responder gets in.

        SOCIAL QUESTION: Is first-come-first-served fair, or should it
        be random? FCFS rewards people who check their phone more often.

        NOTE: The auto-close behavior means later voters can't even submit.
        This test verifies that the auto-close works correctly for this case
        and that the first voter is selected.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Poll auto-closed | &#x2705; |  |
| Exactly 1 participant | &#x2705; |  |
| First voter wins | &#x2705; |  |

#### Social Evaluation

> 'Eager Eve' got the ticket. With max_participants=1, the poll auto-closes immediately after the first 'yes' vote — later respondents can't even submit. This is effectively first-come-first-served enforced by the system. Transparent, but may feel unfair to people in different time zones or who check their phone less frequently.

#### Critique

_This test reveals an interesting system property worth documenting. 'Eager Eve' got the ticket. With max_participants=1, the poll auto-closes immediately after the first 'yes' vote — later respondents can't even submit. This is effectively first-come-first-served enforced by the system. Transparent, but may feel unfair to people in different time zones or who check their phone less frequently. (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "winner": "Eager Eve"
}
```

</details>

</details>

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_driver_needs_riders</code></summary>

#### Scenario

Carpool: driver needs at least 2 riders to justify the trip.

        SCENARIO: A driver is offering a carpool to an event but only
        wants to drive if at least 2 other people are coming.

        EXPECTATION: If 2+ people say yes, the carpool happens. Otherwise
        it doesn't, and the driver knows not to bother.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| 3 participants (within capacity) | &#x2705; |  |

#### Social Evaluation

> Carpool happens with 3 riders. Driver gets clear confirmation.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "This test reveals an interesting system property worth documenting. 'Eager Eve' got the ticket. With..." — assessment updated.)_


</details>

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_conflicting_rider_constraints</code></summary>

#### Scenario

Carpool: riders have conflicting preferences about group size.

        SCENARIO: Car seats 4. Rider A only wants to go with at least 3
        others (min=3). Rider B wants a quiet ride (max=2). Riders C and D
        are flexible.

        The algorithm must choose between satisfying A or B.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| At least 2 participants | &#x2705; |  |
| Both flexible riders included | &#x2705; |  |

#### Social Evaluation

> Participants: ['Flex Chris', 'Flex Dana', 'Social Sam']. The algorithm prioritizes flexible voters, then tries to include constrained voters. Social Sam (min=3) and Quiet Quinn (max=2) have fundamentally incompatible preferences — the system can satisfy at most one of them.

#### Critique

_This test reveals an interesting system property worth documenting. Participants: ['Flex Chris', 'Flex Dana', 'Social Sam']. The algorithm prioritizes flexible voters, then tries to include constrained voters. Social Sam (min=3) and Quiet Quinn (max=2) have fundamentally incompatible preferences — the system can satisfy at most one of them. (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_

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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_suggestion_to_ranked_choice_pipeline</code></summary>

#### Scenario

Full pipeline: suggestions collected, then ranked.

        SCENARIO: A team is picking a name for their project. Phase 1:
        everyone suggests names (suggestion poll). Phase 2: the top
        suggestions go to a ranked choice vote.

        This simulates the manual version of the pipeline (creator
        creates the follow-up ranked choice poll themselves).

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Top suggestions carried forward | &#x2705; |  |
| Ranked choice produced winner | &#x2705; |  |
| Follow-up link preserved | &#x2705; |  |

#### Social Evaluation

> Two-phase process: brainstorm surfaced top ideas, ranked choice picked 'Moonshot'. This mimics natural group decision-making: diverge (suggest), then converge (rank).

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "This test reveals an interesting system property worth documenting. Participants: ['Flex Chris', 'Fl..." — assessment updated.)_


</details>

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_auto_preferences_workflow</code></summary>

#### Scenario

Auto-preferences: suggestion poll automatically creates a follow-up ranked choice.

        SCENARIO: Creator enables auto_create_preferences. When the
        suggestion poll closes, the server automatically creates a
        ranked choice poll with the suggestions as options.

        EXPECTATION: The follow-up poll exists, is linked, and contains
        the right options.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Suggestion poll is closed | &#x2705; |  |
| Follow-up is ranked_choice | &#x2705; |  |
| Follow-up linked to original | &#x2705; |  |
| Follow-up has options from suggestions | &#x2705; |  |

#### Social Evaluation

> Auto-preferences seamlessly creates the second phase. Users don't need to manually extract suggestions and create a new poll — the workflow handles the transition automatically.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_


</details>

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_fork_preserves_context</code></summary>

#### Scenario

Fork: someone creates a variant of an existing poll.

        SCENARIO: Original poll asks "Best pizza topping?" with options.
        Someone forks it to ask "Best pizza topping for KIDS?" — same
        concept, different audience.

        EXPECTATION: Fork link is preserved. Both polls function independently.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Fork linked to original | &#x2705; |  |
| Both have winners | &#x2705; |  |
| Polls are independent (different option sets) | &#x2705; |  |

#### Social Evaluation

> Fork maintains provenance while allowing the new poll to diverge. Different options, different voters, independent results — but the link back to the original provides context for why this poll exists.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_


</details>

<details>
<summary><span style="background:#dc3545;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIL</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_follow_up_after_tie</code></summary>

#### Scenario

Follow-up: tie leads to a runoff with fewer options.

        SCENARIO: A yes/no poll ties 3-3. The creator creates a follow-up
        with more context to break the tie.

        EXPECTATION: The follow-up is linked and can reference the tied result.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| First poll tied | &#x2705; |  |
| Second poll has a winner | &#x274C; |  |
| Follow-up linked | &#x2705; |  |

#### Social Evaluation

> Following up a tie with more context is a natural group behavior. The link between polls preserves the decision history: 'We tied, so we added more info and voted again.' Result: tie (3-3).

#### Critique

_Technical failure detected: . This needs investigation before social evaluation is meaningful. (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_


</details>

## Tests.Ranked Preferences

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_clear_favorite</code></summary>

#### Scenario

Movie night: one film is everyone's top or second pick.

        SCENARIO: Five friends rank movies. "Dune" is everyone's first or
        second choice, even though first-place votes are split.

        EXPECTATION: Dune should win. IRV should surface the consensus
        pick even when first-choice votes are fragmented.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Dune wins | &#x2705; |  |

#### Social Evaluation

> Dune is the consensus pick — universally liked even if not everyone's #1. IRV correctly identifies the 'least objectionable' choice.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "Technical failure detected: . This needs investigation before social evaluation is meaningful...." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "27b70cd2-0633-4a23-acd1-fa158b377727",
    "title": "What movie should we watch?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T19:13:28.333811+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">INSIGHT</span> <code>test_condorcet_scenario</code></summary>

#### Scenario

Movie night: the group is polarized but there's a compromise option.

        SCENARIO: Half the group loves action, half loves comedy.
        A dramedy (mix) is everyone's second choice. In a simple
        plurality vote, the dramedy would lose. Does IRV find it?

        This is the classic case where ranked choice voting should
        outperform simple majority.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| A winner was determined | &#x2705; |  |

#### Social Evaluation

> IRV picked 'Romantic Comedy' instead of the compromise 'Dramedy'. This can happen when the compromise is eliminated first (having fewest first-place votes). This is a known limitation of IRV — it doesn't always find the Condorcet winner.

#### Critique

_This test reveals an interesting system property worth documenting. IRV picked 'Romantic Comedy' instead of the compromise 'Dramedy'. This can happen when the compromise is eliminated first (having fewest first-place votes). This is a known limitation of IRV — it doesn't always find the Condorcet winner. (Previous assessment: "System behaves as expected for this social scenario...." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "c6fbcd44-055c-4204-9935-4f1825a6e402",
    "title": "Movie genre tonight?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T19:13:29.006646+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_spoiler_effect</code></summary>

#### Scenario

Movie night: a niche option splits the vote of similar options.

        SCENARIO: Two sci-fi films and one comedy. Sci-fi fans split
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

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "This test reveals an interesting system property worth documenting. IRV picked 'Romantic Comedy' ins..." — assessment updated.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "f6302ed6-19d4-4f16-ac01-1f7dd7cde60e",
    "title": "Movie pick?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T19:13:29.883234+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_partial_rankings</code></summary>

#### Scenario

Movie night: some people only rank their top picks.

        SCENARIO: Not everyone ranks all options. Some people only care
        about their top 1-2 choices and don't bother ranking the rest.

        EXPECTATION: Partial ballots should still count. Exhausted ballots
        (all ranked options eliminated) are handled gracefully.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Winner determined | &#x2705; |  |

#### Social Evaluation

> Partial rankings are a natural expression of preference: 'I only care about these options.' The system should respect this rather than forcing voters to rank options they're indifferent about.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "a0a69513-5eb6-4df4-8706-727bb6db7a26",
    "title": "Movie?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T19:13:30.783987+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_unanimity</code></summary>

#### Scenario

Movie night: everyone agrees on the same first choice.

        SCENARIO: Rare but it happens — everyone wants the same thing.
        Should resolve in round 1 with no eliminations.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| The Matrix wins | &#x2705; |  |
| Decided in round 1 | &#x2705; |  |

#### Social Evaluation

> Unanimous agreement resolved instantly. No wasted rounds.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "a216c3c9-1da2-4138-b0d1-142d37784ad9",
    "title": "Movie?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T19:13:32.800654+00:00",
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

<details>
<summary><span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">PASS</span> <span style="background:#28a745;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">FAIR</span> <code>test_borda_tiebreaker</code></summary>

#### Scenario

Team retreat: three-way tie in first-place votes, broken by Borda.

        SCENARIO: 9 team members, 3 destinations. Each destination has
        exactly 3 first-place votes. The Borda count (positional scoring)
        breaks the tie by considering all ranking positions.

        EXPECTATION: The destination with the best overall rankings wins,
        not just the one with the most first-place votes.

#### Technical Results

| Assertion | Result | Detail |
|-----------|--------|--------|
| Winner determined | &#x2705; |  |
| Mountain Lodge wins (best overall ranking) | &#x2705; | Actual winner: Mountain Lodge |

#### Social Evaluation

> Mountain Lodge is ranked 1st or 2nd by everyone — the Borda tiebreaker correctly identifies it as the most broadly acceptable choice.

#### Critique

_System behaves as expected for this social scenario. (Previous assessment: "System behaves as expected for this social scenario...." — assessment unchanged.)_

<details>
<summary>Raw data</summary>

```json
{
  "results": {
    "poll_id": "900ed44f-49a4-461d-85e3-f540194c7d50",
    "title": "Team retreat destination?",
    "poll_type": "ranked_choice",
    "created_at": "2026-04-03T19:13:33.494069+00:00",
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
