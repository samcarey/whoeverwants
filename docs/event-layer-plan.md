# Event Layer — Decision → Event Conversion (Phased Plan)

> **Why:** see `docs/purpose.md`. The app's terminal state today is a "Decided:
> Thai · Sat 7 PM" push; the mission's unit of value is an event that *happened*.
> This plan closes that last mile. Decisions already made (purpose.md Decision
> Log, 2026-07-08): commitment is **presumed in, with reminder and a chance to
> back out**; audience is **the owner's circle first** (iPhone/iMessage
> assumptions allowed).
>
> **Status: Phase 1 implemented** (migration 146 + `services/events.py` +
> endpoints + `PollEventCard`; landed via PR #779). Phases 2–3 not started.
> This doc is updated as phases land.

## Concepts

An **event** is a *derived view* of a decided poll — not a new addressable
entity. A poll "has an event" when it is **closed**, contains at least one
`time`/`showtime` question whose results produced a **winning slot**, and the
event wasn't cancelled (`time_event_cancelled`). The event's time is the winning
slot; its "what/where" is the poll's other decided outcomes (existing
`_poll_decision_summary` machinery). Keeping the poll as the unit preserves the
Addressability paradigm (the poll stays the URL; the event card renders on the
poll detail page) and means zero migration of existing decided polls — they all
retroactively get events.

**Attendees (presumed in).** Derived from votes against the winning slot:

- `time` question with availability: voters whose `voter_day_time_windows`
  cover the winning slot (`_voter_available_at`).
- `time` without availability windows on the vote, and `showtime`: non-abstain
  voters who did **not** mark the winning slot "can't attend" (`disliked_slots`).
- Plus-ones ride along with their submitter (they were counted in the tally).
- Abstains and no-shows-in-the-poll are not presumed in.

**Overrides** (the back-out / opt-in) live in `event_attendance(poll_id,
browser_id, status ∈ ('in','out'), updated_at)` — migration 146, mirroring
`poll_follow_state` exactly: no row = presumed state; reads are account-aware
with recency-wins across a person's linked browsers; writes are browser-keyed.
`'out'` = "can't make it" (back-out); `'in'` from a non-voter = late opt-in
(a member who never voted can still join the event).

## Phase 1 — event object + attendance (THIS PHASE)

- **Migration 146**: `event_attendance` table (above).
- **`services/events.py`**: `poll_event(conn, poll_id, *, caller_browser_ids)`
  → winning slot + attendee list (name, status, is_viewer) + `in_count` +
  `viewer_status`. Person identity = `COALESCE(user_id, browser_id)` via
  `user_browsers` (same union as everywhere else); recency-wins override merge
  mirrors `effective_follow_states`.
- **Endpoints**: `GET /api/groups/by-route-id/{route}/poll/{ref}/event`
  (member-gated, mirrors `/voter-identities`) and
  `POST /api/polls/{poll_id}/attendance {status}` (browser-keyed upsert,
  mirrors `/follow-state`).
- **FE**: an event card at the top of the decided poll detail page — 📅 slot
  label, "N going", attendee chips (You first), and a toggle: "Can't make it"
  when you're in, "I'm in" when you're out/not derived. No new routes.
- Known v1 limits (documented, acceptable): legacy votes with NULL `browser_id`
  are presumed in but can't self-toggle; a submitter's back-out removes their
  whole party (plus-ones aren't individually toggleable); attendee derivation
  ignores `voter_min_participants` conditionality (rare; refine later).

## Phase 2 — calendar + day-of reminder (the escape hatch)

- **Add-to-calendar**: `GET /api/polls/{short_id}/event.ics` (identity-free,
  capability = the short_id, like the image endpoints) + a Google Calendar URL.
  Button on the event card and a link in the poll-closed push. Note: distinct
  from `docs/calendar-integration.md`, which is the *input* side (availability
  pre-fill).
- **Day-of reminder**: new tick pass — for events starting within the lead
  window, push to current attendees ("Tonight 7 PM · Thai Palace — still in?"),
  one-shot per (poll, browser) via an `event_reminders_sent` ledger (the
  `vote_reminders_sent` pattern). The push deep-links to the event card where
  the back-out toggle lives — this is the "reminder + chance to back out" that
  hardens commitment passively.

## Phase 3 — close the loop (run it back + measurement)

- **Realized-event recording**: when the slot end (+ the existing
  `_SLOT_PAST_GRACE`) passes with ≥2 effective attendees and no cancel, stamp
  the poll realized (tick pass; the north-star metric becomes a SQL query).
  Back-outs already captured by Phase 1 give the "did it fall apart?" signal.
- **Run it back**: post-event push/affordance to the creator — one tap
  duplicates the poll (existing `?duplicate=` flow) or converts it to a
  recurrence (migration 141 machinery), turning one-offs into rituals.

## Explicitly out of scope (for now)

- Intent/matchmaking layer (queued in purpose.md — next frontier after this).
- Editing the decided time/place on the event (close + recreate remains the
  do-over path).
- Per-plus-one attendance, reschedule flows, external (non-member) guests.
