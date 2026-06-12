import Messages
import SwiftUI
import UIKit

// Phase 1 of docs/imessage-extension-plan.md — share a poll from the Messages
// drawer (template layout; the live transcript bubble is Phase 2).
//
// What this does:
//   • Compact/expanded drawer view lists the user's recent polls (the same
//     `POST /api/groups/mine` fetch Siri's PollEntity.fetchAll uses), read with
//     the App-Group-bridged identity. No identity → "open the app first" state.
//   • Tapping a poll inserts an MSMessage (MSMessageTemplateLayout: icon, poll
//     title caption, group subcaption) whose url is the canonical
//     /g/<group>/p/<poll> for public groups, or a freshly-minted poll-scoped
//     /invite/<token> for private groups (owner decision B — the bubble doubles
//     as a revocable capability token; recipients auto-join like an invite link).
//   • Tapping a sent bubble (recipient WITH the app) opens the extension
//     expanded with `conversation.selectedMessage` set → a native poll summary
//     with live results + "Open in WhoeverWants" (extensionContext.open is
//     famously finicky from Messages extensions, so Copy Link is the always-
//     available fallback and the open failure path copies too).
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

    // Returns the bridged browser id, gated on a non-empty display NAME — the
    // same "user has actually used the app" signal Siri's
    // QuickPollService.loadIdentity gates on (name-required model). The name
    // itself isn't displayed anywhere here, so only the id is returned.
    static func loadBrowserId() -> String? {
        guard let d = UserDefaults(suiteName: suiteName),
              let name = d.string(forKey: nameKey), !name.isEmpty,
              let browserId = d.string(forKey: browserIdKey), !browserId.isEmpty else {
            return nil
        }
        return browserId
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

struct QuestionSummary: Identifiable {
    let id: String            // question uuid
    let label: String?        // disambiguator in multi-question polls
    let type: String          // question_type
    var resultText: String?   // filled by the per-question results fetch
}

struct PollSummary {
    let title: String
    let groupName: String?
    let isClosed: Bool
    let respondentCount: Int
    let questions: [QuestionSummary]
}

// MARK: - API

private enum PollAPI {
    // Treat empty strings as absent — the API can return "" for an unset
    // override, which should never surface as a title / id / group.
    static func nonEmpty(_ s: String?) -> String? { s.flatMap { $0.isEmpty ? nil : $0 } }

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

    // Poll summary for the recipient's expanded view. GET /api/polls/<short>
    // and GET /api/questions/<id>/results are identity-free server-side (the
    // poll read is documented as visibility-blind), which is what lets a
    // recipient who isn't (yet) a group member see what they were sent —
    // acceptable under decision B (a bubble IS a deliberate capability share),
    // but note this aggregates per-question fetches client-side; Phase 2's
    // transcript bubble wants a single tiny server summary endpoint, and when
    // that lands this should consume it instead (see the plan doc).
    static func fetchSummary(shortId: String) async throws -> PollSummary {
        guard let url = URL(string: apiBase + "/api/polls/\(shortId)") else { throw URLError(.badURL) }
        let (data, response) = try await URLSession.shared.data(for: jsonRequest(url: url, method: "GET", browserId: nil))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw URLError(.badServerResponse)
        }
        let isClosed = (obj["is_closed"] as? Bool) ?? false
        let questionObjs = (obj["questions"] as? [[String: Any]]) ?? []
        let title = nonEmpty(questionObjs.first?["title"] as? String)
            ?? nonEmpty(obj["title"] as? String) ?? "Poll"
        // Respondent count honors name multiplicity (two voters who share a
        // name are two people) — mirrors namedVoterCount in
        // components/VoterList.tsx.
        let voterNames = (obj["voter_names"] as? [String]) ?? []
        let nameCounts = (obj["voter_name_counts"] as? [String: Int]) ?? [:]
        let namedCount = voterNames.reduce(0) { $0 + max(1, nameCounts[$1] ?? 1) }
        let anonymous = (obj["anonymous_count"] as? Int) ?? 0
        let multi = questionObjs.count > 1
        var questions: [QuestionSummary] = questionObjs.compactMap { q in
            guard let qid = nonEmpty(q["id"] as? String) else { return nil }
            let type = (q["question_type"] as? String) ?? "yes_no"
            // Per-question titles repeat the wrapper title in multi-question
            // polls, so the disambiguator mirrors the web's
            // getQuestionSectionTitle: "<Label> for <Context>", either half
            // optional (label is nil for yes_no/limited_supply per the
            // "Yes/No is a category, not display text" rule).
            let label: String? = {
                guard multi else { return nil }
                let details = nonEmpty(q["details"] as? String)
                let typeLabel = questionLabel(type: type, category: q["category"] as? String)
                if let t = typeLabel, let d = details { return "\(t) for \(d)" }
                return details ?? typeLabel
            }()
            return QuestionSummary(id: qid, label: label, type: type, resultText: nil)
        }
        // Live results per question (identity-free), fetched CONCURRENTLY so
        // the summary's latency is one round-trip, not the sum. Capped — the
        // summary is a glance, not a ballot.
        let resultTexts = await withTaskGroup(of: (String, String?).self) { group -> [String: String] in
            for q in questions.prefix(4) {
                group.addTask {
                    (q.id, await fetchResultText(questionId: q.id, type: q.type, pollIsClosed: isClosed))
                }
            }
            var out: [String: String] = [:]
            for await (qid, text) in group {
                if let text = text { out[qid] = text }
            }
            return out
        }
        for i in questions.indices {
            questions[i].resultText = resultTexts[questions[i].id]
        }
        return PollSummary(
            title: title,
            groupName: nonEmpty(obj["group_title"] as? String),
            isClosed: isClosed,
            respondentCount: namedCount + anonymous,
            questions: questions
        )
    }

    // Built-in category labels — mirror labelForCategory's _CATEGORY_LABELS
    // (app/create-poll/createPollHelpers.ts) + the server's copy in
    // server/algorithms/poll_title.py. Keep all three in lockstep when adding
    // a built-in category.
    private static let categoryLabels: [String: String] = [
        "restaurant": "Restaurant",
        "movie": "Movie",
        "video_game": "Video Game",
        "videogame": "Video Game",
        "location": "Place",
        "time": "Time",
        "showtime": "Showtime",
    ]

    // Mirrors getQuestionLabel (lib/questionListUtils.ts): nil for yes_no (the
    // documented "Yes/No is a CATEGORY, not display text" rule) and
    // limited_supply (the title IS the item); "Time"/"Showtime" by type; else
    // the built-in category label, nil for custom categories.
    private static func questionLabel(type: String, category: String?) -> String? {
        switch type {
        case "yes_no", "limited_supply":
            return nil
        case "time":
            return "Time"
        case "showtime":
            return "Showtime"
        default:
            return category.flatMap { categoryLabels[$0] }
        }
    }

    private static func fetchResultText(questionId: String, type: String, pollIsClosed: Bool) async -> String? {
        guard let url = URL(string: apiBase + "/api/questions/\(questionId)/results"),
              let (data, response) = try? await URLSession.shared.data(for: jsonRequest(url: url, method: "GET", browserId: nil)),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let r = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let totalVotes = (r["total_votes"] as? Int) ?? 0
        switch type {
        case "yes_no":
            guard totalVotes > 0 else { return "No votes yet" }
            return "Yes \((r["yes_count"] as? Int) ?? 0) · No \((r["no_count"] as? Int) ?? 0)"
        case "limited_supply":
            let secured = (r["secured_count"] as? Int) ?? 0
            if let supply = r["supply_count"] as? Int { return "\(secured)/\(supply) claimed" }
            return "\(secured) claimed"
        default:
            if let winner = nonEmpty(r["winner"] as? String) {
                let pretty = type == "time" || type == "showtime" ? prettySlot(winner) : winner
                return pollIsClosed ? "Winner: \(pretty)" : "Leading: \(pretty)"
            }
            guard totalVotes > 0 else { return "No votes yet" }
            return "\(totalVotes) \(totalVotes == 1 ? "response" : "responses")"
        }
    }

    // DateFormatter allocation is expensive; both are configured once and only
    // read afterwards (thread-safe post-iOS-7), so hoist as statics.
    private static let slotParser: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f
    }()
    private static let slotDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "E MMM d"
        return f
    }()

    // Time/showtime winners are slot keys ("2026-06-20 19:00-21:00"); render
    // the start as "Sat Jun 20, 7 PM" — the same shape the server's
    // _format_slot_label (server/routers/polls.py) uses for push-notification
    // outcomes, so the bubble summary and the close push agree. Falls through
    // to the raw key on any parse miss.
    private static func prettySlot(_ slotKey: String) -> String {
        guard slotKey.count >= 16, let date = slotParser.date(from: String(slotKey.prefix(16))) else {
            return slotKey
        }
        let comps = Calendar.current.dateComponents([.hour, .minute], from: date)
        let hour = comps.hour ?? 0
        let minute = comps.minute ?? 0
        let period = hour < 12 ? "AM" : "PM"
        let hour12 = hour % 12 == 0 ? 12 : hour % 12
        let minuteStr = minute != 0 ? String(format: ":%02d", minute) : ""
        return "\(slotDayFormatter.string(from: date)), \(hour12)\(minuteStr) \(period)"
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

    @Published var pickerState: PickerState = .loading
    @Published var summary: SummaryState?    // non-nil → summary mode (a bubble was tapped)
    @Published var insertingPollId: String?  // row spinner while minting/inserting
    @Published var toast: String?

    weak var host: MessagesViewController?

    private var lastFetch: Date?
    // poll uuid → minted invite token, so re-sharing the same private poll in
    // one session reuses the invite instead of accumulating rows (the raw
    // token is one-shot server-side, so this cache is the only reuse possible).
    private var inviteTokens: [String: String] = [:]
    private var toastDismissTask: Task<Void, Never>?

    // Called on every willBecomeActive: route to the summary (a bubble was
    // tapped → selectedMessage is set) or the picker (drawer opened normally).
    func activate(selectedMessageURL: URL?) {
        if let url = selectedMessageURL {
            showSummary(for: url)
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
        Task {
            do {
                let s = try await PollAPI.fetchSummary(shortId: shortId)
                // The user may have navigated back to the picker mid-fetch.
                if case .loading(let pending)? = summary, pending == url {
                    summary = .loaded(s, url)
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

// MARK: - Messages app view controller

class MessagesViewController: MSMessagesAppViewController {

    private let model = ExtensionModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        model.host = self
        // Retained via view-controller containment (addChild) — no property needed.
        let controller = UIHostingController(rootView: RootView(model: model))
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

    // Fires on every activation: drawer open (selectedMessage nil → picker) AND
    // cold bubble tap (selectedMessage set → summary).
    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        model.activate(selectedMessageURL: conversation.selectedMessage?.url)
    }

    // Fires when the user taps one of our bubbles while the extension is
    // already active (the warm path; cold taps arrive via willBecomeActive).
    override func didSelect(_ message: MSMessage, conversation: MSConversation) {
        super.didSelect(message, conversation: conversation)
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
        let layout = MSMessageTemplateLayout()
        layout.image = Self.shareImage
        layout.caption = caption
        layout.subcaption = subcaption
        message.layout = layout
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
            if let summary = model.summary {
                SummaryView(model: model, state: summary)
            } else {
                PickerView(model: model)
            }
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
}

private struct PickerView: View {
    @ObservedObject var model: ExtensionModel

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
            CenteredMessage(
                emoji: "🗳️",
                title: "No polls yet",
                detail: "Create a poll in WhoeverWants and it'll show up here to share.",
                retryLabel: "Refresh"
            ) { model.reloadPicker() }
        case .error:
            CenteredMessage(
                emoji: "📡",
                title: "Couldn't load your polls",
                detail: "Check your connection and try again.",
                retryLabel: "Retry"
            ) { model.reloadPicker() }
        case .loaded(let polls):
            List {
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
                ScrollView {
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

                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(summary.questions) { q in
                                VStack(alignment: .leading, spacing: 2) {
                                    if let label = q.label {
                                        Text(label)
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    Text(q.resultText ?? "—")
                                        .font(.body)
                                }
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
