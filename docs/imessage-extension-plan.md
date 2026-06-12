# iMessage Extension Plan (interactive polls in the Messages transcript)

> **Purpose.** A phased plan for embedding interactive WhoeverWants polls inside
> Apple iMessage via a Messages app extension, with `MSMessageLiveLayout` powering a
> live, tappable poll bubble in the conversation transcript. Written so a future
> session can pick it up cold.
>
> **Status (June 2026): Phase 0 (target scaffold + CI) shipped via #712;
> Phase 1 (share-from-drawer) shipped via #713; Phase 2 (live read-only
> transcript bubble + the identity-free `/summary` endpoint) implemented —
> see the Phase 2 section for what landed and the on-device verification
> owed.** Owner decisions are resolved (see "Resolved decisions" at the
> bottom).
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
  - **No keyboard input** in transcript style — text entry requires requesting
    `.expanded` (and `requestPresentationStyle` is itself not callable from a
    transcript instance; the user taps through instead).
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
- **`SummaryStore`** — process-level cache (20s TTL) + in-flight coalescing
  shared by every transcript instance AND the Phase 1 expanded summary view
  (which migrated onto the `/summary` endpoint, retiring its
  poll + N-results fan-out). Stale-on-error: a bubble re-render that fails
  serves the last summary rather than an error state.
- **Read-only by design**: the bubble's SwiftUI tree is hit-testing-disabled
  (+ `isUserInteractionEnabled = false` on the hosting view), so a tap falls
  through to Messages → extension opens expanded → the Phase 1 summary view.
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

### Phase 3 — inline voting in the transcript

- yes_no: Yes / No tap → name-gate check (App Group identity) → POST batch vote →
  optimistic re-render with fresh results. limited_supply: Claim / Decline, same
  shape.
- Nameless/signed-out users: transcript can't take keyboard input — render the
  buttons disabled with "Set your name in the app to vote" (or tap-through to
  expanded, which CAN host text entry, and reuse the name-only account mint
  `POST /api/auth/account/name`).
- Optional cosmetic: after voting, `conversation.send` a session-keyed update so
  the bubble bumps in the transcript for others. Skip if it adds chat noise —
  correctness never depends on it.

### Phase 4 — richer surfaces (only if earlier phases earn it)

- Expanded-presentation ballots for ranked/time polls (native), OR a WKWebView in
  expanded style loading the poll detail page with the session injected via
  `WKUserScript` (localStorage seed from the App Group identity) — prototype
  before committing; memory + auth-injection complexity are both real.
- **Compose-a-new-poll inside Messages (decision D — pursue it).** Expanded view
  text field → `PollTextParser.decide` → headless create (the `QuickPollService`
  flow) → insert the bubble for the fresh poll. "Create and share a poll without
  leaving the conversation" is the killer demo. **Constraint (owner): the
  in-app create path must stay exposed** — the Messages composer is purely
  additive, never the only way to make a poll. In practice the extension's text
  field only handles the parser-headless-creatable types (yes_no, options,
  category-deep-link); anything richer ("Open in WhoeverWants to finish") routes
  to the in-app create flow, same fork as Siri Phase 3's `.category` deep link.

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
