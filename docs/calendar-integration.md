# Calendar Integration — Auto-Block Busy Times on the Availability Form

> **Status: PLAN ONLY. Nothing here is implemented yet.** This document is the
> phased design for letting a signed-in user connect their Google (Phase 1) or
> Apple (Phase 2) calendar so that, when they fill out a **time poll's
> availability form**, the windows they're already busy in are pre-subtracted
> for them to review.

## Goal

Today a voter answering a `time` question hand-carves their availability inside
the creator's proposed day windows (`components/DayTimeWindowsInput.tsx`, voter
form — split slots + ghost re-add rows; see the "Voter Availability: Split Slots
+ Ghost Re-add" section in `CLAUDE.md`). The ask: a voter who has connected a
calendar can tap **"Pull in my calendar"** and have the form pre-split each
proposed window around the events they're already busy in — fully reviewable,
never auto-submitted.

The connection is **opt-in and manually enabled from the Settings page**, only
visible **after the user has signed in with the matching provider**. It is a
distinct capability from sign-in: signing in with Google/Apple proves identity
(OpenID Connect `id_token`); reading a calendar is a *separate* authorization
grant the user must explicitly add.

## Why this is two very different features

The current OAuth integration (`lib/oauth.ts`, `server/services/oauth.py`,
`server/routers/auth.py`) requests only `email` / `profile` scopes and consumes
the **ID token** — pure authentication. It never requests, stores, or refreshes
an **access token**, and it has no calendar scopes. So neither phase reuses much
of the existing OAuth plumbing beyond "we know which provider this account is
linked to."

| | **Google (Phase 1)** | **Apple (Phase 2)** |
|---|---|---|
| API surface | Google Calendar REST API (`freebusy.query`) | EventKit — **on-device only**, no cloud API |
| Where it runs | Server-side (refresh token → access token → freebusy) | In the Capacitor iOS app, client-side JS → native plugin |
| Platforms | Web, PWA, iOS app, Android | **iOS Capacitor app only** |
| Privacy | `freebusy` returns busy intervals, **no event titles** | EventKit returns full events; we read only times |
| Big non-code hurdle | **Google OAuth verification / CASA security assessment** for the sensitive calendar scope | Capacitor EventKit plugin + `NSCalendarsUsageDescription` + TestFlight rebuild |
| Reuses sign-in? | No — new authorization-code + offline flow | No — EventKit is unrelated to Sign in with Apple |

The shared, reusable piece is the **window-subtraction math** (Phase 0), which
both providers feed.

---

## Phase 0 — Shared foundation (provider-agnostic)

Build the parts that don't care where the busy intervals come from. This lands
first so both Phase 1 and Phase 2 plug into a stable seam.

1. **`BusyInterval` type** — `{ start: ISO8601, end: ISO8601 }`, expressed in the
   poll's timezone. A provider adapter's only job is to return
   `BusyInterval[]` for a given `[rangeStart, rangeEnd]`.
2. **`subtractBusyFromWindows(dayTimeWindows, busy)` pure helper** in
   `lib/timeUtils.ts` (next to `pickNextTimeWindow` / `DEFAULT_TIME_WINDOW`).
   For each creator-defined day window, remove the sub-ranges that overlap any
   busy interval, producing 0..N split windows — the exact shape the voter form
   already renders (`TimeWindow[]` per day). Fully covered windows collapse to a
   ghost re-add row (the existing "no current slot overlaps this creator window"
   path). Pure + unit-tested in `tests/__tests__/` (mirror the
   `pickNextTimeWindow` / `hasInvalidVoterWindows` test style).
3. **"Pull in my calendar" affordance** on the voter availability form
   (`components/QuestionBallot/TimeBallotSection.tsx`, availability phase only).
   Hidden unless the user has an *active calendar connection* (Phase 1/2 set a
   flag). On tap: fetch busy intervals for the poll's date span, run
   `subtractBusyFromWindows`, and apply the result through the existing
   `useDayTimeWindowsState` setters so every change is a normal, editable form
   edit. **Never auto-submits** — the user reviews and presses Submit.
4. **Connection-state surface** — a single FE predicate
   `getCalendarConnection()` → `{ provider: 'google' | 'apple' | null, ... }`
   that both Settings and the availability form read, so the form stays
   provider-agnostic.

No schema, no provider SDKs in this phase — just the type, the math, the test,
and the (initially always-disconnected) affordance.

---

## Phase 1 — Google Calendar (web-first, all platforms)

### User-facing flow
1. User signs in with Google (existing flow) — or already has a Google identity.
2. Settings → **"Connect Google Calendar"** row appears (only when the account
   has a `google` identity in `user_identities`). Tapping it runs the calendar
   **authorization** flow (separate from sign-in).
3. Once connected, the row shows **"Google Calendar connected — Disconnect"**,
   and the availability form's "Pull in my calendar" button activates.
4. Disconnect revokes the grant and deletes the stored refresh token.

### Technical pieces
1. **Authorization-code flow with offline access.** New flow distinct from the
   id_token sign-in: request `https://www.googleapis.com/auth/calendar.freebusy`
   (preferred — busy/free only, no event contents) with
   `access_type=offline` + `prompt=consent` to obtain a **refresh token**.
   - Web/PWA: Google Identity Services code flow (popup → code → server exchange).
   - iOS Capacitor: the same code flow via the in-app browser; the
     `@capgo/capacitor-social-login` *sign-in* path does **not** cover calendar
     scopes, so this is its own authorize call.
2. **Server: token exchange + storage.** Exchange the code for access + refresh
   tokens server-side. Store the **refresh token encrypted at rest** in a new
   table:
   ```
   calendar_grants(
     user_id        uuid references users(id) on delete cascade,
     provider       text check (provider in ('google','apple')),
     refresh_token  text,            -- encrypted; null for apple (on-device)
     scope          text,
     connected_at   timestamptz,
     primary key (user_id, provider)
   )
   ```
   Next migration number: **129** (`129_calendar_grants_up.sql` / `_down.sql`).
   Encryption key from an env var on each tier's `.env.api` (mirror the
   `RESEND_API_KEY` / APNS-key handling — never in git).
3. **Server: freebusy endpoint.** `POST /api/calendar/freebusy`
   `{ range_start, range_end }` → resolves the caller's grant, refreshes the
   access token, calls Google `freebusy.query`, returns `BusyInterval[]`. 503
   when no grant. Signed-in only.
4. **Server: connect / disconnect / status endpoints.**
   - `POST /api/calendar/google/connect` `{ code }` — exchange + store grant.
   - `DELETE /api/calendar/google` — revoke at Google + delete grant.
   - `GET /api/calendar/me` — `{ provider | null }` for the Settings + form
     predicate.
5. **FE: Settings row + connection state** wired into `getCalendarConnection()`.
6. **Provider adapter** implements the Phase 0 `BusyInterval[]` contract by
   calling `POST /api/calendar/freebusy`.

### The long pole: Google OAuth verification
The `calendar.freebusy` / `calendar.readonly` scopes are **sensitive/restricted**.
Google requires an **OAuth app verification** (and for restricted scopes, an
annual **CASA security assessment** — can cost money + take weeks) before users
outside the ~100-user test allowlist can grant them. **Start this process early;
it gates the public launch, not the code.** Until verified, ship behind the test
allowlist on `latest.whoeverwants.com`.

### Out of scope for Phase 1
- Reading event titles/details (we deliberately use `freebusy`).
- Writing events back to the calendar (e.g. adding the winning slot).
- Calendar selection (use the primary calendar only).
- Background/periodic sync — fetch is on-demand at "Pull in my calendar" tap.

---

## Phase 2 — Apple Calendar (iOS Capacitor app only)

### Why it's separate and later
There is **no cloud Apple Calendar API.** Apple Calendar is reachable only via
**EventKit**, an on-device native iOS framework. Consequences:
- Works **only inside the Capacitor iOS app** — never web, PWA, or Android.
- The busy-interval read happens **on the device**, in JS via a native plugin,
  then `subtractBusyFromWindows` runs client-side before submit. The server
  `calendar_grants` row for apple carries **no token** (it's just a
  "this user enabled on-device calendar" flag for the Settings UI; the real
  permission lives in iOS).
- "Sign in with Apple" grants **nothing** here — unrelated capability.

### Technical pieces
1. **Capacitor EventKit plugin.** Either adopt a maintained community plugin or
   write a small colocated one (pattern: `AppBadgePlugin` / `ClipboardUrlPlugin`
   in `ios/App/App/AppDelegate.swift`). Exposes `requestAccess()` +
   `getBusyIntervals({ start, end })` → `BusyInterval[]` using `EKEventStore`.
2. **`NSCalendarsUsageDescription`** in `ios/App/App/Info.plist` with a
   user-facing justification (mirror `NSLocationWhenInUseUsageDescription`).
   Requires a **fresh TestFlight build** — native change, not a WebView reload.
3. **Apple Developer portal**: no special capability toggle needed for EventKit
   read, but confirm at build time.
4. **FE: Settings row** — **"Connect Apple Calendar"** shown only in the native
   iOS app (`Capacitor.isNativePlatform()`) AND when signed in with an `apple`
   identity (to keep parity with the "sign in first" rule). Tapping triggers the
   iOS permission prompt via the plugin; success writes the apple
   `calendar_grants` flag (token-less).
5. **Provider adapter** implements the Phase 0 contract by calling the native
   plugin directly (dynamic-import pattern, like `lib/geolocation.ts` /
   `lib/pushNotifications.ts`) — no server round-trip for the busy data.

### Out of scope for Phase 2
- Any web/PWA/Android Apple-calendar support (impossible — no cloud API).
- Writing events back.
- CalDAV-based server-side access (Apple's CalDAV needs app-specific passwords;
  rejected as too much friction + a credential-storage liability).

---

## Settings page placement (both phases)

A new **"Calendar"** section under the existing sign-in-methods cluster
(`app/settings/page.tsx`). Per provider, render a row only when the matching
identity is linked:
- Disconnected: "Connect Google/Apple Calendar" → runs the authorize/permission
  flow.
- Connected: "Google/Apple Calendar connected" + a "Disconnect" action behind a
  `ConfirmationModal`.
Use `SliderSwitch` or a `PollActionButton`-style row consistent with the
existing settings rows. The availability form's "Pull in my calendar" button is
gated on `getCalendarConnection().provider !== null`.

## Privacy notes
- Google: we request `freebusy` (busy/free only). No event titles, attendees, or
  locations ever leave Google.
- Apple: EventKit returns full events, but we read only `{start, end}` on-device
  and never transmit event details to the server.
- Stored server-side: only the encrypted Google refresh token + scope +
  timestamps. Disconnect deletes it and revokes at the provider.
- The busy-derived window edits are the same `voter_day_time_windows` a user
  could type by hand — no new data category is persisted on the vote.

## Suggested sequencing
1. **Phase 0** (type + `subtractBusyFromWindows` + tests + disconnected
   affordance) — small, no external dependencies.
2. **Phase 1 Google** — start the OAuth verification application on day one;
   build the code behind the test allowlist in parallel; launch when verified.
3. **Phase 2 Apple** — only if iOS-native demand justifies the separate
   on-device path.
