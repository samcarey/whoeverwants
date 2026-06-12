# iMessage Extension Plan (interactive polls in the Messages transcript)

> **Purpose.** A phased plan for embedding interactive WhoeverWants polls inside
> Apple iMessage via a Messages app extension, with `MSMessageLiveLayout` powering a
> live, tappable poll bubble in the conversation transcript. Written so a future
> session can pick it up cold.
>
> **Status (June 2026): research + plan only — no code yet.** Several owner
> decisions are needed before Phase 1 (see "Open questions" at the bottom).
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
  visiting the URL), private groups 404. v1 renders private/404 as a locked
  "Open in WhoeverWants to request access" state. The closed-before-join filter
  applies as usual.
- **Vote submission goes through the atomic batch endpoint**
  (`POST /api/polls/{id}/votes`) like every other surface. Inline transcript
  voting is realistic for **yes_no** (two taps) and **limited_supply**
  (claim/decline); ranking, time grids, and suggestion entry are not transcript
  material (keyboard / drag interactions) — those get "Open in app" or an
  expanded-presentation ballot later.

---

## Recommended architecture (one paragraph)

The MSMessage payload (`MSMessage.url` components) carries only the canonical
poll URL (`/g/<groupShort>/p/<pollShort>`) + poll uuid; it doubles as the
macOS/web fallback link. The transcript live layout is a small native SwiftUI
view: poll title + compact live results + (for yes_no/limited_supply) tap-to-vote
buttons, all fetched/POSTed against the per-tier API with the App-Group-bridged
identity. The server stays the single source of truth; the bubble is a live
window onto it, so simultaneous voters, web voters, and bubble voters all
converge without MSSession gymnastics. Recipients without the app get the
template-layout fallback and (on iOS) an App Store prompt — which is why the
in-app share button keeps emitting plain URLs and the bubble lives only in the
Messages drawer.

## Phases

### Phase 0 — owner decisions + target scaffold (Mac mini, one-time)

- Decide the open questions below (especially the fallback tradeoff).
- On the Mac mini, add the `MessagesExtension` target in Xcode (storyboard-free,
  SwiftUI hosting), commit `ios/` changes, and extend `ios-build.yml`: bundle-id
  patching for both targets, per-tier extension entitlements (App Group +
  keychain access group), verify archive embeds the `.appex` and altool still
  uploads with `--apple-id`.
- Exit criteria: a canary TestFlight build whose Messages drawer shows the app
  icon and an empty "hello" compact view, on a real device.

### Phase 1 — share a poll from the drawer (template layout, no live layout yet)

- Compact/expanded view lists the user's recent polls (the `PollEntity.fetchAll`
  fetch via the App Group identity; signed-out/nameless → "open the app first"
  state).
- Tapping a poll inserts an `MSMessage` with `MSMessageTemplateLayout` (app icon
  image, poll title as caption, `url` = canonical poll URL) into the compose
  field; user hits send.
- Tapping the bubble (recipient with app) opens the extension in expanded style:
  native poll summary + live results + "Open in WhoeverWants"
  (`extensionContext?.open` — known to be finicky from Messages extensions;
  budget time, fall back to "copy link" if it won't cooperate).
- Independently shippable; already useful without any live layout.

### Phase 2 — live transcript bubble (read-only)

- Switch inserts to `MSMessageLiveLayout(alternateLayout: templateLayout)` — the
  alternate IS the Phase 1 fallback, so non-app recipients are unchanged.
- Transcript instance renders title + live result bars + status (open/closed,
  countdown), fetched on `willBecomeActive`/render with a short in-process cache
  (multiple bubbles, aggressive teardown — keep fetches coalesced + tiny).
- `contentSizeThatFits` returns a fixed compact height; no scrolling inside the
  bubble.

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
- Compose-a-new-poll inside Messages: expanded view text field →
  `PollTextParser.decide` → headless create (the `QuickPollService` flow) →
  insert the bubble for the fresh poll. "Create and share a poll without leaving
  the conversation" is arguably the killer demo of the whole feature.

## Open questions (owner)

A. **Is the degraded no-app fallback acceptable?** Recipients without the app get
   an App Store prompt instead of the website. If most invitees are app-less,
   plain links remain the better share; the bubble then mainly serves
   app-having friend groups. (Recommendation: yes, ship it as additive —
   drawer-only, in-app share unchanged.)
B. **Private groups in the bubble:** locked "request access" state (recommended,
   matches web semantics) vs. embedding an invite token in the payload (auto-join
   like invite links — more magical, but turns every bubble into a capability
   token; needs the Phase G invite machinery per message).
C. **Which poll types vote inline in v1?** Recommendation: yes_no +
   limited_supply only; everything else read-only + open-in-app.
D. **Does Phase 4 compose-in-Messages matter enough to pull forward?** It reuses
   the Siri headless-create stack nearly verbatim.

## Sources

- https://developer.apple.com/documentation/messages/msmessagelivelayout
- https://developer.apple.com/documentation/messages/msmessagesappviewcontroller
- https://developer.apple.com/videos/play/wwdc2017/234/ (live layout rules: no
  keyboard in transcript, simple taps, teardown behavior)
- https://developer.apple.com/documentation/messages/mssession (in-place updates;
  the simultaneous-update data-loss caveat)
- https://medium.com/@jankammerath/inside-imessage-extensions-the-quirky-world-of-apples-niche-development-tools-32520fc1f5a7
  (ecosystem stagnation / drawer discoverability)
