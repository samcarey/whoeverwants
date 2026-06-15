import Messages
import SwiftUI
import UIKit

// Phases 1–4 of docs/imessage-extension-plan.md — share a poll from the
// Messages drawer (Phase 1), the live transcript bubble (Phase 2) with inline
// voting (Phase 3), compose-in-Messages (Phase 4), plus the expanded-view
// ballot (the deferred Phase 3/4 item: vote on ANY votable question — including
// multi-question polls — from the tapped-bubble summary, with name entry, since
// .expanded takes keyboard input the transcript can't).
//
// What this does:
//   • Compact/expanded drawer view lists the user's recent polls (the same
//     `POST /api/groups/mine` fetch Siri's PollEntity.fetchAll uses), read with
//     the App-Group-bridged identity. No identity → "open the app first" state.
//   • Tapping a poll inserts an MSMessage whose layout is an
//     MSMessageLiveLayout wrapping the Phase 1 MSMessageTemplateLayout as its
//     alternate (icon, poll title caption, group subcaption) — recipients WITH
//     the app render the live transcript bubble; everyone else (no app, macOS,
//     SMS) gets the unchanged template fallback. The message url is the
//     canonical /g/<group>/p/<poll> for public groups, or a freshly-minted
//     poll-scoped /invite/<token> for private groups (owner decision B — the
//     bubble doubles as a revocable capability token; recipients auto-join
//     like an invite link).
//   • The transcript bubble (presentationStyle == .transcript, one dedicated
//     VC instance per visible bubble) renders title + live result lines (a
//     proportional bar for yes/no) + open/closed status + deadline +
//     respondent count, fetched from the identity-free
//     GET /api/polls/<short>/summary through a process-level cache
//     (SummaryStore) so several bubbles re-rendering in one conversation
//     coalesce into one round-trip. Rendering NEVER redeems the embedded
//     invite token — the summary endpoint is identity-free, and joining a
//     group because you scrolled past a bubble would surprise; redemption
//     stays on the explicit open-in-app / web / vote paths.
//   • Phase 3 — INLINE VOTING in the transcript. A SINGLE-question poll whose
//     one question is yes_no (Yes / No) or limited_supply (Claim / No thanks)
//     gets tap-to-vote buttons in the bubble; everything else (closed,
//     multi-question, ranked/time) stays read-only. The SwiftUI tree is now
//     INTERACTIVE (no allowsHitTesting(false); the old UIKit tap recognizer
//     is gone): the vote buttons are SwiftUI Buttons, and the title / results
//     / footer are wrapped in plain Buttons that requestPresentationStyle(
//     .expanded) — live bubbles get NO template-style tap-to-open from
//     Messages (device-verified), so the bubble drives the expand itself.
//     Voting is identity-gated on the App-Group name+browserId (the
//     name-required model — a transcript can't take keyboard input, so a
//     nameless viewer sees disabled buttons + "Set your name in the app to
//     vote" and taps through to the expanded summary). The bubble fetches the
//     viewer's OWN vote (GET /api/questions/<id>/votes, ballot-privacy-scoped
//     to their browser) so it highlights the current choice and EDITS rather
//     than duplicates on a change; votes go through the atomic batch
//     POST /api/polls/<id>/votes (which join_group_for_poll's the voter, so a
//     private-group bubble auto-joins them on vote — the plan's vote-time
//     join — no separate invite redeem needed). On success the bubble force-
//     refreshes the summary so the aggregate counts update immediately. No
//     post-vote MSSession "bump" (skipped per the plan — it adds chat noise
//     and correctness never depends on it; other viewers' bubbles refresh on
//     their own ≤20s SummaryStore TTL / re-render).
//   • Tapping a sent bubble (recipient WITH the app) opens the extension
//     expanded with `conversation.selectedMessage` set → a native poll summary
//     with live results + "Open in WhoeverWants" (extensionContext.open is
//     famously finicky from Messages extensions, so Copy Link is the always-
//     available fallback and the open failure path copies too). The summary
//     consumes the same /summary endpoint + SummaryStore as the bubble. It is
//     also an INLINE BALLOT: each open yes_no / limited_supply question (decision
//     C) — across multi-question polls too — gets vote buttons, edit-not-
//     duplicate via the viewer's own-vote fetch, just like the transcript. A
//     nameless recipient (browser id bridged, no name) gets a name field (the
//     keyboard works in .expanded), so they vote without leaving Messages; a
//     never-opened-the-app recipient (no browser id) is guided to open it once.
//     Voting force-refreshes the summary so the read-only result lines update.
//   • Phase 4 — COMPOSE a poll without leaving Messages. The drawer's "New
//     poll" entry (and the empty state's CTA) opens an expanded text field
//     (keyboard needs .expanded); the typed prompt is parsed LOCALLY by the
//     shared PollTextParser (now compiled into this target — the precedent for
//     a pure-Foundation file shared with the App target) into the same poll
//     shape the in-app search box's top suggestion would make, with a live
//     preview. options / yes-no polls are created HEADLESSLY (POST /api/polls
//     with the App-Group identity, mirroring QuickPollService — so the new
//     poll lands in a PUBLIC group, no bearer bridged) and the fresh poll's
//     bubble is inserted into the conversation immediately. category polls
//     (restaurant / time / …) can't be finished in a transcript (they need
//     time windows / suggestions / a reference location), so they route to the
//     in-app create form via the same `?create=1&category=…&for=…` deep link
//     Siri uses — the in-app create path stays exposed (owner constraint:
//     the composer is additive, never the only way). iOS 16+ (the parser is
//     gated there); the New-poll entry points are all behind #available.
//
// Architectural notes:
//   • The extension is a SEPARATE target and process. It cannot import
//     App-target sources without pbxproj surgery, so the small helpers from
//     AppDelegate.swift are DUPLICATED here and must be kept in lockstep:
//     the tier constants (isCanaryBundle / feHost / apiBase ↔
//     whoeverwantsIsCanaryBundle / whoeverwantsFEHost / QuickPollService.apiBase),
//     the App Group reader (BridgedIdentity ↔ NativeIdentityAppGroup), and the
//     /api/groups/mine fetch+parse (PollAPI.fetchMyPolls ↔ PollEntity.fetchAll).
//     If a THIRD copy of the polls fetch ever appears, extract a shared
//     pure-Foundation file compiled into both targets (the PollTextParser.swift
//     precedent) instead of duplicating again.
//   • Identity = name + browser id from the shared App Group
//     (group.com.whoeverwants.siri), the channel proven to cross process
//     boundaries in the Siri work (plain Keychain does NOT). The bearer token
//     is deliberately not bridged; X-Browser-Id resolves to the account
//     server-side, exactly like the headless Siri create.
//   • The server stays the source of truth: the message payload carries only
//     URLs/ids, never poll state, so web voters and bubble viewers can't
//     diverge (no MSSession update churn needed for correctness).

// MARK: - Tier helpers (mirror AppDelegate.swift — keep in lockstep)

// The extension's bundle id is "<host app id>.MessagesExtension", so the canary
// build is com.whoeverwants.app.latest.MessagesExtension — prefix-match the
// host id rather than equality. Process-constant, so plain lazily-initialized
// globals (not computed vars re-deriving per network call).
private let isCanaryBundle: Bool =
    Bundle.main.bundleIdentifier?.hasPrefix("com.whoeverwants.app.latest") == true

// FE host the WebView loads for this tier (deep links + share URLs).
private let feHost: String =
    isCanaryBundle ? "latest.whoeverwants.com" : "whoeverwants.com"

// Direct cross-origin API host (NOT the FE host), mirroring lib/api/_internal.ts.
// FastAPI CORS is allow_origins=["*"] / allow_credentials=False, so a native
// request with X-Browser-Id as the identity header is exactly the browser shape.
private let apiBase: String =
    isCanaryBundle ? "https://api.latest.whoeverwants.com" : "https://api.whoeverwants.com"

// MARK: - Bridged identity (App Group reader; writer is NativeIdentityPlugin)

private enum BridgedIdentity {
    static let suiteName = "group.com.whoeverwants.siri"
    static let nameKey = "display_name"
    static let browserIdKey = "browser_id"

    // The bridged name + browser id, present together iff the user has
    // actually used the app (the name-required model Siri's
    // QuickPollService.loadIdentity gates on). The name is the `voter_name`
    // the batch endpoint requires (non-blank), the browser id the
    // X-Browser-Id that attributes the vote to their account.
    struct Value {
        let name: String
        let browserId: String
    }

    static func load() -> Value? {
        guard let d = UserDefaults(suiteName: suiteName),
              let name = d.string(forKey: nameKey), !name.isEmpty,
              let browserId = d.string(forKey: browserIdKey), !browserId.isEmpty else {
            return nil
        }
        return Value(name: name, browserId: browserId)
    }

    // Browser-id-only convenience for the picker fetch + invite mint, which
    // don't need the name. Stays gated on a non-empty name via load().
    static func loadBrowserId() -> String? { load()?.browserId }

    // The bridged browser id WITHOUT the name gate. The expanded-view ballot
    // (reached by tapping a received bubble) lets a recipient who has USED the
    // app — so a browser id is bridged — but never set a name TYPE one and
    // vote, since .expanded allows keyboard input (the transcript doesn't).
    // load()/loadBrowserId() keep the name gate for the picker + invite mint,
    // which need a usable named account.
    static func browserIdUnchecked() -> String? {
        guard let d = UserDefaults(suiteName: suiteName),
              let browserId = d.string(forKey: browserIdKey), !browserId.isEmpty else {
            return nil
        }
        return browserId
    }

    // Persist a name typed in the expanded ballot so the next bubble render /
    // transcript vote on this device doesn't re-prompt. Best-effort LOCAL
    // mirror only: the app stays the source of truth and re-syncs its own name
    // on next launch via NativeIdentitySync (which CLEARS this if the app has
    // no name set — so a fully-nameless app user may have to re-type later;
    // accepted for v1).
    static func rememberName(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let d = UserDefaults(suiteName: suiteName) else { return }
        d.set(trimmed, forKey: nameKey)
    }
}

// MARK: - Models

struct SharablePoll: Identifiable {
    let id: String            // poll uuid (invite target_poll_id)
    let shortId: String       // canonical addressable id (/g/<group>/p/<shortId>)
    let title: String
    let groupShortId: String?
    let groupName: String?
    let groupIsPrivate: Bool
    let isClosed: Bool
}

// Parsed GET /api/polls/<short>/summary — the server renders the label +
// result_text (shared helpers with the push-notification copy), the counts
// ride along for the yes/no bar (and Phase 3's inline voting).
struct QuestionSummary: Identifiable {
    let id: String            // question uuid
    let label: String?        // disambiguator in multi-question polls
    let type: String          // question_type
    let resultText: String?   // server-rendered one-line result
    let yesCount: Int?
    let noCount: Int?
    // Candidate list for the expanded ranked ballot (Phase 5) — server
    // surfaces it only for ranked_choice with finalized options; nil for
    // every other type and for a ranked poll still in its suggestion phase.
    let options: [String]?
    // Candidate slots for the expanded time/showtime want/neutral/can't ballot
    // (Phase 5) — server surfaces them (key + friendly label) only for finalized
    // time / showtime questions; nil for every other type, for a time poll still
    // collecting availability, and for a cancelled event.
    let slots: [SlotSummary]?
}

// A time/showtime candidate slot: `key` is the liked_slots/disliked_slots
// payload value, `label` is the server-rendered friendly form the bubble shows.
struct SlotSummary: Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

// A slot's want/can't mark in the expanded ballot. Absent = neutral; tapping a
// slot cycles neutral → want → can't → neutral (mirrors the web TimeSlotBubbles
// / ShowtimeBubbles tri-state). like → liked_slots ("want"), dislike →
// disliked_slots ("can't attend").
enum SlotChoice: Equatable { case like, dislike }

struct PollSummary {
    let pollId: String        // POST target for inline votes (Phase 3)
    let title: String
    let groupName: String?
    let isClosedFlag: Bool    // server is_closed; display closed-ness via isClosed
    let responseDeadline: Date?
    let respondentCount: Int
    let questions: [QuestionSummary]

    // Mirrors the FE's isPollOpen: a passed deadline reads as closed even
    // before the server's per-minute tick flips is_closed. Computed at
    // RENDER (not parse) so a cached summary stays honest across the
    // crossing.
    var isClosed: Bool {
        if isClosedFlag { return true }
        if let deadline = responseDeadline { return deadline <= Date() }
        return false
    }

    // The single question eligible for INLINE transcript voting (Phase 3):
    // exactly one question, of a tap-votable type (yes_no / limited_supply),
    // poll still open, poll id present. Multi-question polls and other types
    // (ranked / time / showtime — they need ranking / grids / keyboard) stay
    // read-only in the bubble; tapping opens the expanded summary instead.
    var inlineVotableQuestion: QuestionSummary? {
        guard !isClosed, !pollId.isEmpty, questions.count == 1,
              let q = questions.first,
              q.type == "yes_no" || q.type == "limited_supply" else { return nil }
        return q
    }
}

// The viewer's own vote on a question — fetched (GET /votes) for the
// selection highlight, returned by the vote POST. `yes_no_choice` is
// "yes"/"no" for yes_no; `isAbstain` is the decline for limited_supply (and
// the abstain for yes_no, which the bubble doesn't offer but tolerates).
struct BubbleVote {
    let voteId: String
    let yesNoChoice: String?
    let isAbstain: Bool
    // The viewer's existing ranking, so the expanded ranked ballot (Phase 5)
    // restores their order on edit. nil for non-ranked votes.
    let rankedChoices: [String]?
    // The viewer's existing time/showtime marks, so the want/can't ballot
    // restores them on edit. Raw arrays (NOT nonEmpty'd) — an empty array is a
    // meaningful "marked nothing" state, distinct from nil = no slot vote.
    let likedSlots: [String]?
    let dislikedSlots: [String]?
    // The voter's in-app time availability, captured opaquely so a preference
    // EDIT from the bubble re-sends it verbatim — the server direct-writes these
    // columns on a time edit (NOT COALESCE), so omitting them clobbers the
    // voter's availability and the winner's slot-availability headcount. nil for
    // showtime and for a bubble-only voter who never submitted availability.
    let voterDayTimeWindows: [[String: Any]]?
    let voterDuration: [String: Any]?
    let voterMinParticipants: Int?
}

extension BubbleVote {
    // Single parser for a VoteResponse-shaped row (own-vote GET + batch POST
    // both return this shape) so the two callsites can't drift.
    static func parse(_ row: [String: Any]) -> BubbleVote? {
        guard let vid = PollAPI.nonEmpty(row["id"] as? String) else { return nil }
        return BubbleVote(
            voteId: vid,
            yesNoChoice: PollAPI.nonEmpty(row["yes_no_choice"] as? String),
            isAbstain: (row["is_abstain"] as? Bool) ?? false,
            rankedChoices: PollAPI.nonEmpty(row["ranked_choices"] as? [String]),
            likedSlots: row["liked_slots"] as? [String],
            dislikedSlots: row["disliked_slots"] as? [String],
            voterDayTimeWindows: row["voter_day_time_windows"] as? [[String: Any]],
            voterDuration: row["voter_duration"] as? [String: Any],
            voterMinParticipants: row["voter_min_participants"] as? Int
        )
    }
}

// The exact choice being submitted — drives the spinner on the SPECIFIC tapped
// button (not both, which a "differs from current selection" guess would do for
// a first-time voter) and gates re-taps until it clears. Shared by the
// transcript bubble (single votable question) AND the expanded-view ballot
// (per-question across multi-question polls).
struct VotingTarget: Equatable {
    let questionId: String
    let yesNoChoice: String?
    let isAbstain: Bool
}

// MARK: - API

private enum PollAPI {
    // Treat empty strings as absent — the API can return "" for an unset
    // override, which should never surface as a title / id / group.
    static func nonEmpty(_ s: String?) -> String? { s.flatMap { $0.isEmpty ? nil : $0 } }
    // Array sibling — an empty array (e.g. options on a non-ranked question) is
    // "absent" the same way an empty string is.
    static func nonEmpty(_ a: [String]?) -> [String]? { a.flatMap { $0.isEmpty ? nil : $0 } }

    private static func jsonRequest(url: URL, method: String, browserId: String?, body: [String: Any]? = nil) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let browserId = browserId, !browserId.isEmpty {
            request.setValue(browserId, forHTTPHeaderField: "X-Browser-Id")
        }
        if let body = body {
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    // The user's recent polls — the same POST /api/groups/mine fetch (and the
    // same questions[0].title-over-display-title rule, newest-first sort, and
    // cap) as Siri's PollEntity.fetchAll (AppDelegate.swift — keep in
    // lockstep). Browser-scoped visibility: polls the user created/joined on
    // THIS device; cross-device-only polls won't surface until opened here
    // (same accepted limitation as Siri).
    static func fetchMyPolls(browserId: String) async throws -> [SharablePoll] {
        guard let url = URL(string: apiBase + "/api/groups/mine") else { throw URLError(.badURL) }
        let request = jsonRequest(url: url, method: "POST", browserId: browserId,
                                  body: ["include_results": false])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw URLError(.badServerResponse)
        }
        let polls: [(poll: SharablePoll, createdAt: String)] = arr.compactMap { obj in
            guard let uuid = nonEmpty(obj["id"] as? String),
                  let shortId = nonEmpty(obj["short_id"] as? String) else { return nil }
            let questions = obj["questions"] as? [[String: Any]]
            let title = nonEmpty(questions?.first?["title"] as? String)
                ?? nonEmpty(obj["title"] as? String) ?? "Poll"
            return (
                poll: SharablePoll(
                    id: uuid,
                    shortId: shortId,
                    title: title,
                    groupShortId: nonEmpty(obj["group_short_id"] as? String),
                    groupName: nonEmpty(obj["group_title"] as? String),
                    groupIsPrivate: (obj["group_privacy"] as? String) == "private",
                    isClosed: (obj["is_closed"] as? Bool) ?? false
                ),
                createdAt: (obj["created_at"] as? String) ?? ""
            )
        }
        // created_at is ISO-8601 → lexicographic descending is chronological.
        return polls.sorted { $0.createdAt > $1.createdAt }.prefix(50).map { $0.poll }
    }

    // Mint a poll-scoped multi-use invite for a private group (decision B).
    // Admin-only server-side (`_require_admin` resolves the actor via the
    // browser→account link, so X-Browser-Id alone authenticates an admin who
    // uses the app on this device). Returns the raw token, or nil on ANY
    // failure — including 403 for a non-admin member, the expected degraded
    // path: the share falls back to the canonical URL and the recipient hits
    // the normal "Private Group / request access" wall. No expiry: the invite
    // stays revocable from the group's /info invites list, mirroring how a
    // hand-shared invite link already works. The CALLER caches the token per
    // poll for the session (ExtensionModel.inviteTokens) so re-sharing the
    // same poll doesn't accumulate invite rows; the raw token is hash-stored
    // server-side and can never be re-listed, so cross-session shares mint
    // fresh ones — accepted (see the plan doc).
    static func mintInviteToken(groupRoute: String, pollUuid: String, browserId: String?) async -> String? {
        guard let url = URL(string: apiBase + "/api/groups/\(groupRoute)/invites") else { return nil }
        let request = jsonRequest(url: url, method: "POST", browserId: browserId,
                                  body: ["mode": "multi", "target_poll_id": pollUuid])
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return nonEmpty(obj["token"] as? String)
    }

    // Private-group share URL: the invite token path auto-joins the recipient
    // on the web exactly like a hand-shared invite link; `wwPoll` is the
    // extension-side payload (the token URL doesn't otherwise name the poll —
    // only WE read the param; it's registered next to POLL_QUERY_PARAM in
    // lib/groupUtils.ts so the web side knows it exists).
    static func inviteURL(token: String, pollShortId: String) -> URL? {
        URL(string: "https://\(feHost)/invite/\(token)?wwPoll=\(pollShortId)")
    }

    // Canonical poll URL — mirrors getGroupHrefForPoll (lib/groupUtils.ts) and
    // the Siri intents' path building. The path itself names the poll, so
    // public shares need no extra payload params. group_short_id is NOT NULL
    // post-migration 101; the home fallback is defensive only (never emit the
    // legacy /p/<short> form — it's redirect-stub-only).
    static func canonicalURL(for poll: SharablePoll) -> URL {
        guard let group = poll.groupShortId,
              let url = URL(string: "https://\(feHost)/g/\(group)/p/\(poll.shortId)") else {
            return URL(string: "https://\(feHost)/")!
        }
        return url
    }

    // Recover the poll short_id from a received message's url: the explicit
    // `wwPoll` param (invite-URL form) or the canonical /g/<group>/p/<short>
    // path. Nil → not one of our poll bubbles (or a malformed payload).
    static func pollShortId(fromMessageURL url: URL) -> String? {
        if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
           let p = nonEmpty(items.first(where: { $0.name == "wwPoll" })?.value) {
            return p
        }
        let parts = url.path.split(separator: "/").map(String.init)
        if let i = parts.firstIndex(of: "p"), i + 1 < parts.count, parts.first == "g" {
            return parts[i + 1]
        }
        return nil
    }

    // Poll summary for the transcript bubble AND the recipient's expanded
    // view — ONE identity-free round-trip to GET /api/polls/<short>/summary
    // (Phase 2; replaced the Phase 1 poll-read + per-question results
    // fan-out). The server renders labels / winners / slot formatting with
    // the same helpers as the push-notification copy, so nothing here can
    // drift from it. Callers go through SummaryStore (cache + coalescing),
    // never call this directly from a view.
    static func fetchSummary(shortId: String) async throws -> PollSummary {
        guard let url = URL(string: apiBase + "/api/polls/\(shortId)/summary") else { throw URLError(.badURL) }
        let (data, response) = try await URLSession.shared.data(for: jsonRequest(url: url, method: "GET", browserId: nil))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw URLError(.badServerResponse)
        }
        let questions: [QuestionSummary] = ((obj["questions"] as? [[String: Any]]) ?? []).compactMap { q in
            guard let qid = nonEmpty(q["id"] as? String) else { return nil }
            let slots = (q["slots"] as? [[String: Any]])?.compactMap { s -> SlotSummary? in
                guard let key = nonEmpty(s["key"] as? String) else { return nil }
                return SlotSummary(key: key, label: nonEmpty(s["label"] as? String) ?? key)
            }
            return QuestionSummary(
                id: qid,
                label: nonEmpty(q["label"] as? String),
                type: (q["question_type"] as? String) ?? "yes_no",
                resultText: nonEmpty(q["result_text"] as? String),
                yesCount: q["yes_count"] as? Int,
                noCount: q["no_count"] as? Int,
                options: nonEmpty(q["options"] as? [String]),
                slots: (slots?.isEmpty ?? true) ? nil : slots
            )
        }
        return PollSummary(
            pollId: nonEmpty(obj["poll_id"] as? String) ?? "",
            title: nonEmpty(obj["title"] as? String) ?? "Poll",
            groupName: nonEmpty(obj["group_name"] as? String),
            isClosedFlag: (obj["is_closed"] as? Bool) ?? false,
            responseDeadline: parseISODate(nonEmpty(obj["response_deadline"] as? String)),
            respondentCount: (obj["respondent_count"] as? Int) ?? 0,
            questions: questions
        )
    }

    // Inline vote (Phase 3): one item through the atomic batch endpoint, the
    // same POST /api/polls/{id}/votes every surface uses. EDITS when voteId is
    // set (no duplicate row; the server uses the existing row's vote_type and
    // enforces browser-ownership), else INSERTS (vote_type required). The
    // endpoint join_group_for_poll's the voter, so a private-group bubble
    // auto-joins them here (the plan's vote-time join). Returns the resulting
    // row so the bubble can update its selection without a separate re-fetch.
    static func submitVote(
        pollId: String, questionId: String, voteId: String?, voteType: String,
        yesNoChoice: String?, isAbstain: Bool, rankedChoices: [String]? = nil,
        likedSlots: [String]? = nil, dislikedSlots: [String]? = nil,
        voterDayTimeWindows: [[String: Any]]? = nil, voterDuration: [String: Any]? = nil,
        voterMinParticipants: Int? = nil,
        name: String, browserId: String
    ) async throws -> BubbleVote {
        guard let url = URL(string: apiBase + "/api/polls/\(pollId)/votes") else { throw URLError(.badURL) }
        var item: [String: Any] = ["question_id": questionId, "is_abstain": isAbstain]
        if let voteId = voteId {
            item["vote_id"] = voteId       // edit
        } else {
            item["vote_type"] = voteType   // insert
        }
        if let choice = yesNoChoice { item["yes_no_choice"] = choice }
        // Strict ranking only (no tiers/equal rankings — the transcript can't
        // express them); the server treats a missing ranked_choice_tiers as
        // singleton tiers from this flat list.
        if let ranked = rankedChoices { item["ranked_choices"] = ranked }
        // Time/showtime want/can't. Re-send the captured availability on a time
        // edit so the server's direct-write doesn't NULL it (see BubbleVote).
        if let liked = likedSlots { item["liked_slots"] = liked }
        if let disliked = dislikedSlots { item["disliked_slots"] = disliked }
        if let w = voterDayTimeWindows { item["voter_day_time_windows"] = w }
        if let d = voterDuration { item["voter_duration"] = d }
        if let m = voterMinParticipants { item["voter_min_participants"] = m }
        let body: [String: Any] = ["voter_name": name, "items": [item]]
        let request = jsonRequest(url: url, method: "POST", browserId: browserId, body: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let row = arr.first(where: { ($0["question_id"] as? String) == questionId }) ?? arr.first,
              let vote = BubbleVote.parse(row) else {
            throw URLError(.badServerResponse)
        }
        return vote
    }

    // The caller's OWN vote on a question (GET /api/questions/{id}/votes is
    // ballot-privacy-scoped to their browser set), so the bubble highlights
    // the current choice and edits rather than duplicates. Returns nil on any
    // failure / no prior vote → the bubble just inserts. `.last` = most recent
    // in the rare legacy multi-row case.
    static func fetchMyVote(questionId: String, browserId: String) async -> BubbleVote? {
        guard let url = URL(string: apiBase + "/api/questions/\(questionId)/votes") else { return nil }
        guard let (data, response) = try? await URLSession.shared.data(
                for: jsonRequest(url: url, method: "GET", browserId: browserId)),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let row = arr.last else {
            return nil
        }
        return BubbleVote.parse(row)
    }

    // Phase 4 — headless create from the in-Messages composer. Mirrors
    // QuickPollService.createPoll (AppDelegate.swift — keep in lockstep): POST
    // /api/polls with creator_name + an explicit title + the single question the
    // parser decided, identified by X-Browser-Id (no bearer is bridged, exactly
    // like the Siri headless create — so the new poll lands in a PUBLIC group,
    // shareable by canonical URL with no invite mint). Returns a SharablePoll
    // built from the PollResponse so the composer can immediately insert its
    // bubble. `.category` never reaches here — the composer routes it to the
    // create-form deep link (those polls need time windows / suggestions /
    // reference location the transcript can't collect).
    @available(iOS 16.0, *)
    static func createPoll(parsed: PollTextParser.Parsed, name: String, browserId: String?) async throws -> SharablePoll {
        guard let url = URL(string: apiBase + "/api/polls") else { throw URLError(.badURL) }
        var question: [String: Any]
        let title: String
        switch parsed.kind {
        case .options:
            question = [
                "question_type": "ranked_choice",
                "options": parsed.options,
                "winner_method": "consensus",
            ]
            if !parsed.context.isEmpty { question["context"] = parsed.context }
            title = PollTextParser.optionsTitle(parsed.options, context: parsed.context)
        case .yesNo, .category:
            question = ["question_type": "yes_no", "context": parsed.prompt]
            title = PollTextParser.yesNoTitle(parsed.prompt)
        }
        let body: [String: Any] = ["creator_name": name, "title": title, "questions": [question]]
        let request = jsonRequest(url: url, method: "POST", browserId: browserId, body: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let uuid = nonEmpty(obj["id"] as? String),
              let shortId = nonEmpty(obj["short_id"] as? String) else {
            throw URLError(.badServerResponse)
        }
        // Same parse as fetchMyPolls (questions[0].title over the display title,
        // which may carry the group-name override).
        let questions = obj["questions"] as? [[String: Any]]
        let pollTitle = nonEmpty(questions?.first?["title"] as? String)
            ?? nonEmpty(obj["title"] as? String) ?? title
        return SharablePoll(
            id: uuid,
            shortId: shortId,
            title: pollTitle,
            groupShortId: nonEmpty(obj["group_short_id"] as? String),
            groupName: nonEmpty(obj["group_title"] as? String),
            groupIsPrivate: (obj["group_privacy"] as? String) == "private",
            isClosed: (obj["is_closed"] as? Bool) ?? false
        )
    }

    // Deep link to the in-app create form for a `.category` poll (the composer
    // can't finish these — they need the form). Mirrors
    // whoeverwantsCreatePollURL(path:category:context:) (AppDelegate.swift): no
    // literal title, so the web auto-titles "<Category> for <context>".
    static func createCategoryURL(category: String, context: String) -> URL? {
        var c = URLComponents()
        c.scheme = "https"
        c.host = feHost
        c.path = "/g/"
        var items = [
            URLQueryItem(name: "create", value: "1"),
            URLQueryItem(name: "category", value: category),
        ]
        let ctx = context.trimmingCharacters(in: .whitespacesAndNewlines)
        if !ctx.isEmpty { items.append(URLQueryItem(name: "for", value: ctx)) }
        c.queryItems = items
        return c.url
    }

    // The endpoint strips microseconds server-side specifically so the strict
    // ISO8601DateFormatter parses it ("2026-06-20T19:00:00+00:00").
    // Configured once and only read afterwards → safe as a static.
    private static let isoParser = ISO8601DateFormatter()
    private static func parseISODate(_ s: String?) -> Date? {
        s.flatMap { isoParser.date(from: $0) }
    }
}

// MARK: - Summary cache (process-level)

// Shared by every transcript bubble instance AND the expanded summary view.
// Messages hosts several live transcript instances in one extension process
// and tears them down aggressively (scroll away + back = a fresh instance),
// so re-renders must not refetch every time and two bubbles for the same poll
// must share one in-flight request. @MainActor reentrancy is the coalescing
// mechanism: callers awaiting the same Task interleave at the suspension
// point and all see `inFlight`.
@MainActor
final class SummaryStore {
    static let shared = SummaryStore()

    private var cache: [String: (summary: PollSummary, fetchedAt: Date)] = [:]
    private var inFlight: [String: Task<PollSummary, Error>] = [:]

    func summary(shortId: String, maxAge: TimeInterval = 20) async throws -> PollSummary {
        if let hit = cache[shortId], Date().timeIntervalSince(hit.fetchedAt) < maxAge {
            return hit.summary
        }
        if let task = inFlight[shortId] {
            return try await task.value
        }
        let task = Task { try await PollAPI.fetchSummary(shortId: shortId) }
        inFlight[shortId] = task
        defer { inFlight[shortId] = nil }
        do {
            let summary = try await task.value
            cache[shortId] = (summary, Date())
            return summary
        } catch {
            // A slightly-stale summary beats an error state for a passive
            // bubble in the transcript.
            if let hit = cache[shortId] { return hit.summary }
            throw error
        }
    }

    // Force a fresh fetch (bypassing the TTL) and update the cache — used
    // right after the viewer votes so THIS bubble shows the new aggregate
    // counts immediately. Other bubbles for the same poll pick it up on their
    // own next render (≤ maxAge TTL).
    func refresh(shortId: String) async throws -> PollSummary {
        let task = Task { try await PollAPI.fetchSummary(shortId: shortId) }
        inFlight[shortId] = task
        defer { inFlight[shortId] = nil }
        let summary = try await task.value
        cache[shortId] = (summary, Date())
        return summary
    }
}

// MARK: - View model

@MainActor
final class ExtensionModel: ObservableObject {
    enum PickerState {
        case loading
        case needsApp       // no bridged identity — open the app first
        case empty
        case error
        case loaded([SharablePoll])
    }

    enum SummaryState {
        case loading(URL)
        case loaded(PollSummary, URL)
        case failed(URL)
    }

    // Phase 4 compose flow (expanded view; keyboard needs .expanded). Editing →
    // (creating → editing-on-error) → inserted+dismissed. Equatable so the view
    // can compare against `.creating` for the in-flight button spinner.
    enum ComposeState: Equatable {
        case editing
        case creating
        case error(String)
    }

    @Published var pickerState: PickerState = .loading
    @Published var summary: SummaryState?    // non-nil → summary mode (a bubble was tapped)
    @Published var composing = false         // true → compose mode (supersedes picker)
    @Published var composeState: ComposeState = .editing
    @Published var insertingPollId: String?  // row spinner while minting/inserting
    @Published var toast: String?

    // Expanded-view ballot (vote from the summary without leaving Messages —
    // the deferred Phase 3/4 item that .expanded uniquely enables, since it
    // takes keyboard input). Per-question votes drive the selection highlight +
    // edit-vs-insert; `ballotVoting` is the in-flight choice (spinner + re-tap
    // gate); `ballotName` is the voter_name (seeded from the bridged name, or
    // typed by a nameless recipient). Reset + seeded when a summary opens.
    @Published var ballotVotes: [String: BubbleVote] = [:]
    @Published var ballotVoting: VotingTarget?
    @Published var ballotName: String = ""
    // Per-question working ranking for the expanded ranked ballot (Phase 5).
    // questionId → ordered option texts (best first). Built up by tapping
    // options in order; seeded from the viewer's existing vote on load, so an
    // edit starts from their prior order. Submitted explicitly (ranking isn't a
    // single tap), unlike yes_no/limited_supply which submit on tap.
    @Published var ballotRankOrder: [String: [String]] = [:]
    // Per-question want/can't marks for the expanded time/showtime ballot
    // (Phase 5). questionId → slotKey → choice (absent = neutral). Seeded from
    // the viewer's existing liked/disliked on load; submitted explicitly
    // (preferences aren't a single tap), like the ranked ballot.
    @Published var ballotSlots: [String: [String: SlotChoice]] = [:]

    weak var host: MessagesViewController?

    private var lastFetch: Date?
    // poll uuid → minted invite token, so re-sharing the same private poll in
    // one session reuses the invite instead of accumulating rows (the raw
    // token is one-shot server-side, so this cache is the only reuse possible).
    private var inviteTokens: [String: String] = [:]
    private var toastDismissTask: Task<Void, Never>?

    // Called on every willBecomeActive: route to the summary (a bubble was
    // tapped → selectedMessage is set), preserve an in-progress compose session
    // across a background/foreground round-trip, or load the picker.
    func activate(selectedMessageURL: URL?) {
        if let url = selectedMessageURL {
            // A bubble tap supersedes any compose session.
            composing = false
            showSummary(for: url)
        } else if composing {
            // Stay in compose — don't wipe the user's typed prompt. (Presentation
            // transitions don't fire willBecomeActive; this only guards an actual
            // Messages background/foreground while composing.)
            return
        } else {
            summary = nil
            loadPickerIfStale()
        }
    }

    func reloadPicker() {
        lastFetch = nil
        loadPickerIfStale()
    }

    // Re-check identity + refetch on activation, but don't refetch on every
    // compact↔expanded transition — 30s of staleness is fine for a share picker.
    private func loadPickerIfStale() {
        if let last = lastFetch, Date().timeIntervalSince(last) < 30,
           case .loaded = pickerState {
            return
        }
        guard let browserId = BridgedIdentity.loadBrowserId() else {
            pickerState = .needsApp
            return
        }
        if case .loaded = pickerState {} else { pickerState = .loading }
        Task {
            do {
                let polls = try await PollAPI.fetchMyPolls(browserId: browserId)
                pickerState = polls.isEmpty ? .empty : .loaded(polls)
                lastFetch = Date()
            } catch {
                pickerState = .error
            }
        }
    }

    // Share = (mint-or-reuse invite for private groups →) build URL → insert.
    func share(_ poll: SharablePoll) {
        guard insertingPollId == nil else { return }
        insertingPollId = poll.id
        Task {
            let url = await shareURL(for: poll)
            host?.insertPollMessage(caption: poll.title, subcaption: poll.groupName, url: url) { [weak self] ok in
                self?.insertingPollId = nil
                if !ok { self?.showToast("Couldn't add the poll — try again") }
            }
        }
    }

    private func shareURL(for poll: SharablePoll) async -> URL {
        guard poll.groupIsPrivate, let groupRoute = poll.groupShortId else {
            return PollAPI.canonicalURL(for: poll)
        }
        var token = inviteTokens[poll.id]
        if token == nil {
            token = await PollAPI.mintInviteToken(
                groupRoute: groupRoute, pollUuid: poll.id,
                browserId: BridgedIdentity.loadBrowserId()
            )
            inviteTokens[poll.id] = token
        }
        guard let token = token, let url = PollAPI.inviteURL(token: token, pollShortId: poll.shortId) else {
            return PollAPI.canonicalURL(for: poll)
        }
        return url
    }

    func showSummary(for url: URL) {
        guard let shortId = PollAPI.pollShortId(fromMessageURL: url) else {
            summary = .failed(url)
            return
        }
        summary = .loading(url)
        // Fresh ballot per poll; seed the name field from the bridged name
        // (empty → a nameless recipient types one before voting).
        ballotVotes = [:]
        ballotVoting = nil
        ballotRankOrder = [:]
        ballotSlots = [:]
        ballotName = BridgedIdentity.load()?.name ?? ""
        Task {
            do {
                let s = try await SummaryStore.shared.summary(shortId: shortId)
                // The user may have navigated back to the picker mid-fetch.
                if case .loading(let pending)? = summary, pending == url {
                    summary = .loaded(s, url)
                    await loadBallotVotes(s)
                }
            } catch {
                if case .loading(let pending)? = summary, pending == url {
                    summary = .failed(url)
                }
            }
        }
    }

    func dismissSummary() {
        summary = nil
        loadPickerIfStale()
    }

    // MARK: Expanded-view ballot

    // A question the expanded ballot can submit inline: yes_no / limited_supply
    // (tap → submit) OR ranked_choice with ≥2 finalized options (tap-to-rank →
    // explicit submit — Phase 5). The expanded view uniquely allows ranking
    // because it isn't a scrolling transcript; the transcript bubble stays
    // yes_no/limited_supply only (decision C). Time / showtime still need
    // grids and stay read-only + "Open in app". A ranked poll in its suggestion
    // phase has no finalized options (options nil) → not yet rankable here.
    // Unlike the transcript's single-question `inlineVotableQuestion`, this is
    // per-question, so a multi-question poll gets a vote row for each votable
    // question.
    static func isBallotVotable(_ q: QuestionSummary, poll: PollSummary) -> Bool {
        guard !poll.isClosed else { return false }
        switch q.type {
        case "yes_no", "limited_supply": return true
        case "ranked_choice": return (q.options?.count ?? 0) >= 2
        // Finalized time/showtime → tri-state want/can't over the slots. A time
        // poll still collecting availability has no slots (nil) → read-only.
        case "time", "showtime": return (q.slots?.count ?? 0) >= 1
        default: return false
        }
    }

    // Fetch the viewer's existing vote for each votable question (only when a
    // browser id is bridged), so the ballot highlights current choices and edits
    // rather than duplicates. Concurrent; best-effort (a miss → the row inserts).
    private func loadBallotVotes(_ summary: PollSummary) async {
        guard let browserId = BridgedIdentity.browserIdUnchecked() else { return }
        let votable = summary.questions.filter { Self.isBallotVotable($0, poll: summary) }
        guard !votable.isEmpty else { return }
        await withTaskGroup(of: (String, BubbleVote?).self) { group in
            for q in votable {
                group.addTask { (q.id, await PollAPI.fetchMyVote(questionId: q.id, browserId: browserId)) }
            }
            for await (qid, vote) in group {
                if let vote = vote {
                    ballotVotes[qid] = vote
                    let q = summary.questions.first(where: { $0.id == qid })
                    // Seed the ranked ballot's working order from the existing
                    // vote (filtered to options still on the ballot) so an edit
                    // starts from the viewer's prior ranking.
                    if let ranked = vote.rankedChoices, let opts = q?.options {
                        let valid = Set(opts)
                        ballotRankOrder[qid] = ranked.filter { valid.contains($0) }
                    }
                    // Seed the time/showtime marks from the existing liked/disliked
                    // (filtered to slots still on the ballot), restoring the
                    // viewer's want/can't on edit.
                    if let slots = q?.slots {
                        let valid = Set(slots.map { $0.key })
                        var marks: [String: SlotChoice] = [:]
                        for k in (vote.likedSlots ?? []) where valid.contains(k) { marks[k] = .like }
                        for k in (vote.dislikedSlots ?? []) where valid.contains(k) { marks[k] = .dislike }
                        if !marks.isEmpty { ballotSlots[qid] = marks }
                    }
                }
            }
        }
    }

    // Submit one question's choice through the atomic batch endpoint (same path
    // as the transcript + every other surface). Edits when a prior vote exists
    // (no duplicate row), else inserts. Re-tapping the current choice is a no-op.
    // On success, force-refreshes the summary so the read-only result lines +
    // respondent count reflect the new vote, and remembers a freshly-typed name
    // so the next bubble doesn't re-prompt. A transient failure leaves the prior
    // state untouched (the buttons re-enable when `ballotVoting` clears).
    func voteInBallot(question: QuestionSummary, poll: PollSummary, yesNoChoice: String?, isAbstain: Bool) {
        guard ballotVoting == nil else { return }
        let name = ballotName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let browserId = BridgedIdentity.browserIdUnchecked() else { return }
        if let mine = ballotVotes[question.id],
           mine.isAbstain == isAbstain, mine.yesNoChoice == yesNoChoice {
            return
        }
        ballotVoting = VotingTarget(questionId: question.id, yesNoChoice: yesNoChoice, isAbstain: isAbstain)
        BridgedIdentity.rememberName(name)
        Task {
            defer { ballotVoting = nil }
            do {
                let submitted = try await PollAPI.submitVote(
                    pollId: poll.pollId,
                    questionId: question.id,
                    voteId: ballotVotes[question.id]?.voteId,
                    voteType: question.type,
                    yesNoChoice: yesNoChoice,
                    isAbstain: isAbstain,
                    name: name,
                    browserId: browserId
                )
                ballotVotes[question.id] = submitted
                if case .loaded(_, let url)? = summary,
                   let short = PollAPI.pollShortId(fromMessageURL: url),
                   let fresh = try? await SummaryStore.shared.refresh(shortId: short) {
                    summary = .loaded(fresh, url)
                }
            } catch {
                // Keep the prior ballot; re-taps re-enable via the defer.
            }
        }
    }

    // Toggle an option in the working ranking (Phase 5): tap an unranked option
    // to append it (it becomes the next preference), tap a ranked one to remove
    // it (the rest renumber implicitly). No-op while a submit is in flight.
    func toggleRank(questionId: String, option: String) {
        guard ballotVoting == nil else { return }
        var order = ballotRankOrder[questionId] ?? []
        if let idx = order.firstIndex(of: option) {
            order.remove(at: idx)
        } else {
            order.append(option)
        }
        ballotRankOrder[questionId] = order
    }

    // Submit the working ranking through the same atomic batch endpoint
    // (vote_type "ranked_choice"; ranked_choices = the ordered list). Edits when
    // a prior vote exists (no duplicate); no-op when the order is empty or
    // unchanged. Mirrors voteInBallot's gating + live refresh; `ballotVoting`
    // (yesNoChoice nil) drives the submit-button spinner + re-tap gate.
    func submitRanking(question: QuestionSummary, poll: PollSummary) {
        guard ballotVoting == nil else { return }
        let name = ballotName.trimmingCharacters(in: .whitespacesAndNewlines)
        let order = ballotRankOrder[question.id] ?? []
        guard !name.isEmpty, !order.isEmpty,
              let browserId = BridgedIdentity.browserIdUnchecked() else { return }
        if let mine = ballotVotes[question.id], mine.rankedChoices == order { return }
        ballotVoting = VotingTarget(questionId: question.id, yesNoChoice: nil, isAbstain: false)
        BridgedIdentity.rememberName(name)
        Task {
            defer { ballotVoting = nil }
            do {
                let submitted = try await PollAPI.submitVote(
                    pollId: poll.pollId,
                    questionId: question.id,
                    voteId: ballotVotes[question.id]?.voteId,
                    voteType: "ranked_choice",
                    yesNoChoice: nil,
                    isAbstain: false,
                    rankedChoices: order,
                    name: name,
                    browserId: browserId
                )
                ballotVotes[question.id] = submitted
                ballotRankOrder[question.id] = submitted.rankedChoices ?? order
                if case .loaded(_, let url)? = summary,
                   let short = PollAPI.pollShortId(fromMessageURL: url),
                   let fresh = try? await SummaryStore.shared.refresh(shortId: short) {
                    summary = .loaded(fresh, url)
                }
            } catch {
                // Keep the prior ranking; re-submit re-enables via the defer.
            }
        }
    }

    // Cycle a slot's mark in the working time/showtime ballot (Phase 5):
    // neutral → want → can't → neutral (mirrors the web tri-state). No-op while
    // a submit is in flight.
    func cycleSlot(questionId: String, slotKey: String) {
        guard ballotVoting == nil else { return }
        var marks = ballotSlots[questionId] ?? [:]
        switch marks[slotKey] {
        case nil: marks[slotKey] = .like
        case .like: marks[slotKey] = .dislike
        case .dislike: marks[slotKey] = nil
        }
        ballotSlots[questionId] = marks
    }

    // Submit the working want/can't marks through the same atomic batch endpoint
    // (vote_type "time"/"showtime"; liked_slots = want, disliked_slots = can't).
    // Edits when a prior vote exists (no duplicate); no-op when nothing is marked
    // or the marks are unchanged. On a TIME edit, re-sends the captured
    // availability so the server's direct-write doesn't NULL it (see BubbleVote).
    // Mirrors submitRanking's gating + live refresh.
    func submitSlots(question: QuestionSummary, poll: PollSummary) {
        guard ballotVoting == nil else { return }
        let name = ballotName.trimmingCharacters(in: .whitespacesAndNewlines)
        let marks = ballotSlots[question.id] ?? [:]
        let liked = marks.filter { $0.value == .like }.map { $0.key }.sorted()
        let disliked = marks.filter { $0.value == .dislike }.map { $0.key }.sorted()
        guard !name.isEmpty, !(liked.isEmpty && disliked.isEmpty),
              let browserId = BridgedIdentity.browserIdUnchecked() else { return }
        if let mine = ballotVotes[question.id],
           Set(mine.likedSlots ?? []) == Set(liked),
           Set(mine.dislikedSlots ?? []) == Set(disliked) {
            return
        }
        ballotVoting = VotingTarget(questionId: question.id, yesNoChoice: nil, isAbstain: false)
        BridgedIdentity.rememberName(name)
        Task {
            defer { ballotVoting = nil }
            do {
                let existing = ballotVotes[question.id]
                let isTime = question.type == "time"
                let submitted = try await PollAPI.submitVote(
                    pollId: poll.pollId,
                    questionId: question.id,
                    voteId: existing?.voteId,
                    voteType: question.type,
                    yesNoChoice: nil,
                    isAbstain: false,
                    likedSlots: liked,
                    dislikedSlots: disliked,
                    voterDayTimeWindows: isTime ? existing?.voterDayTimeWindows : nil,
                    voterDuration: isTime ? existing?.voterDuration : nil,
                    voterMinParticipants: isTime ? existing?.voterMinParticipants : nil,
                    name: name,
                    browserId: browserId
                )
                ballotVotes[question.id] = submitted
                if case .loaded(_, let url)? = summary,
                   let short = PollAPI.pollShortId(fromMessageURL: url),
                   let fresh = try? await SummaryStore.shared.refresh(shortId: short) {
                    summary = .loaded(fresh, url)
                }
            } catch {
                // Keep the prior marks; re-submit re-enables via the defer.
            }
        }
    }

    // MARK: Compose (Phase 4 — create a poll without leaving Messages)

    // Enter compose mode. A text field needs keyboard input, which is only
    // allowed in .expanded (never compact/transcript), so request it.
    func startCompose() {
        summary = nil
        composeState = .editing
        composing = true
        host?.requestPresentationStyle(.expanded)
    }

    func exitCompose() {
        composing = false
        composeState = .editing
        loadPickerIfStale()
    }

    // Parse the typed prompt LOCALLY (the shared PollTextParser — same decision
    // the in-app search box's top suggestion makes), then:
    //   • .category → can't headlessly create (needs the form's time windows /
    //     suggestions / reference location) → open the prefilled create form in
    //     the app, same fork as Siri's `.category` deep link. The user finishes
    //     there and shares from the drawer.
    //   • .options / .yesNo → create HEADLESSLY (POST /api/polls with the
    //     App-Group identity) and insert the fresh poll's bubble into the
    //     conversation. The "killer demo": make + share a poll without leaving
    //     the chat.
    // Identity is re-checked here (the picker's New-poll entry is only shown once
    // there's a bridged identity, but a defensive guard costs nothing).
    @available(iOS 16.0, *)
    func createFromCompose(text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, composeState != .creating else { return }
        guard let identity = BridgedIdentity.load() else {
            composeState = .error("Open WhoeverWants and set your name to create a poll.")
            return
        }
        let parsed = PollTextParser.decide(trimmed)
        if parsed.kind == .category, let category = parsed.category {
            openCategoryForm(category: category, context: parsed.context)
            return
        }
        composeState = .creating
        Task {
            do {
                let poll = try await PollAPI.createPoll(
                    parsed: parsed, name: identity.name, browserId: identity.browserId
                )
                // Public group (no bearer bridged) → canonical URL; shareURL
                // handles the private case defensively (a fresh headless create
                // is always public, so it falls straight through).
                let url = await shareURL(for: poll)
                host?.insertPollMessage(caption: poll.title, subcaption: poll.groupName, url: url) { [weak self] ok in
                    if ok {
                        // insertPollMessage dismissed the drawer; reset so a
                        // reopen lands on the picker, not a stale compose.
                        self?.composing = false
                        self?.composeState = .editing
                    } else {
                        // The poll exists — let the user re-share it from the list.
                        self?.composeState = .error("Created the poll, but couldn't add it to the message. Share it from the list below.")
                        self?.composing = false
                        self?.reloadPicker()
                    }
                }
            } catch {
                composeState = .error("Couldn't create the poll. Check your connection and try again.")
            }
        }
    }

    // Open the in-app create form prefilled to the detected category + context
    // (`.category` polls finish in the WebView). extensionContext.open is
    // known-finicky from Messages extensions, so fall back to copying the link.
    private func openCategoryForm(category: String, context: String) {
        guard let url = PollAPI.createCategoryURL(category: category, context: context) else {
            composeState = .error("Couldn't build the create link. Try making this poll in the app.")
            return
        }
        host?.openURL(url) { [weak self] ok in
            if ok {
                self?.exitCompose()
            } else {
                UIPasteboard.general.url = url
                self?.composeState = .error("Couldn't open the app — link copied. Paste it in Safari to finish.")
            }
        }
    }

    // "Open in WhoeverWants": extensionContext.open is known-finicky from
    // Messages extensions (the plan budgets for it) — on failure, fall back to
    // copying the link so the user can paste it anywhere.
    func openInApp(_ url: URL) {
        host?.openURL(url) { [weak self] ok in
            if !ok {
                UIPasteboard.general.url = url
                self?.showToast("Couldn't open the app — link copied instead")
            }
        }
    }

    func copyLink(_ url: URL) {
        UIPasteboard.general.url = url
        showToast("Link copied")
    }

    func showToast(_ text: String) {
        toast = text
        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            if !Task.isCancelled { self?.toast = nil }
        }
    }
}

// MARK: - Transcript bubble view model (Phase 2)

// One per transcript VC instance (Messages creates a dedicated instance per
// visible bubble). Stateless beyond the fetched summary — transcript
// instances are torn down aggressively, so all reuse lives in SummaryStore.
@MainActor
final class TranscriptBubbleModel: ObservableObject {
    enum State {
        case loading
        case loaded(PollSummary)
        case unavailable   // unparseable url / fetch failed → static fallback
    }

    @Published var state: State = .loading
    // questionId → the viewer's own vote: drives the selection highlight and
    // edit-vs-insert. Populated from the own-vote fetch on load + the vote
    // POST response.
    @Published var myVotes: [String: BubbleVote] = [:]
    @Published var voting: VotingTarget?

    // Set by the VC at mount so a bubble tap can requestPresentationStyle.
    weak var host: MessagesViewController?

    private var shortId: String?

    func load(messageURL: URL?) {
        guard let url = messageURL,
              let short = PollAPI.pollShortId(fromMessageURL: url) else {
            state = .unavailable
            return
        }
        shortId = short
        Task {
            do {
                let summary = try await SummaryStore.shared.summary(shortId: short)
                state = .loaded(summary)
                await loadMyVoteIfVotable(summary)
            } catch {
                state = .unavailable
            }
        }
    }

    // Fetch the viewer's own vote for the single inline-votable question (only
    // when there's a bridged identity), so the bubble highlights the current
    // choice and edits rather than duplicates. No-op for read-only bubbles.
    private func loadMyVoteIfVotable(_ summary: PollSummary) async {
        guard let q = summary.inlineVotableQuestion,
              let id = BridgedIdentity.load() else { return }
        if let mine = await PollAPI.fetchMyVote(questionId: q.id, browserId: id.browserId) {
            myVotes[q.id] = mine
        }
    }

    // Tap-anywhere-but-a-button → open the expanded summary. Live bubbles get
    // no template-style tap-to-open from Messages (device-verified), so the
    // bubble drives the expand itself; .expanded is the only style a
    // transcript instance may request.
    func requestExpand() {
        host?.requestPresentationStyle(.expanded)
    }

    // yes_no Yes/No (yesNoChoice set, isAbstain false) or limited_supply
    // Claim (isAbstain false) / Decline (isAbstain true). Edits the viewer's
    // existing vote when present (no duplicate row), else inserts. Re-tapping
    // the current choice is a no-op. Force-refreshes the summary on success so
    // the counts reflect the new vote at once. A transient failure leaves the
    // prior state untouched (the buttons re-enable when `voting`
    // clears).
    func vote(question: QuestionSummary, poll: PollSummary, yesNoChoice: String?, isAbstain: Bool) {
        guard voting == nil, let id = BridgedIdentity.load() else { return }
        if let mine = myVotes[question.id],
           mine.isAbstain == isAbstain, mine.yesNoChoice == yesNoChoice {
            return
        }
        voting = VotingTarget(questionId: question.id, yesNoChoice: yesNoChoice, isAbstain: isAbstain)
        Task {
            defer { voting = nil }
            do {
                let submitted = try await PollAPI.submitVote(
                    pollId: poll.pollId,
                    questionId: question.id,
                    voteId: myVotes[question.id]?.voteId,
                    voteType: question.type,
                    yesNoChoice: yesNoChoice,
                    isAbstain: isAbstain,
                    name: id.name,
                    browserId: id.browserId
                )
                myVotes[question.id] = submitted
                if let short = shortId,
                   let fresh = try? await SummaryStore.shared.refresh(shortId: short) {
                    state = .loaded(fresh)
                }
            } catch {
                // Keep the prior bubble; re-taps re-enable via the defer.
            }
        }
    }
}

// MARK: - Messages app view controller

class MessagesViewController: MSMessagesAppViewController {

    // Lazy so a transcript instance never allocates the drawer model (and
    // vice versa) — each VC instance only ever serves ONE role: Messages
    // dedicates an instance per live transcript bubble (always .transcript)
    // and a separate one to the drawer (compact/expanded, never .transcript).
    private lazy var model = ExtensionModel()
    private lazy var bubbleModel = TranscriptBubbleModel()
    private var hasMountedUI = false

    // The UI is mounted on FIRST activation, not viewDidLoad — the role
    // (drawer vs transcript bubble) is keyed on presentationStyle, which is
    // only reliably set by the time willBecomeActive fires.
    private func mountUIIfNeeded() {
        guard !hasMountedUI else { return }
        hasMountedUI = true
        let controller: UIViewController
        if presentationStyle == .transcript {
            // Phase 3: the SwiftUI tree is now INTERACTIVE (vote buttons must
            // take taps). The bubble's own plain Buttons drive the
            // tap-to-expand (requestPresentationStyle(.expanded) via
            // bubbleModel.host) — live bubbles get NO template-style tap-to-open
            // from Messages (device-verified), so there's nothing to fall back
            // to a UIKit recognizer for, and an interactive hosting view would
            // consume those taps anyway.
            bubbleModel.host = self
            controller = UIHostingController(rootView: TranscriptBubbleView(model: bubbleModel))
        } else {
            model.host = self
            controller = UIHostingController(rootView: RootView(model: model))
        }
        // Retained via view-controller containment (addChild) — no property needed.
        controller.view.backgroundColor = .clear
        addChild(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        controller.didMove(toParent: self)
    }

    // Fires on every activation: transcript bubble render (presentationStyle
    // == .transcript), drawer open (selectedMessage nil → picker), AND cold
    // bubble tap (selectedMessage set → summary).
    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        mountUIIfNeeded()
        if presentationStyle == .transcript {
            bubbleModel.load(messageURL: conversation.selectedMessage?.url)
        } else {
            model.activate(selectedMessageURL: conversation.selectedMessage?.url)
        }
    }

    // Only consulted for transcript (live layout) instances. Fixed compact
    // height per the plan — content lays out top-aligned within it, never
    // scrolls. Messages passes the maximum bubble size as `size`.
    override func contentSizeThatFits(_ size: CGSize) -> CGSize {
        CGSize(width: size.width, height: TranscriptBubbleView.bubbleHeight)
    }

    // Fires when the user taps one of our bubbles while the extension is
    // already active (the warm path; cold taps arrive via willBecomeActive).
    override func didSelect(_ message: MSMessage, conversation: MSConversation) {
        super.didSelect(message, conversation: conversation)
        guard presentationStyle != .transcript else { return }
        if let url = message.url {
            model.showSummary(for: url)
        }
    }

    // Insert the staged message into the compose field (never auto-send — the
    // user reviews + hits send, per Apple's guidelines). On success, dismiss the
    // drawer UI so the staged bubble is front and center.
    func insertPollMessage(caption: String, subcaption: String?, url: URL, completion: @escaping (Bool) -> Void) {
        guard let conversation = activeConversation else {
            completion(false)
            return
        }
        let message = MSMessage(session: MSSession())
        let template = MSMessageTemplateLayout()
        template.image = Self.shareImage
        template.caption = caption
        template.subcaption = subcaption
        // Phase 2: live transcript bubble for recipients WITH the app; the
        // Phase 1 template stays as the alternate, so no-app / macOS / SMS
        // recipients see exactly what they saw before this change.
        message.layout = MSMessageLiveLayout(alternateLayout: template)
        message.url = url
        message.summaryText = caption
        conversation.insert(message) { [weak self] error in
            DispatchQueue.main.async {
                completion(error == nil)
                if error == nil { self?.dismiss() }
            }
        }
    }

    func openURL(_ url: URL, completion: @escaping (Bool) -> Void) {
        guard let context = extensionContext else {
            completion(false)
            return
        }
        context.open(url) { ok in
            DispatchQueue.main.async { completion(ok) }
        }
    }

    // The template layout's image — the app's 👋-on-black mark rendered at
    // runtime (the extension's icon lives in a .stickersiconset, which isn't
    // loadable via UIImage(named:), and bundling a second PNG would just be
    // one more asset to keep in sync). Rendered at scale 1: Messages
    // re-encodes the layout image anyway, and the default device scale would
    // pin a ~3 MB 3x bitmap for the extension's lifetime — real money under
    // an app extension's tight memory budget.
    static let shareImage: UIImage = {
        let size = CGSize(width: 300, height: 300)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.black.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            let emoji = "👋" as NSString
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 170)]
            let glyph = emoji.size(withAttributes: attrs)
            emoji.draw(
                at: CGPoint(x: (size.width - glyph.width) / 2, y: (size.height - glyph.height) / 2),
                withAttributes: attrs
            )
        }
    }()
}

// MARK: - SwiftUI views

struct RootView: View {
    @ObservedObject var model: ExtensionModel

    var body: some View {
        ZStack(alignment: .bottom) {
            content
            if let toast = model.toast {
                Text(toast)
                    .font(.footnote)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color(.systemGray5), in: Capsule())
                    .padding(.bottom, 12)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.composing {
            // #available is the SOLE condition of its branch so the result
            // builder applies buildLimitedAvailability to the iOS-16-only
            // ComposeView type (a mixed boolean+availability condition isn't
            // guaranteed to). The else is unreachable — the New-poll entry
            // points are themselves iOS-16-gated — but the builder needs it.
            if #available(iOS 16.0, *) {
                ComposeView(model: model)
            } else {
                PickerView(model: model)
            }
        } else if let summary = model.summary {
            SummaryView(model: model, state: summary)
        } else {
            PickerView(model: model)
        }
    }
}

private struct PickerView: View {
    @ObservedObject var model: ExtensionModel

    // Shared "New poll" label (empty-state CTA + loaded-list row). Only the
    // button chrome differs between the two sites (borderedProminent vs plain +
    // accent tint), so just the label — the bit that would drift on a rename /
    // icon swap — is factored out.
    private var newPollLabel: some View {
        Label("New poll", systemImage: "square.and.pencil")
            .font(.body.weight(.medium))
    }

    var body: some View {
        switch model.pickerState {
        case .loading:
            VStack(spacing: 10) {
                ProgressView()
                Text("Loading your polls…")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .needsApp:
            CenteredMessage(
                emoji: "👋",
                title: "Open WhoeverWants first",
                detail: "Set your name in the app, then come back here to share your polls.",
                retryLabel: "Check again"
            ) { model.reloadPicker() }
        case .empty:
            // With the composer (iOS 16+) the empty state is a create CTA, not a
            // dead end — make a poll right here. Older iOS falls back to the
            // "create in the app" guidance.
            if #available(iOS 16.0, *) {
                VStack(spacing: 8) {
                    Text("🗳️").font(.system(size: 40))
                    Text("No polls yet").font(.headline)
                    Text("Make your first poll and share it without leaving Messages.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                    Button(action: { model.startCompose() }) { newPollLabel }
                        .buttonStyle(.borderedProminent)
                        .padding(.top, 4)
                    Button("Refresh") { model.reloadPicker() }
                        .buttonStyle(.bordered)
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                CenteredMessage(
                    emoji: "🗳️",
                    title: "No polls yet",
                    detail: "Create a poll in WhoeverWants and it'll show up here to share.",
                    retryLabel: "Refresh"
                ) { model.reloadPicker() }
            }
        case .error:
            CenteredMessage(
                emoji: "📡",
                title: "Couldn't load your polls",
                detail: "Check your connection and try again.",
                retryLabel: "Retry"
            ) { model.reloadPicker() }
        case .loaded(let polls):
            List {
                if #available(iOS 16.0, *) {
                    Section {
                        Button(action: { model.startCompose() }) {
                            newPollLabel.foregroundColor(.accentColor)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Section(header: Text("Share a poll")) {
                    ForEach(polls) { poll in
                        PollRow(
                            poll: poll,
                            inserting: model.insertingPollId == poll.id
                        ) { model.share(poll) }
                    }
                }
            }
            .listStyle(.plain)
        }
    }
}

private struct PollRow: View {
    let poll: SharablePoll
    let inserting: Bool
    let action: () -> Void

    private var badges: [String] {
        [poll.groupIsPrivate ? "Private" : nil, poll.isClosed ? "Closed" : nil]
            .compactMap { $0 }
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(poll.title)
                        .font(.body)
                        .foregroundColor(.primary)
                        .lineLimit(2)
                    HStack(spacing: 6) {
                        if let group = poll.groupName {
                            Text(group)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }
                        ForEach(badges, id: \.self) { text in
                            Text(text)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(Color(.systemGray5), in: Capsule())
                                .foregroundColor(.secondary)
                        }
                    }
                }
                Spacer()
                if inserting {
                    ProgressView()
                } else {
                    Image(systemName: "plus.bubble")
                        .foregroundColor(.accentColor)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(inserting)
    }
}

private struct SummaryView: View {
    @ObservedObject var model: ExtensionModel
    let state: ExtensionModel.SummaryState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: { model.dismissSummary() }) {
                Label("Share a poll", systemImage: "chevron.left")
                    .font(.subheadline)
            }
            .padding(.horizontal)
            .padding(.top, 12)

            switch state {
            case .loading:
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Loading poll…")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let url):
                VStack(spacing: 12) {
                    Text("Couldn't load this poll")
                        .font(.headline)
                    Text("Open it in WhoeverWants instead.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    openButtons(url: url)
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded(let summary, let url):
                loadedBody(summary: summary, url: url)
            }
        }
    }

    private func loadedBody(summary: PollSummary, url: URL) -> some View {
        // Inline voting (decision C) is yes_no / limited_supply on an open poll;
        // the expanded view adds two things the transcript can't: multi-question
        // polls (a row per votable question) and name entry (the keyboard works
        // here). A recipient who's never opened the app has no bridged browser
        // id, so the vote can't attribute to them — guide them to open it once.
        let hasVotable = summary.questions.contains { ExtensionModel.isBallotVotable($0, poll: summary) }
        let hasBrowserId = BridgedIdentity.browserIdUnchecked() != nil
        let bridgedName = BridgedIdentity.load()?.name
        let nameFilled = !model.ballotName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let canVote = hasVotable && hasBrowserId && nameFilled

        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(summary.title)
                        .font(.title3.weight(.semibold))
                    HStack(spacing: 6) {
                        if let group = summary.groupName {
                            Text(group)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        Text(summary.isClosed ? "Closed" : "Open")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(
                                (summary.isClosed ? Color(.systemGray5) : Color.green.opacity(0.15)),
                                in: Capsule()
                            )
                            .foregroundColor(summary.isClosed ? .secondary : .green)
                    }
                }

                if hasVotable && !hasBrowserId {
                    Text("Open WhoeverWants once to vote here.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                } else if hasVotable && bridgedName == nil {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your name")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        TextField("Name or alias", text: $model.ballotName)
                            .textFieldStyle(.roundedBorder)
                            .submitLabel(.done)
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    ForEach(summary.questions) { q in
                        BallotQuestionRow(model: model, question: q, poll: summary, canVote: canVote)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))

                if summary.respondentCount > 0 {
                    Text("\(summary.respondentCount) \(summary.respondentCount == 1 ? "person has" : "people have") responded")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }

                openButtons(url: url)
            }
            .padding()
        }
    }

    private func openButtons(url: URL) -> some View {
        VStack(spacing: 8) {
            Button(action: { model.openInApp(url) }) {
                Text("Open in WhoeverWants")
                    .font(.body.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            Button(action: { model.copyLink(url) }) {
                Text("Copy Link")
                    .font(.subheadline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }
}

// One question's row in the expanded ballot: label + server-rendered result +
// (for an open yes_no/limited_supply question) inline vote buttons. Other types
// and closed polls render the result only. `canVote` folds the poll-level gates
// (browser id present + name filled) computed once in SummaryView; the buttons
// stay disabled while another submit is in flight (`model.ballotVoting`).
private struct BallotQuestionRow: View {
    @ObservedObject var model: ExtensionModel
    let question: QuestionSummary
    let poll: PollSummary
    let canVote: Bool

    // The in-flight sentinel for an explicit-Submit ballot (ranked / time /
    // showtime — a question is exactly one of these, so yesNoChoice nil +
    // isAbstain false never collides with a yes_no/limited_supply target).
    private var submitTarget: VotingTarget {
        VotingTarget(questionId: question.id, yesNoChoice: nil, isAbstain: false)
    }

    var body: some View {
        let mine = model.ballotVotes[question.id]
        return VStack(alignment: .leading, spacing: 6) {
            if let label = question.label {
                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Text(question.resultText ?? "—")
                .font(.body)
            if ExtensionModel.isBallotVotable(question, poll: poll) {
                if question.type == "ranked_choice" {
                    rankedSection
                } else if question.type == "time" || question.type == "showtime" {
                    slotSection
                } else {
                    HStack(spacing: 8) {
                        if question.type == "yes_no" {
                            choice("Yes", .green,
                                   selected: mine?.isAbstain == false && mine?.yesNoChoice == "yes",
                                   yesNoChoice: "yes", isAbstain: false)
                            choice("No", .red,
                                   selected: mine?.isAbstain == false && mine?.yesNoChoice == "no",
                                   yesNoChoice: "no", isAbstain: false)
                        } else {  // limited_supply
                            choice("Claim a spot", .green,
                                   selected: mine?.isAbstain == false,
                                   yesNoChoice: nil, isAbstain: false)
                            choice("No thanks", .secondary,
                                   selected: mine?.isAbstain == true,
                                   yesNoChoice: nil, isAbstain: true)
                        }
                    }
                }
            }
        }
    }

    // Tap-to-rank ballot: tap options in preference order (each shows its rank
    // number), tap again to remove. An explicit Submit applies the order (ranking
    // isn't a single tap, unlike yes_no/limited_supply). Strict ranking only — no
    // tiers (the bubble is a "simple taps" surface per Apple's live-layout rules).
    @ViewBuilder private var rankedSection: some View {
        let order = model.ballotRankOrder[question.id] ?? []
        let spinning = model.ballotVoting == submitTarget
        VStack(alignment: .leading, spacing: 6) {
            Text("Tap to rank in order")
                .font(.caption)
                .foregroundColor(.secondary)
            ForEach(question.options ?? [], id: \.self) { opt in
                let rank = order.firstIndex(of: opt).map { $0 + 1 }
                Button(action: {
                    model.toggleRank(questionId: question.id, option: opt)
                }) {
                    HStack(spacing: 8) {
                        ZStack {
                            Circle()
                                .strokeBorder(rank != nil ? Color.accentColor : Color(.systemGray3), lineWidth: 1.5)
                                .background(Circle().fill(rank != nil ? Color.accentColor : Color.clear))
                                .frame(width: 22, height: 22)
                            if let rank = rank {
                                Text("\(rank)")
                                    .font(.caption.weight(.bold))
                                    .foregroundColor(.white)
                            }
                        }
                        Text(opt)
                            .font(.body)
                            .foregroundColor(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canVote || model.ballotVoting != nil)
            }
            Button(action: { model.submitRanking(question: question, poll: poll) }) {
                HStack(spacing: 6) {
                    if spinning { ProgressView().controlSize(.small) }
                    Text(model.ballotVotes[question.id] == nil ? "Submit ranking" : "Update ranking")
                        .font(.subheadline.weight(.medium))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canVote || model.ballotVoting != nil || order.isEmpty)
            .padding(.top, 2)
        }
    }

    // Tap-to-mark ballot for time/showtime: tap a slot to cycle want → can't →
    // skip (👍 / 👎 / blank); an explicit Submit applies the set (preferences
    // aren't a single tap, like ranking). want → liked_slots, can't →
    // disliked_slots; on a time edit the stored availability rides along
    // unchanged (model.submitSlots).
    @ViewBuilder private var slotSection: some View {
        let marks = model.ballotSlots[question.id] ?? [:]
        let hasMark = !marks.isEmpty
        let spinning = model.ballotVoting == submitTarget
        VStack(alignment: .leading, spacing: 6) {
            Text("Tap to mark 👍 want · 👎 can't")
                .font(.caption)
                .foregroundColor(.secondary)
            ForEach(question.slots ?? []) { slot in
                Button(action: {
                    model.cycleSlot(questionId: question.id, slotKey: slot.key)
                }) {
                    HStack(spacing: 8) {
                        slotIndicator(marks[slot.key])
                        Text(slot.label)
                            .font(.body)
                            .foregroundColor(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canVote || model.ballotVoting != nil)
            }
            Button(action: { model.submitSlots(question: question, poll: poll) }) {
                HStack(spacing: 6) {
                    if spinning { ProgressView().controlSize(.small) }
                    Text(model.ballotVotes[question.id] == nil ? "Submit" : "Update")
                        .font(.subheadline.weight(.medium))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canVote || model.ballotVoting != nil || !hasMark)
            .padding(.top, 2)
        }
    }

    private func slotIndicator(_ choice: SlotChoice?) -> some View {
        let symbol: String
        let color: Color
        switch choice {
        case .like: symbol = "hand.thumbsup.fill"; color = .green
        case .dislike: symbol = "hand.thumbsdown.fill"; color = .red
        case nil: symbol = "circle"; color = Color(.systemGray3)
        }
        return Image(systemName: symbol)
            .font(.system(size: 20))
            .foregroundColor(color)
            .frame(width: 24, height: 24)
    }

    private func choice(_ title: String, _ color: Color, selected: Bool, yesNoChoice: String?, isAbstain: Bool) -> some View {
        VoteChoiceButton(
            title: title, color: color, selected: selected,
            spinning: model.ballotVoting == VotingTarget(
                questionId: question.id, yesNoChoice: yesNoChoice, isAbstain: isAbstain
            ),
            disabled: !canVote || model.ballotVoting != nil,
            action: {
                model.voteInBallot(question: question, poll: poll, yesNoChoice: yesNoChoice, isAbstain: isAbstain)
            }
        )
    }
}

private struct CenteredMessage: View {
    let emoji: String
    let title: String
    let detail: String
    let retryLabel: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text(emoji).font(.system(size: 40))
            Text(title).font(.headline)
            Text(detail)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button(retryLabel, action: retry)
                .buttonStyle(.bordered)
                .padding(.top, 4)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Compose a poll (Phase 4 — create without leaving Messages)

// Expanded-presentation text field → PollTextParser.decide → headless create
// (options / yes-no) or "open the app to finish" (category). The live preview
// teaches the box's grammar the same way the in-app search box does: "A, B, or
// C" → pick-one; "should we…" → yes/no; "movie for friday" → a category poll
// that opens the app. iOS 16+ (the shared parser is gated there); the New-poll
// entry points are all behind `#available(iOS 16.0, *)`, so this never mounts
// on iOS 15.
@available(iOS 16.0, *)
private struct ComposeView: View {
    @ObservedObject var model: ExtensionModel
    @State private var text = ""
    @FocusState private var focused: Bool

    private var parsed: PollTextParser.Parsed? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : PollTextParser.decide(t)
    }

    private var creating: Bool { model.composeState == .creating }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: { model.exitCompose() }) {
                Label("Share a poll", systemImage: "chevron.left")
                    .font(.subheadline)
            }
            .padding(.horizontal)
            .padding(.top, 12)
            .disabled(creating)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Ask a question")
                        .font(.title3.weight(.semibold))

                    TextField("Pizza, tacos, or sushi?", text: $text, axis: .vertical)
                        .lineLimit(1...4)
                        .textFieldStyle(.roundedBorder)
                        .focused($focused)
                        .disabled(creating)

                    if let parsed {
                        ComposePreview(parsed: parsed)
                    }

                    actionButton

                    if case .error(let message) = model.composeState {
                        Text(message)
                            .font(.footnote)
                            .foregroundColor(.red)
                    }

                    Text("Tip: list choices like “A, B, or C” for a pick-one poll, or ask a yes/no question.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
            }
        }
        .onAppear { focused = true }
    }

    private var actionButton: some View {
        // `.category` polls can't be finished headlessly — the button opens the
        // app instead, and the label says so up front (not a surprise tap).
        let isCategory = parsed?.kind == .category
        let label = isCategory ? "Open WhoeverWants to finish" : "Create & add to message"
        return Button(action: { model.createFromCompose(text: text) }) {
            ZStack {
                if creating { ProgressView() }
                Text(label)
                    .font(.body.weight(.medium))
                    .opacity(creating ? 0 : 1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
        .buttonStyle(.borderedProminent)
        .disabled(parsed == nil || creating)
    }
}

// Live "what poll will this make" preview, mirroring the web search box's top
// suggestion. The category-label map matches the parser's CategoryDef labels
// (location → "Place", not "Location").
@available(iOS 16.0, *)
private struct ComposePreview: View {
    let parsed: PollTextParser.Parsed

    private static let categoryLabels: [String: String] = [
        "restaurant": "Restaurant", "movie": "Movie", "video_game": "Video Game",
        "time": "Time", "location": "Place", "showtime": "Showtime",
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            switch parsed.kind {
            case .options:
                row("Pick one", systemImage: "list.bullet")
                Text(PollTextParser.optionsTitle(parsed.options, context: parsed.context))
                    .font(.subheadline)
            case .yesNo:
                row("Yes / No", systemImage: "checkmark.circle")
                Text(PollTextParser.yesNoTitle(parsed.prompt))
                    .font(.subheadline)
            case .category:
                let name = parsed.category.flatMap { Self.categoryLabels[$0] } ?? "Custom"
                row("\(name) poll", systemImage: "arrow.up.forward.app")
                Text("Opens WhoeverWants to add details, then share it from the list.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func row(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.medium))
            .foregroundColor(.secondary)
    }
}

// MARK: - Transcript bubble (Phase 3 — inline voting)

struct TranscriptBubbleView: View {
    // contentSizeThatFits returns this fixed compact height (per the plan: no
    // scrolling inside a bubble; the votable-ness isn't knowable synchronously
    // at sizing time, so one height serves every shape). Budgeted to fit the
    // worst case: a 2-line title + result row + a vote-button row + the status
    // footer. Read-only bubbles absorb the slack via the Spacer. The owner may
    // tune this on device.
    static let bubbleHeight: CGFloat = 168

    // Messages overlays the extension's APP ICON on the live bubble's
    // top-left corner (the OS draws it — we don't render it and can't move
    // it). Device-verified: without this inset the badge covers the title's
    // first characters. Only the first-line region is overlapped (~35pt past
    // the content edge), so the title indents clear of it while the rows
    // below keep the full width.
    private static let iconBadgeClearance: CGFloat = 44

    @ObservedObject var model: TranscriptBubbleModel

    var body: some View {
        content
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(.systemBackground))
        // Phase 3: the tree is INTERACTIVE — vote buttons take taps; the
        // title / results / footer are plain Buttons that requestExpand().
    }

    // Wraps a content region so tapping it opens the expanded summary — the
    // three non-vote-button regions (unavailable fallback, title+results,
    // footer) all share this. Live bubbles get no template-style tap-to-open
    // from Messages (device-verified), so each region carries its own
    // affordance; the vote buttons are SIBLINGS that consume their own taps.
    private func expandButton<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        Button(action: { model.requestExpand() }) {
            content().contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView()
                .padding(.leading, Self.iconBadgeClearance)
        case .unavailable:
            // Static fallback — tapping opens the expanded summary (its own
            // retry + Open/Copy affordances). No 👋 glyph of our own: the OS
            // already badges the bubble with the app icon.
            expandButton {
                VStack(alignment: .leading, spacing: 4) {
                    Text("WhoeverWants poll")
                        .font(.subheadline.weight(.semibold))
                        .padding(.leading, Self.iconBadgeClearance)
                    Text("Tap to view")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        case .loaded(let summary):
            loaded(summary)
        }
    }

    private func loaded(_ summary: PollSummary) -> some View {
        let votable = summary.inlineVotableQuestion
        return VStack(alignment: .leading, spacing: 6) {
            // Title + result rows — tap opens the expanded summary. (The vote
            // buttons below are SIBLINGS, not nested, so a button tap votes
            // while a tap here expands.)
            expandButton {
                VStack(alignment: .leading, spacing: 6) {
                    Text(summary.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .padding(.leading, Self.iconBadgeClearance)

                    // Up to 2 question rows; extras collapse into "+N more" so
                    // the fixed-height bubble never clips mid-row.
                    ForEach(summary.questions.prefix(2)) { q in
                        VStack(alignment: .leading, spacing: 2) {
                            if let label = q.label {
                                Text(label)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                    .lineLimit(1)
                            }
                            if q.type == "yes_no", let yes = q.yesCount, let no = q.noCount, yes + no > 0 {
                                YesNoBar(yes: yes, no: no)
                            } else if let text = q.resultText {
                                Text(text)
                                    .font(.footnote)
                                    .lineLimit(1)
                            }
                        }
                    }
                    if summary.questions.count > 2 {
                        Text("+\(summary.questions.count - 2) more")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let q = votable {
                VoteButtonRow(question: q, poll: summary, model: model)
            }

            Spacer(minLength: 0)

            expandButton {
                Text(footerText(summary))
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // "Open · ends in 2 hr. · 5 responded" / "Closed · 8 responded". Computed
    // at render — transcript instances are recreated whenever the bubble
    // scrolls back into view, so a static relative string stays fresh enough
    // without a ticking timer (which Apple's transcript guidance discourages).
    private func footerText(_ summary: PollSummary) -> String {
        var parts: [String] = []
        if summary.isClosed {
            parts.append("Closed")
        } else if let deadline = summary.responseDeadline, deadline > Date() {
            let rel = Self.relativeFormatter.localizedString(for: deadline, relativeTo: Date())
            parts.append("Open · ends \(rel)")
        } else {
            parts.append("Open")
        }
        if summary.respondentCount > 0 {
            let word = summary.respondentCount == 1 ? "person" : "people"
            parts.append("\(summary.respondentCount) \(word) responded")
        }
        return parts.joined(separator: " · ")
    }

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()
}

// Proportional Yes (green) / No (red) split — the "live result bar" the plan
// calls for. Only rendered when at least one yes/no vote exists (the caller
// gates on yes + no > 0); each cast side keeps a minimum visible sliver.
private struct YesNoBar: View {
    let yes: Int
    let no: Int

    var body: some View {
        HStack(spacing: 6) {
            GeometryReader { geo in
                HStack(spacing: yes > 0 && no > 0 ? 2 : 0) {
                    if yes > 0 {
                        Capsule()
                            .fill(Color.green.opacity(0.75))
                            .frame(width: max(6, geo.size.width * CGFloat(yes) / CGFloat(yes + no)))
                    }
                    if no > 0 {
                        Capsule().fill(Color.red.opacity(0.65))
                    }
                }
            }
            .frame(height: 8)
            Text("Yes \(yes) · No \(no)")
                .font(.caption2)
                .foregroundColor(.secondary)
                .fixedSize()
        }
    }
}

// Phase 3 inline-vote buttons for a single yes_no / limited_supply question.
// Identity-gated: with a bridged name+browserId, the buttons are live (the
// current choice highlighted, a spinner on the in-flight one); without it,
// they're disabled under a "Set your name in the app to vote" hint (a
// transcript can't take keyboard input — the user taps through to the
// expanded summary → Open in WhoeverWants → set their name there).
private struct VoteButtonRow: View {
    let question: QuestionSummary
    let poll: PollSummary
    @ObservedObject var model: TranscriptBubbleModel

    // Read at render: the user may have set their name in the app between
    // bubble renders (each transcript instance is short-lived). A UserDefaults
    // peek is cheap.
    private var hasIdentity: Bool { BridgedIdentity.load() != nil }

    private var mine: BubbleVote? { model.myVotes[question.id] }
    private var busy: Bool { model.voting?.questionId == question.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                if question.type == "yes_no" {
                    button(
                        "Yes", color: .green,
                        selected: mine?.isAbstain == false && mine?.yesNoChoice == "yes",
                        yesNoChoice: "yes", isAbstain: false
                    )
                    button(
                        "No", color: .red,
                        selected: mine?.isAbstain == false && mine?.yesNoChoice == "no",
                        yesNoChoice: "no", isAbstain: false
                    )
                } else {  // limited_supply
                    button(
                        // `mine?.isAbstain == false` is false when mine is nil,
                        // so it already implies a claim exists (parallels the
                        // `== true` decline check below).
                        "Claim a spot", color: .green,
                        selected: mine?.isAbstain == false,
                        yesNoChoice: nil, isAbstain: false
                    )
                    button(
                        "No thanks", color: .secondary,
                        selected: mine?.isAbstain == true,
                        yesNoChoice: nil, isAbstain: true
                    )
                }
            }
            if !hasIdentity {
                Text("Set your name in the app to vote")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
    }

    private func button(
        _ title: String, color: Color, selected: Bool,
        yesNoChoice: String?, isAbstain: Bool
    ) -> some View {
        // Spinner only on the button actually being submitted.
        let spinning = model.voting == VotingTarget(
            questionId: question.id, yesNoChoice: yesNoChoice, isAbstain: isAbstain
        )
        return VoteChoiceButton(
            title: title, color: color, selected: selected, spinning: spinning,
            disabled: !hasIdentity || busy,
            action: {
                model.vote(question: question, poll: poll, yesNoChoice: yesNoChoice, isAbstain: isAbstain)
            }
        )
    }
}

// Shared presentational vote button — the tuned pill used by BOTH the transcript
// VoteButtonRow and the expanded BallotQuestionRow. `selected` tints + outlines
// the current choice; `spinning` shows the in-flight indicator on the one being
// submitted; `disabled` covers the no-identity / busy gates the callers compute.
private struct VoteChoiceButton: View {
    let title: String
    let color: Color
    let selected: Bool
    let spinning: Bool
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if spinning { ProgressView() }
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .opacity(spinning ? 0 : 1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(
                selected ? color.opacity(0.18) : Color(.systemGray6),
                in: RoundedRectangle(cornerRadius: 9)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(selected ? color.opacity(0.7) : Color.clear, lineWidth: 1.5)
            )
            .foregroundColor(selected ? color : .primary)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}
