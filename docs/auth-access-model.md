# Auth & Access Model

The plan for adding user accounts, group privacy, join requests, invite links,
and per-vote anonymity to a previously fully-anonymous app. See
`docs/poll-phasing.md` for the precedent on incremental rollouts that keep
`main` shippable at every step.

## North star

**Identity** — every action is attributable internally to a stable identifier.
For anonymous browsers that's `browser_id` (uuid in localStorage, echoed via
`X-Browser-Id`, minted server-side by `BrowserIdMiddleware`); for signed-in
users that's `user_id` (uuid in `users.id`, resolved from a session token).
The two coexist: signing in *links* a browser_id to a user_id, it doesn't
replace it. Reads + writes prefer user_id when present, fall through to
browser_id when not. The bridge is `user_browsers(user_id, browser_id)`.

**Privacy** — new groups default to private (only members can read polls);
existing groups stay public (grandfathered, no shared links broken). Private
groups require a signed-in creator so approval authority doesn't get stranded
on a wiped browser.

**Joining** — three paths: request-to-join + approval, multi-use invite link
with revocation, single-use invite token. All three can optionally carry a
target poll so the joiner lands on a specific poll after auto-joining.

**Anonymity** — per-vote, with two independent flags: `anonymous_to_peers`
and `anonymous_to_creator`. The server *always* knows the voter internally
(for "have I voted?" / quota / abuse), but read paths filter by the flags so
peers + creator see only what they're allowed.

## Identity model

```
users
  id uuid PK
  created_at, updated_at

user_identities  -- one row per (provider, account-on-that-provider)
  provider text  -- 'email' | 'apple' | 'google' | 'passkey'
  provider_user_id text  -- email (normalized) for 'email'; sub for OAuth; credential id for passkey
  user_id uuid -> users.id
  email text NULL  -- denormalized verified email for cross-provider account merge lookup
  created_at
  PRIMARY KEY (provider, provider_user_id)
  INDEX (user_id), INDEX (email)

user_browsers  -- which devices this user has signed in on
  user_id uuid -> users.id
  browser_id uuid
  linked_at
  PRIMARY KEY (user_id, browser_id)
  INDEX (browser_id)

sessions  -- opaque bearer tokens; one row per active sign-in
  token_hash text PK  -- sha256(token) hex; raw token never stored
  user_id uuid -> users.id
  browser_id uuid NULL  -- the browser this session was created in
  created_at, expires_at, last_used_at
  user_agent text NULL

magic_link_tokens  -- single-use email verification tokens
  token_hash text PK
  email text  -- normalized lowercase trim
  browser_id uuid NULL  -- the browser that requested the link (debug/fraud)
  created_at, expires_at, used_at
```

**Account merge on auth.** When a new auth arrives:
1. If `(provider, provider_user_id)` already exists in `user_identities` →
   that's the user.
2. Else if the auth carries a verified email AND any `user_identities` row
   matches → link to that existing user (insert a new identity row pointing
   at the existing user_id).
3. Else → create a new `users` row + identity row.

**Browser link on auth.** Insert `user_browsers(user_id, browser_id) ON
CONFLICT DO NOTHING` so subsequent reads on this browser can resolve the
user. Idempotent — re-signing in doesn't churn `linked_at`.

**Auto-claim on first link.** When a previously-anonymous browser_id first
links to a user, retroactively claim what we can:
- `UPDATE group_members SET user_id = $user_id WHERE browser_id = $bid AND user_id IS NULL`
- Poll ownership: client posts its localStorage `creator_secret`s in the
  same request; server validates each against `polls.creator_secret` and
  writes `polls.creator_user_id`.
- Votes: pre-rollout votes have no `voter_browser_id` (not tracked
  historically), so they aren't claimable. Post-rollout votes get
  `voter_browser_id` written so future linkers can claim them.

**Session token.** Opaque random (`secrets.token_urlsafe(32)`, 43 chars).
Server stores only `sha256` so a DB leak doesn't yield usable tokens. FE
sends via `Authorization: Bearer <token>` header. Sliding 30-day expiry —
`last_used_at` bumped on every request, expiry refreshed when within 7 days
of expiring. Sign-out deletes the row.

## Group privacy

```
groups
  + privacy text  -- 'public' | 'private', default 'private' for new rows
  + creator_user_id uuid NULL -> users.id  -- set on group create when user is signed in
```

Migration backfills existing rows to `'public'` and leaves `creator_user_id`
NULL. `POST /api/groups` (and the new-group flow that mints a group as a
side effect of creating the first poll) rejects `privacy='private'` if no
`user_id` is present.

**Visibility filter** (extends Phase C.3 rule in `services/groups.py`):
- `public` groups: anyone with a `?p=` link, anyone with a `group_members`
  row, anyone in the legacy bridge.
- `private` groups: requires `group_members` row only. The Phase C.3
  inline-grant via `/by-route-id` STILL fires for public groups; for
  private groups the inline grant is skipped and the read returns 404
  unless an explicit invite redemption / approval already wrote the
  membership row.

## Join requests + invites

```
group_join_requests
  id uuid PK
  group_id uuid -> groups.id
  requester_user_id uuid -> users.id  -- requires sign-in; anonymous can't request
  message text NULL  -- optional "hi, it's Alice from work"
  status text  -- 'pending' | 'approved' | 'denied' | 'cancelled'
  requested_at, decided_at
  decided_by_user_id uuid NULL -> users.id
  UNIQUE (group_id, requester_user_id) WHERE status = 'pending'

group_invites
  token_hash text PK
  group_id uuid -> groups.id
  created_by_user_id uuid -> users.id
  mode text  -- 'single' | 'multi'
  target_poll_id uuid NULL -> polls.id  -- optional auto-scroll target after join
  max_uses int NULL  -- NULL = unlimited for 'multi'; 1 for 'single'
  use_count int DEFAULT 0
  expires_at timestamptz NULL  -- NULL = no expiry; creator may revoke explicitly
  revoked_at timestamptz NULL
  created_at
```

**Request flow** (Phase F):
- `POST /api/groups/<route_id>/join-requests` body: `{message?}`. Requires
  user_id. 409 if a pending request already exists.
- Push notification fan-out to creator's `push_subscriptions` (same infra as
  new-poll notifications, gated on the creator's per-group pref defaulting
  ON for own groups).
- `GET /api/groups/<route_id>/join-requests` — creator-only.
- `POST /api/groups/<route_id>/join-requests/<id>/decide` body:
  `{action: 'approve'|'deny'}`. Approve → INSERT group_members. Deny →
  mark denied. Requester gets no notification on deny (avoids "why
  rejected" follow-ups).

**Invite flow** (Phase G):
- `POST /api/groups/<route_id>/invites` body:
  `{mode, max_uses?, target_poll_id?, expires_in_hours?}`. Returns
  `{token, url}`. Token is the raw value, only ever returned once.
- `POST /api/auth/invites/<token>/redeem` — requires user_id; writes
  `group_members` if not already a member, bumps use_count, returns
  `{group_id, target_poll_id}` for FE redirect.
- `DELETE /api/groups/<route_id>/invites/<id>` — revoke.
- FE `/g/<id>/info` adds an "Invite link" section listing active invites
  (with use counts) + a "Create invite link" button.

## Per-vote anonymity

```
votes
  + voter_user_id uuid NULL -> users.id
  + voter_browser_id uuid NULL  -- always set going forward; backfill not possible
  + anonymous_to_peers boolean DEFAULT false
  + anonymous_to_creator boolean DEFAULT false
```

**Server-side read filter** (Phase H):
- `polls_for_poll_ids` aggregates `voter_names`: filter
  `WHERE NOT anonymous_to_peers OR voter_user_id = $caller_user_id` (peers
  see their own name regardless of flag).
- Creator-only read paths (vote drilldown, /info participant list): filter
  `WHERE NOT anonymous_to_creator OR voter_user_id = $caller_user_id`.
- The `VoterList` component currently has no caller-identity check —
  Phase H adds it.

**Single source of identity-bearing read.** Add an audit harness test
(`server/tests/test_anonymity_leak.py`) that exercises every endpoint
returning vote rows and asserts anonymous flags are honored. The bug class
to fear most is "a new endpoint forgets the filter and leaks identity" —
the test should fail at PR-time for any new endpoint that surfaces
`voter_name`/`voter_user_id`/`voter_browser_id` without going through the
shared filter.

**UI for the toggle.** TBD per question type:
- Ranked-choice / time / suggestion: add toggle to the wrapper Submit area.
- Yes/No tap-to-vote-immediately has no room — likely a group-level
  "default anonymous" setting + long-press to toggle on a single vote.

## Phasing

Independent PRs, each leaves `main` shippable. See the top-level summary in
the original session for the rationale.

| # | Phase | Ships | Blocks |
|---|---|---|---|
| A | Identity foundation | `users`, `user_identities`, `user_browsers`, `sessions`, `IdentityMiddleware`, session-token helpers (web + Capacitor) | — |
| B | Magic link | request + verify endpoints, email provider (Resend), Settings UI, auto-claim on first link | A |
| C | OAuth (Apple, Google) | web + Capacitor flows, ID-token verify, account merge on shared email | A |
| D | Passkey | WebAuthn server + browser; iOS native plugin | A; can ship after E/F if flaky |
| E | Group privacy | `groups.privacy`, `groups.creator_user_id`, visibility filter, sign-in nudge | A, B |
| F | Join requests | `group_join_requests` table, request/approve/deny, push notification | E |
| G | Invite links | `group_invites` table, create/redeem/revoke, target-poll on join | E |
| H | Per-vote anonymity | anonymity flags on votes, read-time filter everywhere, audit test | A |
| I | Polish | account settings (linked identities, **add recovery email to passkey-only account**, sign out, delete), retire `creator_secret` | A–H |

Phase A and B ship together as the first PR — A is invisible alone; B is
the smallest end-to-end auth that proves the model.

## Decisions locked in

- **Existing groups stay public** on rollout. Only new groups default
  private.
- **Anonymous browsers can only create public groups.** Private requires
  sign-in (so approval authority is recoverable).
- **Magic-link UX is auto-create-or-login.** Server always responds "if
  that email has an account, check your inbox" — no user enumeration. New
  accounts are created on first verify, not on request.
- **Invite links support both modes** (single + multi), creator picks per
  invite. Optional `target_poll_id` lands the joiner on a specific poll.
- **Account merge** when the same verified email arrives from two
  providers — auto-merge into one user. No user-facing consent prompt
  (the user proved control of the email both ways).
- **Cross-device sign-in.** Magic link clicked on Device B logs in B,
  regardless of which device requested the link. The
  `magic_link_tokens.browser_id` is for fraud detection only, not
  identity.
- **Email provider:** Resend. Generous free tier, simple Python SDK,
  one-time DNS setup. Postmark / SES as alternates if delivery rates
  disappoint.
- **Capacitor session storage:** `@capacitor/preferences` (Keychain on
  iOS) so the token survives app updates. Web/PWA uses localStorage.
- **iOS universal link.** Magic-link URL is `https://whoeverwants.com/auth/verify?token=...`
  which opens the app via the existing `apple-app-site-association`. The
  `/auth/verify` route handles both standalone-browser and in-app
  delivery.
- **Browser_id is opaque to the user.** Signing in adds a layer ("you are
  Sam"), not replaces ("you are no longer browser X"). Sign-out drops the
  user link; the browser_id keeps working anonymously.

## Pitfalls to internalize before writing code

- **Anonymity leak via aggregation.** Every read path that surfaces
  voter identity has to filter on the flags. The `polls_for_poll_ids`
  helper aggregates `voter_names` server-side; the `votes` table has
  per-vote `voter_name` strings. Any join from a results query to votes
  must filter. The audit test in Phase H is the safety net.
- **Browser_id ≠ identity post-rollout.** Today CLAUDE.md says
  "every audit-write keys on browser_id." Post-Phase-A it's
  "user_id when present, else browser_id." Every callsite that reads
  `_browser_id(request)` needs review during Phase E+ — pick a clear
  helper name (`_actor_user_id(request)` vs `_actor_browser_id(request)`)
  so the intent is local to each callsite.
- **OAuth audience/issuer checks.** Apple + Google ID tokens MUST be
  verified against the configured client_id (audience) and the
  provider's issuer. A misconfigured verify accepts tokens issued for
  other apps' client_ids and lets anyone log in as anyone. Use the
  provider's official SDK / well-known JWKS endpoint, never roll your
  own.
- **Magic-link token replay.** Single-use is enforced by `used_at IS
  NULL` predicate in the verify UPDATE. Wrap the read + update in one
  transaction; otherwise two simultaneous clicks both pass the read,
  both pass the update guard, two sessions issued. Use
  `UPDATE ... WHERE used_at IS NULL RETURNING ...` and treat empty
  result as "already used / invalid".
- **Email enumeration.** The `POST /request` response must be identical
  for "email exists" vs "email new" — same status code, same body, same
  timing-ish. Validation errors (malformed email) can be distinct.
- **Universal link domain claims.** The magic-link URL must be on a host
  listed in `apple-app-site-association`. Today that's
  `whoeverwants.com` + `latest.whoeverwants.com`. Branch dev URLs
  (`<slug>.dev.whoeverwants.com`) are NOT claimed, so magic links sent
  from a dev server's API to a real email will open in Safari, not the
  app. For dev testing, either (a) use a real email but accept Safari
  opening, or (b) log the link to the API server and copy-paste into the
  app's own URL bar.
- **Migration column NULL semantics.** `polls.creator_user_id`,
  `votes.voter_user_id`, `group_members.user_id` are all nullable
  forever (anonymous users will always have NULL). Don't write NOT NULL
  constraints. Don't write CHECK constraints that require user_id either
  — that breaks the anonymous flow.
- **`creator_secret` keeps working through the rollout.** Don't remove
  it. Phase I retires it once observability shows every active browser
  has either signed in or been inactive >30 days.
- **Test fixtures need both identities.** Existing tests post requests
  with `X-Browser-Id` headers. New tests need a sign-in fixture that
  mints a `users` row + session token + sets `Authorization: Bearer`
  alongside. Keep both fixtures distinct — a single "authenticated
  request" fixture that always signs in hides the anonymous-path
  regressions.
- **Push notifications need user-level fan-out.** Today
  `push_subscriptions` keys on browser_id. For join-request
  notifications, the creator might have signed in on Device A, requested
  a notification subscription there, then approved on Device B. The
  fan-out query has to walk `user_browsers` → `push_subscriptions
  WHERE browser_id IN (...)`. Phase F builds this; Phase A's middleware
  enables it.
- **Sign-in modal stacking.** The create-poll modal is z-60; the
  ConfirmationModal is z-70. The SignInModal needs its own slot —
  proposed z-80 so it stacks above everything (sign-in might be
  triggered FROM the create-poll modal when a user picks "private" and
  isn't signed in).

## Adding a recovery email to a passkey-only account (Phase I)

Phase D (anonymous passkey registration) lets users create an account
with no email at all — `user_identities` carries only a `passkey` row,
`email` is NULL. Recovery is the cost: lose the device with the only
credential and the account is unreachable. Phase I will let those
users attach an email after the fact as a recovery path.

The mechanics reuse the existing magic-link flow with one twist:

1. Settings → "Add a recovery email" (visible when signed in AND no
   email identity exists yet) → user types address → `POST
   /api/auth/recovery-email/request {email}`. Server validates,
   throttles (existing `email_throttled` helper), mints a magic-link
   token tagged with the current `user_id` (new column on
   `magic_link_tokens` OR a separate `email_attach_tokens` table —
   the former is lighter and the predicate `WHERE used_at IS NULL
   AND user_id IS NULL` keeps sign-in flows uncrossed). Sends the
   link.
2. User clicks the link → `POST /api/auth/recovery-email/verify
   {token}`. Server consumes the token, inserts a new
   `user_identities` row `(provider='email', provider_user_id=<email>,
   user_id=<original>, email=<email>)`, returns the updated profile.
   No new session issued (the user was already signed in to confirm).

Account-merge gotcha: if `email` is already in `user_identities`
pointing at a DIFFERENT user_id, the attach must either (a) refuse
with a clear "this email is already used by another account, sign
in to that account instead and link from there" message, or (b)
merge the two accounts (move every `user_identities` row, every
`user_browsers` row, every `polls.creator_user_id`, every
`votes.voter_user_id` from the passkey-only user to the email-owning
user, then delete the now-empty user row). (a) is simpler and
preserves the principle that account merge requires proving control
of both sides at the same time; (b) is friendlier UX but the
"clobber my passkey account" rollback story is messier. Go with
(a) for v1.

UI gating: the "Add a recovery email" affordance is **encouraged but
not enforced** on Phase D account creation — a banner on Settings
when the user has only a passkey identity ("Add a recovery email so
you don't lose access if this device is lost"), but creation paths
don't block. Forcing email collection at registration time defeats
the point of passkey-as-account-creation (no friction).

## Out of scope for v1

- Adding a second email to an existing account.
- Account deletion / GDPR (Phase I scope, but lightweight).
- Anonymous-group-to-private migration (creator picks an existing public
  group and flips it private). Could ship later; for now privacy is
  set-at-create.
- Per-user display names (replacing the per-vote `voter_name` free text).
  Today's free-text-per-vote remains the source of truth for what peers
  see; signed-in users still type a name per vote (defaulted from the
  last one). A `users.display_name` column is a small addition for
  later.
- Per-group anonymous-default setting. Defer to Phase H follow-up.
- Web Push notification preference defaulting to ON for own groups
  (notifications to creator on join request) — design in Phase F.
