# iMessage Extension Plan (interactive polls in the Messages transcript)

> **Purpose.** A phased plan for embedding interactive WhoeverWants polls inside
> Apple iMessage via a Messages app extension, with `MSMessageLiveLayout` powering a
> live, tappable poll bubble in the conversation transcript. Written so a future
> session can pick it up cold.
>
> **Status (June 2026): Phase 0 (target scaffold + CI) shipped via #712;
> Phase 1 (share-from-drawer) shipped via #713; Phase 2 (live read-only
> transcript bubble + the identity-free `/summary` endpoint) shipped via #715;
> Phase 3 (INLINE VOTING in the transcript — yes_no Yes/No + limited_supply
> Claim/Decline, identity-gated, edit-not-duplicate) shipped via #718;
> Phase 4 COMPOSE-A-POLL-IN-MESSAGES (decision D — a "New poll" composer in the
> drawer: typed prompt → shared `PollTextParser` → headless create for
> options/yes-no, "open the app to finish" for category) implemented — see the
> Phase 4 section for what landed and the on-device verification owed. Phase 4
> is Swift-only EXCEPT one pbxproj change (the shared `PollTextParser.swift`
> compiled into the extension target — the documented precedent): no server /
> migration / entitlement / CI-logic change. The deferred **expanded-view
> ballot** (vote on any yes_no/limited_supply question — including
> multi-question polls — from the tapped-bubble summary, with in-extension name
> entry) is now implemented (Swift-only, no server/migration change) — see the
> "Expanded-view ballot" section. Phase 5's FIRST increment — a native
> RANKED-CHOICE ballot in the expanded view (one additive server field +
> Swift tap-to-rank UI) — is implemented; the time/showtime + WKWebView halves
> stay gated. See the Phase 5 section.** Owner decisions are resolved (see
> "Resolved decisions" at the bottom).
>
> **Verdict up front: feasible, and `MSMessageLiveLayout` is the right API** — but
> this is the project's first *additional Xcode target* (a Messages extension is a
> separate `.appex` target + process), the interactive bubble must be **native
> SwiftUI/UIKit, not the WebView**, and the fallback experience for recipients
> *without* the app is **worse** than today's plain-URL share. That last point is
> the core product tradeoff and shapes the whole plan.

---

## Background & hard constraints

These shape every decision below; re-read before changing the plan.

### Platform facts (verified June 2026)

- **A Messages extension is a separate target and a separate process.** The main
  app cannot insert an `MSMessage` into a conversation — only the extension,
  running inside Messages, can (`MSConversation.insert`/`.send`). So the entry
  point is the **iMessage app drawer inside Messages**, not the in-app share
  button. The in-app share button keeps sharing plain URLs; the bubble is an
  *additive* path.
- **`MSMessageLiveLayout` (iOS 11+) renders our own view controller inline in the
  transcript.** When a message specifies a live layout, Messages instantiates the
  extension's `MSMessagesAppViewController` with the `.transcript` presentation
  style and shows its view as the message bubble. Interactivity IS allowed in the
  transcript, with hard limits (per Apple's WWDC17 guidance, still current):
  - **No keyboard input** in transcript style — text entry requires `.expanded`.
    A transcript instance MAY call `requestPresentationStyle(.expanded)` (the
    only legal style from transcript); the system then displays a NEW instance
    in that style. It must, in fact: unhandled taps on a live bubble do NOT
    open the extension the way template bubbles do (device-verified in
    Phase 2).
  - **Simple taps only** — Apple explicitly says stick to button taps; anything
    complex is disorienting inside a scrolling transcript.
  - **Aggressive teardown** — transcript instances are created per-render and
    destroyed when the user leaves the conversation. Keep them stateless +
    lightweight.
  - One extension process can host **several live transcript instances at once**
    (multiple poll bubbles in view), plus the compact/expanded instance.
- **The live bubble renders ONLY when the recipient also has the app installed.**
  Otherwise the recipient sees the `MSMessageTemplateLayout` fallback (image +
  caption). Tapping that fallback on iOS *without* the app prompts the **App
  Store**, not our website. On macOS Messages, the `MSMessage.url` opens in the
  browser. Android/SMS recipients get a degraded text representation. Compare
  today: a plain `https://whoeverwants.com/g/…/p/…` link + our OG preview opens
  the web app **for everyone**. So an MSMessage bubble is strictly better for
  app-holders and strictly worse for everyone else.
- **`MSSession` enables in-place message updates, and its known race doesn't
  apply to our design.** Apple's canonical demo encodes poll state in the message
  payload and replaces the bubble per vote — two simultaneous votes on the same
  session lose data. We sidestep this entirely: **the server is the source of
  truth.** The payload carries only identifiers; votes POST to our API; the live
  bubble fetches current results at render time. No session-update churn needed
  for correctness (an optional session "bump" is purely cosmetic).
- **No WKWebView in the transcript.** WKWebView is one of the heaviest objects in
  iOS, extensions have tight memory budgets, and transcript views are torn down
  constantly — a web view per bubble would jetsam the extension. The transcript
  ballot must be native. (WKWebView in the *expanded* presentation is borderline
  viable — see Phase 4 — but never in transcript.)
- **iMessage apps are stagnant but not deprecated.** The Messages framework still
  ships unchanged (no deprecations through the iOS 18/26 era); Apple just hasn't
  invested since ~2017, and the drawer lost prominence in the iOS 17 "+" redesign.
  Risk profile: neglect, not removal. Discoverability of the drawer is the main
  adoption concern.
- **Simulator support exists.** Unlike Siri, Messages extensions run in the iOS
  Simulator (Xcode provides a fake two-sided conversation), so the inner loop
  doesn't require TestFlight for every iteration — though real-device + TestFlight
  verification is still mandatory before shipping (per the app's standing rule).

### Codebase facts

- **This is the first second target.** Everything native so far is colocated in
  `ios/App/App/AppDelegate.swift` / `PollTextParser.swift` precisely because the
  headless CI (`.github/workflows/ios-build.yml`) can't drive the Xcode GUI. A
  `.appex` target means real `project.pbxproj` surgery: new target, new
  Info.plist (`com.apple.message-payload-provider` extension point), embed-app-
  extensions build phase, its own bundle id + entitlements + provisioning.
  **Recommendation: scaffold the target ONCE on the Mac mini (Xcode GUI or the
  `xcodeproj` ruby gem) and commit the result** — the same precedent as the
  original `npx cap add ios` scaffold — rather than attempting sed surgery in CI.
- **CI changes are mechanical but real.** The workflow's bundle-id sed step
  currently expects exactly 2 `PRODUCT_BUNDLE_IDENTIFIER` occurrences; a second
  target doubles that and adds a per-tier extension bundle id
  (`com.whoeverwants.app.MessagesExtension` /
  `com.whoeverwants.app.latest.MessagesExtension` — the extension id MUST be
  prefixed by the host app's id). Automatic signing with the existing Admin API
  key should auto-provision the new bundle ids; the profile-cache-purge step
  already exists. The entitlements-scoping step must also scope the extension's
  entitlements per tier.
- **Identity: reuse the Siri App Group bridge as-is.** The extension is a
  separate process — the exact lesson already learned with `QuickPollIntent`:
  plain Keychain doesn't cross process boundaries; the shared App Group +
  `…​.siri` keychain access group does. `NativeIdentityAppGroup` already mirrors
  `{token, browser_id, name}` on every session change. Work needed: add the App
  Group + keychain access group to the extension's entitlements and read the same
  store. Voting from the bubble is then the same headless POST pattern as
  `QuickPollService` (per-tier `apiBase` from the bundle id, `X-Browser-Id` +
  optional bearer, name-gate on `identity.name`).
- **Poll listing: same fetch as Siri Phase 4.** The extension's compose picker
  ("which poll do I want to share?") is exactly `PollEntity.fetchAll()` —
  `POST /api/groups/mine` with the bridged identity, newest-first, browser-scoped
  visibility caveat included. Don't invent a second way to list polls.
- **Membership on the recipient side falls out of existing semantics.** A
  recipient interacting with the bubble calls the visibility-aware group/poll
  endpoints with their own browser id: public groups auto-join on read (same as
  visiting the URL). **Private groups: the payload embeds a group invite token**
  (decision B) so the recipient auto-joins on interaction, exactly like clicking
  an `/invite/<token>` link. When sharing a poll whose group is private, the
  extension mints a multi-use invite scoped to that poll
  (`POST /api/groups/<route>/invites` with `target_poll_id`, the Phase G
  machinery) and embeds the raw token in the `MSMessage` payload. Reuse is
  SESSION-scoped only (an in-memory poll→token cache in the extension): the raw
  token is hash-stored server-side and can never be re-listed, so cross-session
  re-shares mint fresh invites — accepted; they accumulate in the group's /info
  invites list, where each stays individually revocable (a server-side
  get-or-mint would require storing raw tokens, breaking hash-only-storage).
  The bubble's
  "Open in WhoeverWants" deep-link is the canonical `/invite/<token>` URL so the
  fallback path redeems too. **Caveat — redemption needs an account:**
  `POST /api/auth/invites/<token>/redeem` is `user_id`-only (401 anonymous), so a
  recipient who installed but never opened the app has no bridged identity yet;
  those fall through to the "open the app first" state, then redeem on next
  interaction. The closed-before-join filter applies as usual, but
  `redeem_invite` backdates `joined_at` to the invite's creation time, so a poll
  that closed between share and open stays visible (existing behavior). Every
  bubble is now a capability token — acceptable, mirrors how an invite link
  already works, and the invite is poll-scoped + revocable.
- **Vote submission goes through the atomic batch endpoint**
  (`POST /api/polls/{id}/votes`) like every other surface. Inline transcript
  voting is realistic for **yes_no** (two taps) and **limited_supply**
  (claim/decline); ranking, time grids, and suggestion entry are not transcript
  material (keyboard / drag interactions) — those get "Open in app" or an
  expanded-presentation ballot later.

---

## Recommended architecture (one paragraph)

The MSMessage payload (`MSMessage.url` components) carries the poll uuid + a
deep-link URL that doubles as the macOS/web fallback: the canonical
`/g/<groupShort>/p/<pollShort>` for public groups, or `/invite/<token>` for
private groups (decision B — the token auto-joins the recipient). The transcript
live layout is a small native SwiftUI
view: poll title + compact live results + (for yes_no/limited_supply) tap-to-vote
buttons, all fetched/POSTed against the per-tier API with the App-Group-bridged
identity. The server stays the single source of truth; the bubble is a live
window onto it, so simultaneous voters, web voters, and bubble voters all
converge without MSSession gymnastics. Recipients without the app get the
template-layout fallback and (on iOS) an App Store prompt — which is why the
in-app share button keeps emitting plain URLs and the bubble lives only in the
Messages drawer.

## Phases

### Phase 0 — target scaffold + CI wiring (SHIPPED, pending device verification)

What landed:
- **`MessagesExtension` target** added to `ios/App/App.xcodeproj` via the
  `xcodeproj` ruby gem (`scripts/ios/add-messages-extension.rb`, idempotent;
  the resulting `project.pbxproj` is committed so CI needs no gem). The gem runs
  on Linux, so the project structure was generated + validated from the sandbox
  without a Mac. Product type `com.apple.product-type.app-extension.messages`,
  storyboard-free (principal class `MessagesViewController`), embedded into the
  App target via an "Embed Foundation Extensions" copy phase + target dependency.
- **`MessagesViewController.swift`** — a static SwiftUI placeholder (👋 +
  "shareable polls are coming to Messages"). No identity bridge, no networking,
  no live layout yet.
- **iMessage App Icon set** generated by `scripts/ios/gen-imessage-icon.py`
  into a `.stickersiconset` (NOT `.appiconset` — actool compiles a Messages
  icon as sticker content; the wrong folder type fails the archive with "did not
  have any applicable content"). Composites the app's transparent-corner 👋 mark
  onto opaque-black canvases at the full 13-image Xcode-canonical set (square
  29×29 + square 1024×1024 + the 3:2 Messages sizes + the 1024×768 App Store
  icon); a partial set is also a hard actool archive failure.
- **`ios-build.yml`** updated: the bundle-id sed now patches BOTH targets
  (extension-first, anchored, so `.MessagesExtension` survives); the Archive step
  dropped its global `PRODUCT_BUNDLE_IDENTIFIER` override (it would have forced
  both targets onto one id in the Info.plist — the per-target pbxproj patch is
  the source of truth). Export uses automatic signing, which auto-resolves both
  bundle ids.

**Key decision — NO entitlements in Phase 0.** The extension carries no App
Group / keychain group, so automatic signing self-provisions the new bundle ids
(`com.whoeverwants.app[.latest].MessagesExtension`) with **zero manual Apple
Developer portal steps**. This is what makes a green canary CI build achievable
without a human in the loop. The App Group identity bridge (reading
`NativeIdentityAppGroup`) is therefore a **Phase 1 prerequisite**, and adding it
will require the one-time manual portal step of registering the "App Groups"
capability on both extension bundle ids (automatic signing does NOT auto-create
App Groups — same caveat the host app already documents in `App.entitlements`).

- Exit criteria: (CI) canary iOS build is green — archives + embeds the `.appex`
  + uploads to TestFlight. (Owner, device) the Messages drawer shows the app and
  the placeholder view on a real iPhone. CI is the validatable half from the
  sandbox; the device half is owner-owned, consistent with every prior native
  phase (Siri, push, haptics).

### Phase 1 — share a poll from the drawer (SHIPPED, pending device verification)

What landed (all in `ios/App/MessagesExtension/MessagesViewController.swift` —
self-contained; the tier/identity helpers from AppDelegate.swift are duplicated
there because the extension can't import App-target sources, keep in lockstep):
- **Entitlements:** `MessagesExtension.entitlements` carries the App Group
  (`group.com.whoeverwants.siri`), wired via `CODE_SIGN_ENTITLEMENTS` on both
  configs (and into `add-messages-extension.rb` so the regenerator matches).
  Same group on both tiers → NO per-tier scoping step in ios-build.yml.
  **Prerequisite (manual, one-time):** register the "App Groups" capability +
  assign the group on `com.whoeverwants.app.MessagesExtension` and
  `com.whoeverwants.app.latest.MessagesExtension` in the Apple Developer portal
  — automatic signing does NOT auto-create App Groups; without it the archive
  fails at provisioning for the extension target.
- **Picker:** drawer lists the user's recent polls — the same
  `POST /api/groups/mine` fetch / title rule / newest-first sort / cap-50 as
  Siri's `PollEntity.fetchAll`, authenticated with the App-Group-bridged
  X-Browser-Id. No bridged identity → "Open WhoeverWants first" state (with a
  re-check button); distinct empty + network-error states. Private/Closed
  badges per row.
- **Share:** tapping a poll inserts an `MSMessage` (`MSMessageTemplateLayout`:
  runtime-rendered 👋-on-black image, poll title caption, group-name
  subcaption) into the compose field — never auto-sends. `message.url` =
  canonical `/g/<group>/p/<poll>` for public groups; for private groups a
  poll-scoped multi-use invite is minted (`POST /api/groups/<route>/invites`,
  `target_poll_id` set, no expiry — revocable from /info) and the url is
  `/invite/<token>?wwPoll=<pollShort>` (decision B). The `wwPoll` param is the
  extension-side payload (the token URL doesn't otherwise name the poll; the
  web ignores it). Invite minting is admin-only server-side — a non-admin
  member sharing a private-group poll falls back to the canonical URL and the
  recipient hits the normal request-access wall (degraded but coherent).
- **Bubble tap (recipient with app):** extension opens with
  `conversation.selectedMessage` set (cold via `willBecomeActive`, warm via
  `didSelect`) → native summary: title, group, Open/Closed, per-question live
  results (yes/no counts, claimed counts, winner/leader, time slots in the
  server's `_format_slot_label` shape; question labels mirror the web's
  `getQuestionSectionTitle` rules incl. the "Yes/No is a category, not display
  text" null), respondent count (name-multiplicity-aware, mirroring
  `namedVoterCount`), "Open in WhoeverWants" (`extensionContext.open`,
  copy-link fallback on failure) + an always-visible Copy Link button.
  *(Historical:)* originally fetched the identity-free
  `GET /api/polls/<short>` + per-question `GET /api/questions/<id>/results`
  (concurrent) — Phase 2 built the single identity-free
  `GET /api/polls/<short>/summary` endpoint and migrated this view onto it
  (one round-trip, shared `SummaryStore` cache with the transcript bubbles),
  which also frees the visibility-blind poll read to be tightened someday
  without breaking in-flight bubbles.
- CI: the drawer label (extension `CFBundleDisplayName`) is stamped per-tier
  ("Whoever" / "Whoever α") in the existing display-name step so testers with
  both apps can tell the drawer entries apart.
- Exit criteria: (CI) green canary build. (Owner, device) drawer picker lists
  polls, send a public + a private poll bubble, recipient tap shows the summary
  + results, invite-URL bubble redeems on the web fallback path.

### Phase 2 — live transcript bubble, read-only (SHIPPED, pending device verification)

What landed (Swift in `ios/App/MessagesExtension/MessagesViewController.swift`,
server in `routers/polls.py` + `models.py`; no entitlement / CI / pbxproj
changes — the bubble is pure code in the existing extension target):
- **Inserts switched to `MSMessageLiveLayout(alternateLayout: templateLayout)`**
  — the alternate IS the Phase 1 template, so no-app / macOS / SMS recipients
  are byte-identical to before.
- **`GET /api/polls/{short_id}/summary`** — the identity-free compact summary
  (model `PollSummaryResponse`): poll title (own-title rule), group display
  name (`group_display_name`, so unnamed groups resolve to participant names),
  `is_closed` + `response_deadline` (microseconds stripped — Swift's
  `ISO8601DateFormatter` rejects them), respondent count
  (name-multiplicity-aware, server-side now), and per-question
  `{label, result_text, yes/no/secured/supply counts}`. `result_text` +
  `label` are server-rendered with the SAME helpers as the push-notification
  copy (`_compute_results`, `_format_slot_label`, the auto-title
  `_CATEGORY_LABELS`) and the same wording the Phase 1 Swift rendered
  client-side ("Yes 2 · No 1", "1/3 claimed", "Winner:"/"Leading:") — which
  let the Swift label/slot-formatting mirrors (`categoryLabels`,
  `questionLabel`, `prettySlot`) be DELETED. Public like `/preview` (a bubble
  is a deliberate capability share, decision B); does NOT write membership.
  Tests: `server/tests/test_poll_summary.py`.
- **Transcript rendering**: `MessagesViewController` now mounts its UI on
  first `willBecomeActive` keyed on `presentationStyle` (Messages dedicates a
  VC instance per visible bubble, `.transcript`, separate from the drawer
  instance). The bubble (`TranscriptBubbleView`) shows title + per-question
  result lines (a proportional green/red bar for yes/no) + an
  "Open · ends in 2 hr · 5 people responded" footer (relative deadline
  computed at render — no ticking timer in the transcript, per Apple's
  guidance). `contentSizeThatFits` returns a fixed 148pt; >2 questions
  collapse into "+N more" so the fixed height never clips mid-row.
  **Device-found pitfall:** Messages overlays the extension's APP ICON on
  the bubble's top-left corner (OS-drawn, immovable, invisible in mockups)
  — the first line indents `iconBadgeClearance = 44` clear of it; lower
  rows aren't overlapped and keep the full width.
- **`SummaryStore`** — process-level cache (20s TTL) + in-flight coalescing
  shared by every transcript instance AND the Phase 1 expanded summary view
  (which migrated onto the `/summary` endpoint, retiring its
  poll + N-results fan-out). Stale-on-error: a bubble re-render that fails
  serves the last summary rather than an error state.
- **Read-only by design; the transcript VC owns the tap.** Live bubbles get
  no template-style tap-to-open from Messages (device-verified: an unhandled
  tap did nothing), so the bubble's SwiftUI tree is hit-testing-disabled
  (+ `isUserInteractionEnabled = false` on the hosting view) and a
  `UITapGestureRecognizer` on the VC's root view calls
  `requestPresentationStyle(.expanded)` — the system opens a new expanded
  instance with the bubble's message selected → the Phase 1 summary view.
  Phase 3 adds the inline vote buttons.
- **Private-group bubbles render WITHOUT redeeming the invite** — supersedes
  this phase's original "redeem before fetching" sketch, which assumed the
  bubble would use the visibility-aware fetch. The summary endpoint is
  identity-free, so there's no 404 to recover from, and redeeming on a
  passive transcript render would auto-join people to a group because they
  scrolled past a bubble (membership = home-list entry + notifications —
  too surprising). Redemption stays on the explicit paths: the
  `/invite/<token>` web fallback, "Open in WhoeverWants", and Phase 3's
  vote-time join.
- Exit criteria: (CI) green canary build. (Owner, device — Simulator works
  for the inner loop here, unlike Siri) a freshly-sent bubble renders the
  live summary in the transcript on both sides, updates after a web vote
  (leave + reopen the conversation re-fetches), the fixed-height bubble looks
  right for 1-question and 3-question polls, tap still opens the expanded
  summary, and a no-app recipient still sees the Phase 1 template fallback.

### Phase 3 — inline voting in the transcript (SHIPPED, pending device verification)

What landed (Swift only in `ios/App/MessagesExtension/MessagesViewController.swift`
— **NO server, migration, entitlement, CI, or pbxproj change**: `/summary`
already returns `poll_id` + per-question counts, voting reuses the existing
atomic batch `POST /api/polls/{id}/votes` + own-vote `GET /api/questions/{id}/votes`
+ the App-Group identity wired in Phase 1):
- **The transcript SwiftUI tree is now INTERACTIVE.** Phase 2's read-only design
  (`allowsHitTesting(false)` on the tree + a UIKit `UITapGestureRecognizer` on
  the VC view to drive `requestPresentationStyle(.expanded)`) is replaced: the
  recognizer is gone, the hosting view is interactive, and the bubble drives the
  expand itself — the title / result rows / footer are each wrapped in a plain
  SwiftUI `Button` calling `model.requestExpand()` (→ `host?.requestPresentationStyle(.expanded)`),
  while the vote buttons are sibling `Button`s that consume their own taps. Live
  bubbles still get NO template-style tap-to-open from Messages (device-verified),
  so an explicit tappable region everywhere is the design — not a fall-through.
- **Inline voting is gated to a SINGLE-question poll whose one question is
  `yes_no` (Yes / No) or `limited_supply` (Claim a spot / No thanks).** Closed,
  multi-question, and other types (ranked / time / showtime — they need
  ranking / grids / keyboard) stay read-only; tapping opens the expanded summary.
  `PollSummary.inlineVotableQuestion` is the gate.
- **Identity-gated on the App-Group name+browserId** (`BridgedIdentity.load()` now
  returns both — `name` = the batch endpoint's required `voter_name`, `browserId`
  = `X-Browser-Id`). With identity, buttons are live; without it they render
  disabled under "Set your name in the app to vote" (a transcript can't take
  keyboard input — the nameless user taps through to the expanded summary →
  Open in WhoeverWants → set their name in the app, then come back).
- **Edit, don't duplicate.** On load (votable + identity) the bubble fetches the
  viewer's OWN vote via `GET /api/questions/{id}/votes` (ballot-privacy-scoped to
  their browser) → highlights the current choice + remembers the `vote_id`. A
  vote sends the batch POST with `vote_id` set (EDIT — the server uses the row's
  existing vote_type + enforces browser-ownership) or null (INSERT). Re-tapping
  the current choice is a no-op. On success the bubble force-refreshes the
  summary (`SummaryStore.refresh`, bypassing the 20s TTL) so the aggregate counts
  update at once; `myVotes` is updated straight from the POST response.
- **Vote-time join for free.** The batch endpoint `join_group_for_poll`s the
  voter, so voting on a private-group bubble auto-joins them (the plan's vote-time
  join) with no separate invite redeem — voting doesn't gate on visibility
  server-side (the privacy gate is read-only).
- **`TranscriptBubbleModel.voting: VotingTarget?`** (the exact `{questionId,
  yesNoChoice, isAbstain}` being submitted) drives the spinner on the SPECIFIC
  tapped button + gates re-taps — NOT a "differs from current selection" guess,
  which would spin both buttons for a first-time voter. A transient POST failure
  leaves the prior bubble untouched; the buttons re-enable when `voting` clears.
- **`bubbleHeight` bumped 148 → 168** to fit a vote-button row above the footer
  (one fixed height serves every shape since votable-ness isn't known
  synchronously at `contentSizeThatFits` time; read-only bubbles absorb the slack
  via the Spacer — the owner may tune on device).
- **No post-vote `MSSession` "bump"** (the plan's optional cosmetic) — skipped: it
  adds chat noise and correctness never depends on it (other viewers' bubbles
  refresh on their own ≤20s SummaryStore TTL / re-render; the server is the
  source of truth).
- **Deferred (not in this phase) — NOW SHIPPED in the "Expanded-view ballot"
  section below:** voting in the EXPANDED summary view, multi-question inline
  voting, and in-extension name entry for nameless recipients. (The one piece
  still NOT done: a true account *mint* via `POST /api/auth/account/name` — the
  expanded ballot uses the typed name as `voter_name` + remembers it in the App
  Group instead; see that section for why.)
- Exit criteria: (CI) green canary build (compiles the interactive tree). (Owner,
  device — Simulator works for the inner loop) a single-question yes_no/limited_
  supply bubble shows live vote buttons, tapping Yes/No (or Claim/Decline) records
  the vote + updates the counts without leaving Messages, a second tap CHANGES
  (doesn't duplicate) the vote, tapping the title/footer still opens the expanded
  summary, a nameless viewer sees disabled buttons + the hint, and a private-group
  bubble vote joins the voter (poll appears in their app afterward).

### Phase 4 — compose-a-poll-in-Messages (decision D, SHIPPED, pending device verification)

What landed (Swift in `ios/App/MessagesExtension/MessagesViewController.swift` +
ONE pbxproj change; **no server / migration / entitlement / CI-logic change**):
- **The shared `PollTextParser.swift` is now compiled into the extension target**
  (the documented "pure-Foundation file shared with the App target" precedent —
  it carries the JS↔Swift parity contract, so a duplicate would rot). Added to
  the extension's Sources phase idempotently by `scripts/ios/add-messages-extension.rb`
  (which now finds-or-creates the target, then ensures the parser ref); the
  committed `project.pbxproj` gains exactly one PBXBuildFile reusing the existing
  App-target file ref. No new file + no new target → the bundle-id sed count in
  `ios-build.yml` is unaffected (still app×2 + ext×2), and the parser parity
  harness (`scripts/ios/test-parser.sh`, compiles the file standalone) is
  untouched.
- **"New poll" entry in the drawer** (a row above "Share a poll" in the loaded
  list AND the primary CTA in the empty state). Tapping it requests `.expanded`
  (a text field needs the keyboard, only allowed in expanded — never
  compact/transcript) and shows `ComposeView`: a text field + a LIVE preview of
  the poll the prompt would make (the same `PollTextParser.decide` the in-app
  search box's top suggestion uses) + a create button.
- **options / yes-no → headless create.** `PollAPI.createPoll` mirrors
  `QuickPollService.createPoll` (POST `/api/polls`, App-Group identity, no bearer
  bridged → the new poll lands in a PUBLIC group) and returns a `SharablePoll`,
  whose bubble is inserted into the conversation immediately — the killer demo:
  make + share a poll without leaving the chat. The created poll's bubble is the
  same `MSMessageLiveLayout` insert as Phase 1/2 (canonical URL, no invite mint
  since the group is public).
- **category → "Open WhoeverWants to finish."** A `.category` poll (restaurant /
  time / movie / …) can't be finished in a transcript — it needs the form's time
  windows / suggestion entry / reference location — so the button label changes
  to "Open WhoeverWants to finish" (announced up front, not a surprise tap) and
  opens the in-app create form prefilled via the SAME `?create=1&category=…&for=…`
  deep link Siri's `.category` fallback uses (`PollAPI.createCategoryURL` mirrors
  `whoeverwantsCreatePollURL`). The in-app create path stays exposed (owner
  constraint: the composer is additive, never the only way).
- **iOS 16+ (the parser is gated there).** All New-poll entry points + the
  `ComposeView`/`ComposePreview` + the create method are behind
  `#available(iOS 16.0, *)`; iOS 15 users keep the prior empty-state guidance and
  no composer (additive). The RootView routing puts `#available` as the SOLE
  condition of its branch so the result builder applies `buildLimitedAvailability`
  to the iOS-16-only `ComposeView` type.
- **Identity:** re-checked at create time (name + browserId from the App Group);
  the New-poll entry only appears once a bridged identity exists (the picker's
  `.needsApp` state precedes it), so the create's name-gate is defensive. A
  compose session is preserved across a Messages background/foreground (the
  `activate` no-URL branch returns early while `composing`), and a bubble tap
  (selectedMessage) supersedes it.
- Exit criteria: (CI) green canary build (compiles the parser into the ext +
  the compose tree). (Owner, device — Simulator works for the inner loop) the
  drawer shows "New poll", typing "pizza, tacos, or sushi" previews a pick-one
  and creates+inserts it, a "should we…" prompt makes a yes/no, a "movie for
  friday" prompt opens the app's create form, and the inserted bubble behaves
  like any other (live results, Phase 3 inline voting).

### Expanded-view ballot (deferred Phase 3/4 item, SHIPPED, pending device verification)

Make the tapped-bubble expanded summary (`SummaryView`) an INTERACTIVE ballot —
the natural home for the things the transcript can't do, because `.expanded` is
the one presentation style that takes keyboard input. All Swift in
`ios/App/MessagesExtension/MessagesViewController.swift`; **no server, migration,
entitlement, CI, or pbxproj change** (reuses `/summary`, the atomic batch
`POST /api/polls/{id}/votes`, the own-vote `GET /api/questions/{id}/votes`, and
the Phase 1 App-Group identity).

What landed:
- **Per-question vote rows in the summary.** Each open `yes_no` (Yes / No) or
  `limited_supply` (Claim / No thanks) question renders inline vote buttons
  (decision C — ranked / time / showtime stay read-only result lines + "Open in
  app"). Unlike the transcript's single-question gate
  (`PollSummary.inlineVotableQuestion`), this is **per-question**
  (`ExtensionModel.isBallotVotable`), so a **multi-question** poll gets a vote
  row for each tap-votable question, each submitted independently through the
  batch endpoint (the endpoint already supports per-item subsets — the in-app
  wrapper stages subsets too).
- **In-extension name entry.** A recipient who has USED the app (browser id
  bridged) but never set a name gets a `TextField` (the keyboard works in
  `.expanded`); the typed name becomes the vote's `voter_name`. A recipient who
  has NEVER opened the app (no bridged browser id) can't attribute a vote, so the
  buttons disable under "Open WhoeverWants once to vote here." When a bridged
  name exists, no field shows and the buttons are live directly.
- **NO account mint — typed name is `voter_name` + remembered in the App Group.**
  Deliberately NOT calling `POST /api/auth/account/name`: that endpoint, for a
  bearer-less caller (the extension never bridges the bearer), ALWAYS routes to
  `create_name_only_account`, which mints a NEW account and re-points the browser
  via `link_browser_to_user` — orphaning any existing browser-tied account (no
  merge on that path). So instead the typed name rides the vote as `voter_name`
  (exactly how anonymous web voting attributes), and `BridgedIdentity.rememberName`
  writes `display_name` into the App Group so the next bubble/transcript vote on
  this device doesn't re-prompt. Caveat: the app's `NativeIdentitySync` clears
  that key on next launch if the app itself has no name set, so a fully-nameless
  app user may have to re-type later — accepted for v1. (A clean account-set would
  need a bearer-less "set name on the browser's existing-or-new account without
  duplicating" server path, which doesn't exist yet — out of scope.)
- **Edit-not-duplicate + live refresh, mirroring the transcript.** On load, the
  ballot fetches the viewer's own vote per votable question (concurrent
  `withTaskGroup`, only when a browser id is bridged) → highlights current
  choices + remembers `vote_id` for edits. A vote force-refreshes the summary
  (`SummaryStore.refresh`) so the read-only result lines + respondent count
  update at once. `ballotVoting: VotingTarget?` drives the per-button spinner +
  re-tap gate; a transient failure leaves the prior ballot untouched.
- **Shared `VoteChoiceButton`.** The tuned pill (selected tint/outline, in-flight
  spinner, disabled gate) was extracted from the transcript's `VoteButtonRow` so
  the transcript + expanded ballot can't drift; `VotingTarget` was lifted to a
  top-level struct shared by both. State lives on `ExtensionModel`
  (`ballotVotes` / `ballotVoting` / `ballotName`), reset + name-seeded in
  `showSummary`.
- **The sender reaches it too** — tapping their own sent bubble opens the same
  summary, so the composer→share→vote loop closes without leaving Messages.
- Exit criteria: (CI) green canary build. (Owner, device — Simulator works for
  the inner loop) tapping a bubble for a multi-question yes_no/limited_supply
  poll shows a vote row per question; voting updates counts in place; a second
  tap edits (doesn't duplicate); a nameless-but-app-used recipient can type a
  name and vote; a never-opened-the-app recipient sees the "open once" guidance;
  ranked/time questions stay read-only with Open-in-app.

### Phase 5 — richer surfaces (only if earlier phases earn it)

**Native ranked-choice expanded ballot — SHIPPED, pending device verification.**
The first Phase 5 increment (owner-greenlit). The expanded summary view's ballot
(`SummaryView` → `BallotQuestionRow`) now lets a recipient RANK a ranked_choice
question inline, alongside the existing yes_no/limited_supply rows. Per-question,
so a multi-question poll can mix a yes/no row and a ranked row. What landed:
- **Server (one additive field, no migration):** `PollSummaryQuestionResponse`
  gains `options: list[str] | None`, populated by `_summarize_question`
  (`routers/polls.py`) ONLY for `ranked_choice` questions with finalized
  `options` (null for every other type AND for a ranked poll still in its
  suggestion phase — which therefore stays read-only in the bubble). Options
  text only, no `options_metadata` (the bubble renders plain labels). Tests:
  `test_poll_summary.py` (`test_options_only_surfaced_for_ranked_choice` +
  the ranked-winner test now asserts `options`).
- **Swift (all in `MessagesViewController.swift`, no entitlement/CI/pbxproj
  change):** `QuestionSummary.options` parsed from `/summary`; `BubbleVote`
  gains `rankedChoices` (parsed from the own-vote GET + the POST response) so an
  edit restores the viewer's prior order; `submitVote` gains a defaulted
  `rankedChoices:` param sending `vote_type:"ranked_choice"` + `ranked_choices`
  through the SAME atomic batch endpoint (strict ranking, NO tiers — the bubble
  is a "simple taps" surface, and the server treats a missing
  `ranked_choice_tiers` as singleton tiers). `ExtensionModel.isBallotVotable`
  extends to ranked (open + ≥2 options); `ballotRankOrder` (per-question working
  order, seeded from the existing vote in `loadBallotVotes`, reset in
  `showSummary`) drives a tap-to-rank UI (`rankedSection` in `BallotQuestionRow`:
  tap an option to append it in preference order with its rank badge, tap again
  to remove) + an explicit Submit/Update button (`submitRanking` — ranking isn't
  a single tap; edit-not-duplicate + live `SummaryStore.refresh`, mirroring
  `voteInBallot`). `VotingTarget(questionId, nil, false)` drives the submit
  spinner + re-tap gate (no collision — a question is ranked XOR
  limited_supply). Transcript inline voting stays yes_no/limited_supply only
  (decision C — a scrolling transcript is the wrong place to build up an order).
- Exit criteria: (CI) green canary build (compiles the ranked ballot). (Owner,
  device — Simulator works for the inner loop) tapping a bubble for a
  ranked_choice poll shows the candidate list; tapping options builds a numbered
  ranking; Submit records the vote + updates the result line; a second pass
  Updates (doesn't duplicate); a closed or suggestion-phase ranked poll stays
  read-only; multi-question polls mixing yes/no + ranked show both row types.

**Still gated (not yet earned):**
- Expanded-presentation ballots for **time/showtime** polls (native) — the
  availability/preference grid is heavy even in-app; deferred until the bubble
  proves worth it on device.
- A **WKWebView** in expanded style loading the poll detail page with the
  session injected via `WKUserScript` (localStorage seed from the App Group
  identity) — would unlock every type at once, but prototype before committing;
  memory + auth-injection complexity are both real.

## Resolved decisions (owner, June 2026)

A. **Ship the additive bubble despite the degraded no-app fallback** — "worth
   trying." Recipients without the app get an App Store prompt instead of the
   website; accepted because the in-app share button still emits plain URLs, so
   the bubble is drawer-only and additive.
B. **Embed an invite token in the payload for private groups** (NOT a locked
   "request access" state) — the recipient auto-joins like an invite link. Each
   bubble becomes a poll-scoped, revocable capability token; see the membership
   bullet above for the redemption-needs-an-account caveat.
C. **v1 inline voting = yes_no + limited_supply only.** Everything else is
   read-only in the bubble + "Open in app."
D. **Pursue Phase 4 compose-in-Messages**, with the standing constraint that the
   in-app create path remains exposed (the composer is additive, never
   exclusive).

## Sources

- https://developer.apple.com/documentation/messages/msmessagelivelayout
- https://developer.apple.com/documentation/messages/msmessagesappviewcontroller
- https://developer.apple.com/videos/play/wwdc2017/234/ (live layout rules: no
  keyboard in transcript, simple taps, teardown behavior)
- https://developer.apple.com/documentation/messages/mssession (in-place updates;
  the simultaneous-update data-loss caveat)
- https://medium.com/@jankammerath/inside-imessage-extensions-the-quirky-world-of-apples-niche-development-tools-32520fc1f5a7
  (ecosystem stagnation / drawer discoverability)
