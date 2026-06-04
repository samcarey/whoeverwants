# Siri Integration Plan

> **Purpose.** A phased plan to bring Siri / App Intents support to the iOS app,
> starting with "ask Siri to create a poll" and growing into a richer
> voice/Shortcuts/Spotlight surface. Written so a future session can pick it up
> cold.
>
> **Status (June 2026): implementation underway. Phase 1 landed (pending real-device
> verification).** Authored a few days before WWDC 2026 (~June 8–12).
>
> **Ordering decision (owner, 2026-06-04): the WWDC-watch gate (Phase 0) is moved to
> the END.** The original plan gated all coding on the keynote, but the keynote hadn't
> aired (today is June 4), and the owner chose to build the WWDC-resilient phases now
> and re-validate against the keynote afterward ("we can just redo everything later").
> So the working order is now **1 → 2 → 3 → 4 → 0**. Phases 1–2 are WWDC-resilient by
> design (deep-link prefill + Keychain identity are reusable for URL schemes /
> Shortcuts / widgets regardless of Siri's future); Phase 3 (headless creation) is the
> most keynote-sensitive and should be re-checked against Phase 0's findings before it
> ships to prod.
>
> **How to use this doc.** Each phase is independently shippable and ordered by
> dependency + risk. Update the "Status" line of each phase as work lands, and append a
> dated note under "Post-keynote revisions" rather than rewriting history.

---

## Background & hard constraints (recap)

These shape every decision below; re-read before changing the plan.

- **The iOS app is a Capacitor 8 WebView shell** (`capacitor.config.ts` →
  `server.url = https://whoeverwants.com`, canary → `https://latest.whoeverwants.com`).
  **No web code is bundled** — every Vercel/canary deploy is instantly live on
  device. All poll-creation logic lives in React (`app/create-poll/page.tsx`) +
  FastAPI (`POST /api/polls`). **Native Swift cannot see anything inside the
  WebView.**
- **Native Swift is minimal and colocated in `ios/App/App/AppDelegate.swift`** (the
  bridge VC `MainViewController` + three `CAPBridgedPlugin`s: `ClipboardUrlPlugin`,
  `AppBadgePlugin`, + APNS forwarding hooks). The reason: *adding a new `.swift`
  file requires hand-patching `ios/App/App.xcodeproj/project.pbxproj`*, which the
  headless CI build (`.github/workflows/ios-build.yml`) can't do through the Xcode
  GUI. **Anything auto-discovered by iOS at runtime (Capacitor plugins, App Intents
  / `AppShortcutsProvider`) can be colocated in `AppDelegate.swift` with no pbxproj
  change.** Anything that needs a *new target* (an App Intents extension, a
  Shortcuts extension) DOES require pbxproj surgery the current CI can't hand-patch
  — that's a pipeline change, called out per-phase.
- **App Intents is the right substrate.** Modern Siri = **App Intents** (iOS 16+),
  not the deprecated SiriKit/Intents framework. Apple's consistent direction is
  "App Intents is the foundation for Siri, Shortcuts, Spotlight, widgets, and Apple
  Intelligence." Building on App Intents bets *with* Apple; the churny part
  (personal/Apple-Intelligence Siri) is **additive** on top of well-formed intents.
  The codebase already gates on iOS 16 (`#available(iOS 16.0, *)` in
  `ClipboardUrlPlugin` / `AppBadgePlugin`), consistent with App Intents' floor.
- **Identity lives in WebView `localStorage`, invisible to native code.** Both
  `session_token` and the `browser_id` are localStorage-only today
  (`lib/session.ts: TOKEN_KEY='session_token'`, `lib/browserIdentity.ts:
  STORAGE_KEY='browser_id'`). A native App Intent has **zero access** to them. This
  is the single biggest blocker for hands-free creation (Phase 3) and the reason
  Phase 2 (the identity bridge) exists. CLAUDE.md already flags Keychain /
  `@capacitor/preferences` as an unbuilt "Phase I upgrade."
- **The API contract is already a clean cross-origin JSON POST** — no new backend is
  needed for native creation. Since the May 2026 CORS change the browser itself
  hits `https://api.whoeverwants.com/api/*` directly with `X-Browser-Id` +
  `Authorization: Bearer <token>`; FastAPI CORS is `allow_origins=["*"],
  allow_credentials=False`. A native `URLSession` POST to the same endpoint with the
  same headers is byte-for-byte the same request the WebView makes.
- **Server enforces name-required.** `POST /api/polls` runs `validate_user_name` on
  `creator_name` (400 on blank). Any native creation path must carry the user's name
  alongside the token (so the identity bridge must export `display_name` too, or the
  intent must collect it).
- **Universal-link routing already exists.** `lib/universalLinks.ts:
  pathFromUniversalLinkUrl` validates incoming URLs against a known-hosts allowlist
  and `router.push`es the path — the deep-link consumption half of Phase 1 is
  mostly already built.
- **Verification needs a real device.** Siri / App Intents **cannot be tested in the
  Simulator or headless** (same as Push and Haptics). Every phase's acceptance
  criteria assume a TestFlight install on a physical iPhone. Because web code is
  remote, the JS half of any phase reaches the device as soon as the branch deploys
  to `latest.whoeverwants.com`; only the native Swift half needs a fresh iOS build.

---

## Guiding principles / architecture decisions

1. **Prefer App Intents; never touch legacy SiriKit/Intents.** It's deprecated and
   it's the thing most likely to be further marginalized at WWDC.
2. **Keep the WebView the source of truth wherever possible.** The further a feature
   pushes poll logic into Swift, the more it can drift from the React/FastAPI
   behavior and the more it costs to maintain. Phase 1 keeps creation entirely in
   the WebView; only Phase 3 reimplements a *minimal slice* natively.
3. **Build the platform-agnostic, reusable halves first.** The deep-link prefill
   params (Phase 1) and the native identity bridge (Phase 2) are useful for URL
   schemes, Shortcuts, widgets, and Spotlight regardless of what Siri becomes —
   they're the lowest-regret investments and the least WWDC-sensitive.
4. **Colocate Swift in `AppDelegate.swift` until a phase genuinely needs a separate
   target.** Avoid `project.pbxproj` surgery / CI pipeline changes for as long as
   possible.
5. **No new backend endpoints unless a phase proves it needs one.** The existing
   `POST /api/polls` (+ future `POST /api/polls/{id}/votes`) contract already covers
   create and vote.
6. **Each phase ships behind a real device test, to TestFlight `latest` first**, then
   prod via a Release — same two-tier flow as every other iOS change.

---

## Phase 0 — WWDC watch + decision gate (DEFERRED to the end — see ordering decision above)

**Status: deferred. Run AFTER Phases 1–4, then re-validate the keynote-sensitive
parts (esp. Phase 3) against the findings.** Originally a pre-coding gate; the owner
moved it to the end on 2026-06-04 because the keynote hadn't aired and the early
phases are WWDC-resilient.

**Goal.** Convert "Apple might change everything" from an unknown into a decision.
Spend the keynote week gathering free information, then revise this plan.

**Tasks.**
- Watch the WWDC 2026 App Intents / Siri / Apple Intelligence sessions + "What's
  new in App Intents."
- Answer the post-keynote questions in the "Open questions" section below.
- Decide whether **Phase 3 (headless creation)** is still the right shape or whether
  Apple has made hands-free in-app actions cheaper (which could reorder Phases 2–4).
- Append findings under "Post-keynote revisions" and adjust phase scopes.

**Exit criteria.** This doc has a dated "Post-keynote revisions" entry and Phase 1's
scope is confirmed unchanged (high probability) or amended.

**Cost.** ~½ day of watching + note-taking. **WWDC sensitivity: N/A (this *is* the
watch).**

---

## Phase 1 — Deep-link App Intent ("open the app with the create sheet prefilled")

**Status: IMPLEMENTED (2026-06-04), pending real-device + TestFlight verification.**
What shipped:
- **Swift (`ios/App/App/AppDelegate.swift`, colocated — no pbxproj change):**
  `CreatePollIntent` (an `AppIntent`, `openAppWhenRun = true`) with a required free-text
  `prompt: String` parameter (`requestValueDialog: "What should the poll ask?"`). It
  returns `OpensIntent(OpenURLIntent(...))` to a per-tier universal link
  `https://<host>/g/?create=1&title=<spoken text>` (host mapped from
  `Bundle.main.bundleIdentifier`: prod → `whoeverwants.com`, canary → `latest...`).
  `WhoeverWantsShortcuts: AppShortcutsProvider` exposes the phrases "Create a poll in
  WhoeverWants" / "Start a poll…" / "Ask a question…". Both types are
  `@available(iOS 18.0, *)` — **not 16** — because `OpenURLIntent` (the loopback-correct
  opener for the app's own universal link) is iOS 18+. App Intents themselves are 16+,
  but the pre-18 alternatives are worse (`UIApplication.open` of your own universal link
  from within the app opens Safari; a custom scheme adds Info.plist + CI + JS surface).
  The shortcut is additive, so iOS 16–17 users just don't see it. (CI caught the original
  iOS-16 gate: the archive failed with "'OpenURLIntent' is only available in iOS 18.0 or
  newer".) If broader reach is wanted later, a custom URL scheme is the documented
  follow-up. `import AppIntents` added.
- **Web (`app/create-poll/page.tsx`):** reads `?title=` / `?category=` / `?create=`;
  a new effect (mirroring `?duplicate=` / `?voteFromSuggestion=`) opens the create modal,
  presets the spoken text as a user-authored title (`setIsAutoTitle(false)` so the
  auto-title effect doesn't clobber it), seeds the category via the validated
  `normalizePrefillCategory` (falls back to `custom`), and strips the params via
  `history.replaceState` so refresh doesn't re-trigger. The `loadFormState` mount-restore
  is gated off when a prefill is present so stale saved state can't overwrite it.
- **Routing (`lib/universalLinks.ts`): verified, no change needed.** `appUrlOpen` →
  `pathFromUniversalLinkUrl` already strips the origin and `router.push`es path + query
  for the known hosts, so the new query params flow through untouched.

**Real-device verification still owed (owner):** install the `latest` TestFlight build,
confirm "Hey Siri, create a poll in WhoeverWants" asks the prompt, opens the app to the
create modal, and the spoken text lands prefilled. The one platform risk to watch is the
universal-link loopback — if `OpenURLIntent` of our own host opens Safari instead of the
app, the fallback is a custom URL scheme (a cheap follow-up). See "Risks" below.

Original scope/criteria retained for reference:

**Goal.** "Hey Siri, create a poll in WhoeverWants" (and a parameterized "…asking
*where should we eat*") opens the app, lands on the create flow with the spoken text
prefilled. The user taps Submit in the WebView. No auth bridging, no native poll
logic, no backend changes.

**Scope / UX.**
- A voice phrase (via `AppShortcutsProvider`, no per-user Shortcuts setup) that opens
  the app to `…/g/?create=1&category=<cat>&title=<spoken text>`.
- An optional `@Parameter` so Siri can ask "What should the poll ask?" and pass the
  answer as the title.
- Lands in the existing create-poll modal with title (and optionally category)
  prefilled; user reviews + submits.

**Key tasks.**
- **Swift (colocate in `AppDelegate.swift`):** an `AppIntent` with
  `openAppWhenRun = true` that builds the URL and opens it; an `AppShortcutsProvider`
  exposing the phrase(s). Auto-discovered at runtime — *no pbxproj change*.
- **Web (`app/create-poll/page.tsx`):** add `?title=` (and confirm `?category=`)
  prefill handling. `?category=` preselect already exists; `?title=` is the new bit.
  Auto-open the modal when these params are present (mirror the existing
  `?duplicate=` / `?voteFromSuggestion=` auto-open).
- **Routing:** confirm `lib/universalLinks.ts` passes the new query params through
  untouched (it `router.push`es path + query, so likely free — verify).
- **CI:** none expected beyond a normal iOS build (the intent is colocated). Confirm
  `npx cap sync ios` + archive picks up the new Swift class.
- **Portal:** likely none — `AppShortcutsProvider` works without a portal toggle.
  Verify whether a "Siri" capability or `NSUserActivityTypes` is wanted.

**Files & surfaces.** `ios/App/App/AppDelegate.swift`, `app/create-poll/page.tsx`,
`lib/universalLinks.ts` (verify only), maybe `.github/workflows/ios-build.yml`
(localized phrase strings if any).

**Acceptance criteria (real device).** "Hey Siri, create a poll in WhoeverWants"
opens the app to the create modal; the parameterized phrase prefills the title;
submitting creates a normal poll indistinguishable from a manually-created one.

**Cost: ~1–2 days.** **WWDC sensitivity: LOW.** Most of the work (the prefill
params + deep-link routing) is reusable for URL schemes / Shortcuts / widgets
regardless of Siri's future; the Siri-specific surface is a thin, cheap-to-rewrite
stub.

**Risks.** Minimal. Worst case the intent stub gets rewritten to fit a new App
Intents shape; the web-side prefill stays useful.

---

## Phase 2 — Native identity bridge (Keychain / App Group)

**Status: IMPLEMENTED (2026-06-04), pending real-device + TestFlight verification.
Scope resolved to PLAIN KEYCHAIN (no App Group / extension), per the "start in-process"
decision.** What shipped:
- **Swift (`ios/App/App/AppDelegate.swift`, colocated — no pbxproj change):**
  `NativeIdentityKeychain` (a `kSecClassGenericPassword` store, service namespaced per
  bundle id, accessibility `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — readable
  by a background App Intent after first unlock, NOT iCloud-synced, NOT migrated to a new
  device) + `NativeIdentityPlugin` (`CAPBridgedPlugin`, jsName `NativeIdentity`) exposing
  `setIdentity({token, browserId, name})` / `clearIdentity()` / `getIdentity()`. `set`
  upserts a non-empty value and DELETES on null/`""`, so a single `setIdentity` call
  expresses the full current triple (sign-out = null token + null name, kept browser id).
  `import Security` added. No `@available` gate (Keychain is available on every supported
  iOS, unlike the iOS-18 `OpenURLIntent`).
- **JS (`lib/nativeIdentity.ts` + `components/NativeIdentityHost.tsx`):**
  `syncNativeIdentity()` reads the live token (`getSessionToken`), browser id
  (`getBrowserId`), and trimmed display name (`getUserName`) and pushes them via the
  plugin; INERT on web/PWA (`!Capacitor.isNativePlatform()` short-circuit).
  `installNativeIdentitySync()` (idempotent, mounted once from `app/layout.tsx` via
  `<NativeIdentityHost/>`) subscribes to `SESSION_CHANGED_EVENT` + a focus/visibility
  resync and does an initial sync at launch.
- **Wiring choice — listener, not per-callsite.** Rather than threading `setIdentity`
  through `saveSession` / `clearSession` / `persistSignIn` (which would need a lazy-require
  to dodge the `session.ts ↔ nativeIdentity.ts` cycle), the bridge subscribes ONCE to
  `SESSION_CHANGED_EVENT` — which `saveSession`, `clearSession`, and
  `updateCachedSessionUser` all already dispatch. Equivalent coverage, no cycle, no
  per-callsite plumbing. The foreground resync catches a browser id established after
  mount and local-only name edits that don't dispatch the event.
- **Security posture (review note).** This MOVES the bearer token from WebView
  localStorage into the Keychain — a *stronger* at-rest posture (device-only, not
  iCloud-synced, not restore-migrated, encrypted-at-rest by the Secure Enclave-backed
  Keychain) rather than a regression. No App Group / `kSecAttrAccessGroup` is used, so the
  credential is readable only by the app process itself — sufficient for an IN-PROCESS App
  Intent (Phase 3's starting shape). If Phase 3 moves to a separate extension target, add
  the access group + the App-Group/Keychain-sharing entitlement on both bundles (a
  one-time Apple Developer portal step) — called out inline in the Swift. No entitlement,
  no portal step, and no pbxproj change were needed for this in-process form.

**Real-device verification still owed (owner):** on a `latest` TestFlight build, sign in,
then confirm a native round-trip — e.g. a debug `NativeIdentity.getIdentity()` returns the
token/browserId/name, and a native `URLSession` GET to `/api/auth/me` with
`Authorization: Bearer <token>` + `X-Browser-Id` succeeds; after sign-out the token + name
are gone (browser id retained). This closes the Phase 2 acceptance criteria below; the JS
gating + payload assembly are unit-tested in `tests/__tests__/native-identity.test.ts`
(the Keychain round-trip itself is device-only).

Original scope/criteria retained for reference:

**Goal.** Make the user's `session_token`, `browser_id`, and `display_name`
readable by native Swift (and any future App Intents extension), so native code can
make authenticated API calls *as the user*. This is the single hardest, most
security-sensitive piece, and it's **independent of Siri** — it also unlocks native
widgets, Spotlight, and Shortcuts that show/act on the user's data.

**Scope.**
- A new custom Capacitor plugin (colocate in `AppDelegate.swift`) — call it
  `NativeIdentity` — exposing `setIdentity({token, browserId, name})` /
  `clearIdentity()` from JS, writing to the **iOS Keychain** (and/or a shared **App
  Group** if an extension will read it).
- JS wiring: call `setIdentity` whenever the session changes (`persistSignIn` /
  `saveSession` / `clearSession` in `lib/session.ts` + `lib/api/auth.ts`) and
  `clearIdentity` on sign-out, gated on `Capacitor.isNativePlatform()`.
- Decide storage scope: plain Keychain (app-process reads only) is enough for an
  in-process App Intent; an **App Group** is required only if a *separate extension*
  target reads it (ties into Phase 3's target decision).

**Files & surfaces.** `ios/App/App/AppDelegate.swift` (new plugin),
`lib/session.ts`, `lib/api/auth.ts`, possibly `App.entitlements` (App Group +
Keychain sharing entitlement → **one-time Apple Developer portal step**).

**Acceptance criteria.** After sign-in on device, native code can read a valid
token + browser id + name from the Keychain; after sign-out they're gone; a native
`URLSession` GET to an authenticated endpoint (e.g. `/api/auth/me`) succeeds using
the bridged credentials.

**Cost: ~3–5 days** (dominated by getting Keychain/App-Group right + a security
review of where the bearer token now lives). **WWDC sensitivity: LOW** (Keychain /
App Groups are stable platform primitives), but **scope sensitivity: HIGH** —
whether Phase 3 needs an extension determines App-Group-vs-Keychain here.

**Risks / security.** Moving the bearer token out of WebView localStorage into the
Keychain widens the credential surface. Needs an explicit security review:
Keychain access group scoping, what happens on app uninstall/reinstall, and whether
the token should be short-lived/refreshable for native use. Coordinate with the
existing auth model (`docs/auth-access-model.md`).

---

## Phase 3 — Headless poll creation App Intent ("create without opening the app")

**Status: not started. Depends on Phase 2.**

**Goal.** "Hey Siri, ask WhoeverWants where we should eat dinner" → Siri creates the
poll via the API and speaks confirmation; the app never opens.

**Scope.**
- An `AppIntent` (no `openAppWhenRun`) that: reads identity from the Phase 2 bridge
  → maps the spoken phrase to a **minimal** `CreatePollRequest` (one question;
  `creator_name` from the bridge; `title` from speech; a sensible default category,
  e.g. `yes_no` or `custom`) → `POST https://api.whoeverwants.com/api/polls`
  (canary host for the `latest` bundle) with `X-Browser-Id` + bearer → returns an
  `IntentResult` with spoken confirmation + an "open it?" affordance.
- Native Swift models mirroring the *minimal slice* of `CreatePollRequest` /
  `CreateQuestionRequest` actually used (do NOT reimplement the whole thing — one
  question, no deadlines/suggestion-phase initially).
- Per-tier API host selection (prod vs `latest`) mirroring `CAP_ENV`.

**Decision point — target shape.** An App Intent can run **in-process** (colocate
in `AppDelegate.swift`, Keychain-only identity, no pbxproj change) OR in a dedicated
**App Intents extension** (better for reliability/perf, but a NEW target → pbxproj
surgery the headless CI can't hand-patch → a real pipeline change, and App-Group
identity). **Resolve this against WWDC** — Apple may push one model. Start
in-process to avoid the pipeline cost unless the keynote says otherwise.

**Files & surfaces.** `ios/App/App/AppDelegate.swift` (or a new extension target +
`project.pbxproj` + `ios-build.yml` work if extension), reuses Phase 2 identity.
**No backend changes** (existing `POST /api/polls`).

**Acceptance criteria (real device).** A spoken phrase creates a real poll
attributed to the signed-in user, with Siri speaking confirmation, app un-launched;
the poll appears in the WebView on next foreground. Signed-out users get a graceful
"sign in first" response.

**Cost: ~1 week** on top of Phase 2 (Swift networking + intent + phrase modeling +
device testing; +several days if an extension target is required). **WWDC
sensitivity: MEDIUM–HIGH** — this is exactly the "hands-free in-app actions" area
Apple keeps reworking; the keynote may make it cheaper (great) or change the
idiomatic shape (rework the stub). Reuses Phase 2 regardless.

**Risks.** Native/JS drift on poll semantics (mitigate by keeping the native slice
minimal); result not visible until WebView refresh (acceptable; speak + offer to
open); per-tier host mistakes (test on `latest` first).

---

## Phase 4 — Expanded intent surface (later, scope post-keynote)

**Status: not started. Backlog — prioritize after Phases 1–3 land + post-keynote.**

Candidate intents, each building on Phases 1–3's foundations (identity bridge +
deep-link + native API client):
- **Vote by voice** — "Hey Siri, vote yes on …" (needs `POST /api/polls/{id}/votes`
  + a way to disambiguate *which* poll → Siri parameter / entity query).
- **Query results** — "Who's winning the dinner poll?" (read-only GET; speak the
  current leader; ties into the outcome-explainer text).
- **App Entities + `EntityQuery`** so Siri/Spotlight can reference the user's groups
  & polls by name (surfaces the user's data into Spotlight search + Shortcuts).
- **Richer creation** — multi-question, category/deadline parameters, conversational
  follow-ups.
- **Apple Intelligence / on-screen-Siri hooks** — only as far as WWDC makes them
  real and stable; treat as additive on top of well-formed App Intents.
- **Shortcuts / widgets surfaces** reusing the same intents + identity bridge.

**Cost: large + open-ended.** **WWDC sensitivity: HIGH** by design — this phase is
where we deliberately ride whatever Apple ships, so its scope is intentionally left
to be written after the keynote.

---

## Cross-cutting concerns

- **CI pipeline (`.github/workflows/ios-build.yml`).** Phases 1–3 (in-process) fit
  the existing colocate-in-`AppDelegate.swift` model — no pbxproj surgery. A
  dedicated App Intents / Shortcuts **extension target** (possible Phase 3/4) breaks
  the "headless CI hand-patches `project.pbxproj`" assumption and is a notable
  pipeline change — commit the target into the project or generate it deterministically.
- **Apple Developer portal (one-time, per bundle — `com.whoeverwants.app` AND
  `com.whoeverwants.app.latest`).** App Intents need no special entitlement;
  `AppShortcutsProvider` works without a portal toggle. The **App Group + Keychain
  sharing** entitlement (Phase 2, if extension) IS a portal step on both bundles —
  mirror the existing one-time steps documented for Push / Sign In with Apple /
  Associated Domains in `docs/ios-setup.md`.
- **Localization.** `AppShortcutsProvider` phrases are localizable strings; keep an
  eye on where they live (likely an `AppShortcuts` strings file).
- **Testing.** Real device + TestFlight only — no Simulator/headless for Siri.
  Ship to the `latest` tier (canary bundle) first; the web half is live the moment
  the branch deploys to `latest.whoeverwants.com`, so iterate JS without a rebuild
  and rebuild only for native Swift changes.
- **Security review** (Phase 2) — see Phase 2 risks; the bearer token moving to
  Keychain needs sign-off against `docs/auth-access-model.md`.
- **iOS floor.** App Intents = iOS 16+; consistent with the existing
  `#available(iOS 16.0, *)` gating.

---

## Open questions to resolve after the keynote

1. Did Apple expand App Intents to make **hands-free in-app actions** (Phase 3)
   first-class / cheaper? If so, does it reorder Phases 2–4?
2. Is there a **new idiomatic shape** for Siri/Apple-Intelligence intents we should
   author to (App Entities, `EntityQuery`, on-screen awareness) instead of a
   deep-link stub?
3. **In-process App Intent vs dedicated extension** — does Apple push one model?
   (Determines Phase 2's Keychain-vs-App-Group + Phase 3's pipeline cost.)
4. Any change to **deep-link / `openAppWhenRun`** behavior that affects Phase 1?
5. Anything that deprecates or changes the **direct cross-origin API** assumption the
   native client relies on? (Unlikely — it's our backend — but confirm nothing in
   the App Intents networking story conflicts.)

---

## Cost & sensitivity summary

Working order **1 → 2 → 3 → 4 → 0** (Phase 0 moved to the end, 2026-06-04):

| Phase | What | Cost | WWDC sensitivity | Depends on | Status |
|-------|------|------|------------------|------------|--------|
| 1 | Deep-link App Intent (open + prefill) | ~1–2 days | Low | — | **done (pending device verify)** |
| 2 | Native identity bridge (Keychain/App Group) | ~3–5 days | Low (scope: high) | — | **done (plain Keychain; pending device verify)** |
| 3 | Headless poll creation App Intent | ~1 week (+extension) | Medium–High | 2, re-check 0 | not started |
| 4 | Expanded intents (vote/results/entities/AI) | Large / open | High (by design) | 1–3, 0 | not started |
| 0 | WWDC watch + decision gate (now last) | ~½ day | — | — | deferred |

**Recommended order (revised 2026-06-04):** 1 → 2 → 3 → 4 → 0. Phase 1 (done) delivers a
real "Hey Siri → create a poll" entry point at low cost/risk; Phase 2 is the reusable,
security-gated prerequisite for anything hands-free; Phase 3 is the magical version but
the most keynote-sensitive (re-check against Phase 0 before prod); Phase 4 rides whatever
WWDC makes worthwhile. Phase 0 (the WWDC watch) now runs last and feeds a re-validation
pass over Phases 3–4. (The original order was 0 → 1 → 2 → 3 → 4 with Phase 0 as a hard
pre-coding gate; see the ordering decision at the top.)

---

## Revisions log

_(Append dated entries; do not rewrite the phases above — note what changed and why.
Post-keynote findings go here too, once Phase 0 runs.)_

- **2026-06-04 — Shipped Phase 2 (native identity bridge, plain Keychain).** Resolved the
  scope-sensitive Keychain-vs-App-Group question to **plain Keychain** (no App Group, no
  extension, no entitlement, no Apple Developer portal step), consistent with Phase 3
  starting as an in-process intent. Added `NativeIdentityKeychain` + `NativeIdentityPlugin`
  (colocated in `AppDelegate.swift`), `lib/nativeIdentity.ts` (`syncNativeIdentity` +
  `installNativeIdentitySync`), and `<NativeIdentityHost/>` (mounted in `app/layout.tsx`).
  Wired via a single `SESSION_CHANGED_EVENT` subscription + foreground resync rather than
  per-callsite `setIdentity` calls (avoids the session↔nativeIdentity import cycle; same
  coverage). Bearer token now lives in the Keychain on native (device-only,
  non-iCloud-synced) — a stronger at-rest posture than WebView localStorage, not a
  regression. Unit tests in `tests/__tests__/native-identity.test.ts` pin the gating +
  payload; the Keychain round-trip is device-only, so real-device + TestFlight
  verification is still owed (owner). Next: Phase 3 (headless creation) reuses this bridge,
  but is the most keynote-sensitive — re-check against Phase 0's eventual findings before
  prod.
- **2026-06-04 — Reordered + shipped Phase 1.** Owner decided to move the WWDC-watch gate
  (Phase 0) to the end rather than wait for the keynote (~June 8–12), since the early
  phases are WWDC-resilient. Working order is now 1 → 2 → 3 → 4 → 0. Implemented Phase 1:
  `CreatePollIntent` + `WhoeverWantsShortcuts` colocated in `AppDelegate.swift`, and the
  `?title=` / `?category=` / `?create=` prefill + auto-open in `app/create-poll/page.tsx`.
  `lib/universalLinks.ts` verified to pass the query params through unchanged. Pending:
  real-device + TestFlight verification (owner) — esp. confirming the `OpenURLIntent`
  universal-link loopback opens the app rather than Safari. Phase 3 must be re-validated
  against Phase 0's eventual keynote findings before it ships to prod.
