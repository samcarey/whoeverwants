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
