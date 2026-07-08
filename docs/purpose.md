# Why This Project Exists (Living Document)

> **Status: living.** This is the reference for what WhoeverWants is *for*. Update it
> whenever goals, metrics, or the theory of change shift, and consult it when deciding
> what to build next. Substantive changes go in the Decision Log at the bottom.
>
> Last substantive update: 2026-07-08 (initial version).

## Mission

Make real-world social events happen more often — for the owner and his circle first,
and for anyone who wants a more social life — by making organizing them so easy that
events stop dying in coordination.

People generally want more social contact than they get. The desire is there; the
events don't happen because the *process* of making them happen is effortful,
ambiguous, and socially risky. This project succeeds when it converts vague social
intent ("we should hang out") into events that actually occurred, at a much higher
rate than group chats do.

## Canonical user stories

These six concrete desires are the reference test suite for product decisions. A
feature matters to the degree it moves one of these from "hard" to "trivial."

1. **Movie, soon.** "I want to see a movie soon" — open which movie, who with, when.
2. **Specific movie, soon.** "I want to see *Movie X* soon" — fixed what; open who/when/where.
3. **Drinks with a specific friend, soon.** 1:1, fixed who; open when/where.
4. **Drinks with a quorum.** "At least 2 of these 3 friends, this weekend." Conditional on turnout.
5. **Dinner, 2–4 others, nearby restaurant, soon.** Bounded group size, open who; place + time to decide.
6. **Standing ritual.** "2–6 people on my porch for breakfast and coffee every Friday before work." Recurring, capped, near-zero ceremony.

## Friction catalog — why these events die today

The enemy list. Every feature should be able to name which of these it attacks.

1. **Engagement collapse.** Invitees ignore the planning process — usually not because
   they don't want to come, but because responding is work with no deadline and no
   visible cost to silence.
2. **Organizer exhaustion.** The person who cares pays for everything: picking options,
   chasing responses, resolving ties, announcing, reminding. Most people stop
   organizing after paying this cost a few times.
3. **Interest/availability opacity.** You can't see who would be up for what, when, or
   with whom — so you either over-ask (spam people) or under-ask (miss people who
   would have loved to come).
4. **Idea scarcity.** "What should we even do?" Realistic, concrete, nearby options are
   effortful to assemble.
5. **The ask is socially risky.** Direct invitations expose you to rejection; broadcast
   ones can feel needy. Ambiguity ("we should hang out sometime!") is the safe move,
   and it resolves to nothing.
6. **The decided-but-not-executed gap.** Even when a plan is agreed, it isn't on
   anyone's calendar, nobody has committed, no reminder fires — and it quietly
   evaporates.
7. **Rescheduling churn.** One dropout triggers a full renegotiation, which repays
   frictions 1–2 from scratch.

(1–4 are the owner's original list; 5–7 accreted from analysis. Extend as we learn.)

## Theory of change

- **The unit of value is an event that happened.** Not a poll created, not a decision
  reached. Everything upstream (groups, polls, notifications) is instrumental.
- **Friction asymmetry.** The organizer will tolerate some cost; invitees will tolerate
  almost none. Anything an invitee must do has to be doable in seconds from where they
  already are (a text thread, a notification, a lock screen).
- **Speed beats optimality.** A good-enough plan decided in hours beats an optimal plan
  decided in days. Most social decisions among ≤6 people are low-stakes; the cost of a
  slightly-worse restaurant is trivial next to the cost of the dinner not happening.
- **Defaults over decisions.** Every knob the organizer must set is a tax. Sane
  defaults with escape hatches, never mandatory configuration.
- **Rituals compound.** One standing weekly event (story 6) produces more realized
  social contact than a dozen ad-hoc coordinations, and it amortizes the organizing
  cost to near zero. Recurrence is strategic, not a nice-to-have.
- **Meet people where they are.** No accounts required to respond; links, iMessage,
  notifications. The app must beat the group chat *from inside the group chat*.

## North-star metric

**Realized events per active user per month** — an event that was decided *and* (as
best we can tell) actually happened with ≥2 attendees.

Supporting funnel metrics:

| Stage | Question it answers | Attacks friction |
|---|---|---|
| Intent → invite sent | Does the app help you start? | 3, 4, 5 |
| Invite → response rate, time-to-respond | Do invitees engage? | 1 |
| Responses → decision reached | Does the mechanism converge? | 2 |
| Decision → happened | Does the plan survive contact with reality? | 6 |
| Happened → repeated | Do events become rituals? | 2 (amortization) |

The last two stages are currently **unmeasured** — a gap in itself (see below).

## Current state assessment — 2026-07-08

### What's right (protect these)

- **Zero-friction responding.** No accounts; a link grants access; a name is the only
  identity ask; voting works inside the iMessage bubble without opening anything. This
  is the crown jewel and the strongest attack on friction 1. Any feature that adds a
  signup wall or app-install requirement to the *invitee* path should be rejected by
  default.
- **Atomic multi-question polls.** "Plan the whole night in one link" (restaurant +
  time in one ballot) is a genuinely better shape than serial group-chat questions.
  Attacks friction 2.
- **Real-world grounding.** Alamo showtimes, OSM restaurant/location search with
  distances — options are concrete and actionable, not abstract strings. Attacks
  friction 4. Story 2 (specific movie, soon) is arguably the best-served story today.
- **Quorum machinery.** Min-participants viability gate, per-voter conditional
  attendance ("count me only if ≥N total"), attendance leeway, plus-ones. Story 4 is
  modeled better than in any mainstream tool.
- **Recurrence.** Story 6 is mechanically supported: recurring polls materialize
  instances on schedule; limited-supply caps headcount.
- **Engagement plumbing.** Push notifications that carry the outcome in the copy,
  badge with a to-do model, vote reminders relative to the deadline, To Do / Relevant /
  Old triage, honest viewed-vs-responded counts ("6 viewed · 1 responded" is real
  social information).
- **The group as a persistent decision space** (explicitly not a chat) is the right
  container for recurring circles.

### What's wrong / missing (ranked by expected impact on the mission)

1. **The app ends where the event begins.** The product's terminal state is
   "Decided: Thai · Sat 7 PM" — a push notification. There is no commitment/RSVP step
   after the decision, no add-to-calendar (.ics / calendar deep link — note
   `docs/calendar-integration.md` is the *input* side, availability pre-fill, not
   this), no day-of reminder, no "did this happen?", no one-tap "same again next
   week." Friction 6 is unaddressed, and it is the last mile of the entire mission:
   everything upstream can work perfectly and the event still evaporates here.
2. **Interest/availability opacity (friction 3) is untouched.** Every flow assumes you
   already know who to ask — coordination starts at a group. Stories 1, 3, and 5 stall
   at "who do I even send this to?" There are no standing intents ("always up for
   climbing", "free most weeknights"), no private interest expression, no overlap
   matching. Today this is a *coordination* tool; the mission likely needs a
   *matchmaking* layer on top. Hardest gap, most differentiating.
3. **Decision quality is over-served; decision speed under-served.** IRV vs Borda vs
   consensus scoring, two-phase availability→preference flows, prephase cutoffs,
   attendance leeway — intellectually strong, but each knob taxes the organizer
   (friction 2) and each extra phase taxes invitees (friction 1). Our own social tests
   flagged two-round time-poll drop-off as trust-eroding. For ≤6 people the default
   path should be: one round, sane defaults, auto-close, done.
4. **Tiny-group cases lose to a text message.** Story 3 (drinks with one friend) via
   create-group → create-poll → share link → wait is heavier than "drinks thu or fri?"
   in iMessage. For n=2–3 the app must be *faster than typing the question* or people
   will (correctly) not use it. The iMessage compose path is the right beachhead.
5. **Outcomes are unmeasured.** We never learn whether the dinner happened, so we
   cannot optimize realized events. No post-event signal, however lightweight, exists.
6. **The ask still feels like an ask.** Nothing reduces the social risk of initiating
   (friction 5). Speculative territory: intents that reveal only on mutual interest;
   open invitations with no named invitees (the explore feed is a seed of this).

### Verdict

The engine — decide things with minimal invitee friction — is strong and unusually
well built. The mission gap is at both ends of the engine: **before** it (whom to ask,
what to propose: intent capture and matching) and **after** it (decision → committed,
calendared, reminded, repeated event). The middle needs simplification more than it
needs features.

## Open questions

- What "did it happen?" signal costs attendees approximately zero? (Partially answered
  by presumed-in semantics: no back-outs + no cancel ≈ happened; an explicit post-event
  ping may still add precision.)
- Should stories 1/3/5 be served by templates over the existing poll machinery, or by
  a new intent-first flow?

## Decision log

- **2026-07-08** — Document created. North-star metric proposed (realized events per
  active user per month) — pending owner confirmation.
- **2026-07-08** — Owner chose **decision → event conversion** as the next frontier
  (over intent/matchmaking, default-path simplification, and measure-first). Direction:
  after a poll decides, it becomes a real event — commitment/RSVP state, add-to-
  calendar, day-of reminder, post-event "did it happen? / run it back" (which doubles
  as the missing outcome measurement). Intent/matchmaking and simplification remain
  queued, not rejected.
- **2026-07-08** — Commitment semantics decided: **presumed in, with reminder and a
  chance to back out.** A voter whose availability/vote matches the decided outcome is
  on the attendee list by default (no extra RSVP tap — friction 1 wins); the day-of
  reminder push doubles as the escape hatch ("still in / can't make it"), so
  commitment hardens passively and back-outs are captured as a signal. Explicit
  opt-in RSVP was rejected as re-taxing invitees at the historical drop-off point.
- **2026-07-08** — Audience decided: **the owner's circle first** for the next 3–6
  months. Optimize for real events among real friends (success = the six stories
  happening in real life); iPhones/iMessage may be assumed, scrappy is fine, real
  usage drives the roadmap. Generalize later from what demonstrably works.
