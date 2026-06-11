// PollTextParser — natural-language → poll-shape parser (Siri quick-poll).
// Extracted from AppDelegate.swift so the JS↔Swift parity harness
// (scripts/ios/test-parser.sh) can compile it standalone with swiftc against
// the shared fixture tests/fixtures/poll-parse-cases.json. Pure Foundation —
// keep it free of UIKit/Capacitor imports or the harness breaks.

import Foundation

// Natural-language → poll-shape parser. FAITHFUL PORT of `lib/pollTextParse.ts`
// (the in-app search box uses the same primitives), so a spoken "quick poll"
// produces the same poll shape the box's top suggestion would — computed LOCALLY
// on-device, no network parse round-trip.
//
// ALIGNMENT CONTRACT. The decision rules here mirror `lib/pollTextParse.ts:
// decidePoll` rule-for-rule and are pinned by the SHARED fixture
// `tests/fixtures/poll-parse-cases.json` (the JS half runs in CI via
// tests/__tests__/poll-text-parse.test.ts). When changing a rule, update the TS
// source, this port, AND the fixture together. The Swift half is enforced in
// CI by scripts/ios/test-parser.sh (run by ios-build.yml on the Mac runner): it
// swiftc-compiles THIS file with a small harness that reads the same JSON
// fixture and asserts `decide` — no cases are duplicated in Swift.
//
// `title` formatting (yesNoTitle / optionsTitle) is a native PRESENTATION detail
// — not part of the alignment fixture — but mirrors the box's displayed titles.
@available(iOS 16.0, *)
enum PollTextParser {
    enum Kind { case options, category, yesNo }

    struct Parsed {
        let kind: Kind
        let prompt: String       // trimmed phrase; the yes/no title + deep-link title=
        let context: String      // the "for X" tail ("" when none)
        let options: [String]    // kind == .options (empty otherwise)
        let category: String?    // kind == .category (nil otherwise)
    }

    // Mirrors YESNO_STEMS in lib/pollTextParse.ts — first words that start an
    // unambiguous yes/no question (checked BEFORE category detection).
    private static let yesNoStems: Set<String> = [
        "should", "shall", "can", "could", "will", "would", "is", "are", "am",
        "was", "were", "do", "does", "did", "has", "have", "had", "may",
        "might", "must",
    ]

    // Faithful Swift mirror of lib/categoryMatch.ts — the canonical ranked,
    // any-token, stop-word-filtered category matcher (the single source of truth
    // shared with the web search box). When changing a category trigger / label /
    // stop word, update lib/categoryMatch.ts, this block, AND the shared fixture
    // poll-parse-cases.json together. See docs/poll-textbox-followups.md (TODO 1).
    private struct CategoryDef {
        let value: String
        let label: String           // label words weigh 2 vs alias keywords' 1
        let keywords: [String]
    }

    // ORDER IS PRECEDENCE (breaks score ties — so "where should we eat" →
    // restaurant: both "eat" and "where" score 1, restaurant comes first). Only
    // the six SEARCHABLE categories; yes_no / limited_supply are never matched.
    private static let categoryDefs: [CategoryDef] = [
        CategoryDef(value: "restaurant", label: "Restaurant", keywords: ["eat", "eats", "dinner", "lunch", "food", "dining", "dine", "brunch", "breakfast", "supper", "cuisine", "meal", "takeout", "coffee", "drinks", "cafe", "bite"]),
        CategoryDef(value: "movie", label: "Movie", keywords: ["film", "films", "cinema", "watch", "flick", "flicks", "screening", "showtime"]),
        CategoryDef(value: "video_game", label: "Video Game", keywords: ["game", "games", "gaming", "videogame", "play", "console", "esports"]),
        CategoryDef(value: "time", label: "Time", keywords: ["when", "schedule", "date", "day", "availability", "available", "calendar", "meeting", "meet", "free"]),
        CategoryDef(value: "location", label: "Place", keywords: ["where", "spot", "spots", "venue", "destination", "address", "bar", "park", "trip", "location", "places"]),
        CategoryDef(value: "showtime", label: "Showtime", keywords: ["movie", "film", "cinema", "theater", "theatre", "showtimes", "screening", "tickets", "showings"]),
    ]

    // Generic filler words removed before matching. MUST NOT contain any category
    // trigger word — the JS test pins this disjointness on the JS side; the Swift
    // side is behaviorally pinned by the shared-fixture harness
    // (scripts/ios/test-parser.sh). Keep this set byte-identical to STOP_WORDS
    // in lib/categoryMatch.ts. Question words that ARE triggers ("where", "when")
    // are deliberately absent.
    private static let stopWords: Set<String> = [
        "should", "shall", "would", "could", "can", "will", "do", "does", "did",
        "is", "are", "am", "was", "were", "be", "been", "being", "have", "has", "had",
        "the", "a", "an", "of", "to", "we", "i", "you", "he", "she", "they", "it",
        "us", "our", "your", "my", "me", "this", "that", "these", "those",
        "what", "whats", "which", "who", "whose", "how",
        "lets", "let", "get", "got", "want", "wanna", "gonna", "going", "go",
        "pick", "choose", "choosing", "need", "please", "maybe", "some", "any",
        "every", "all", "on", "at", "in", "with", "and", "or", "for", "from",
        "next", "best", "favorite", "favourite", "vote", "poll", "decide", "decision",
        "grab", "hang", "out", "up", "still", "ok", "okay", "about", "around",
        "idea", "ideas", "plan", "plans", "option", "options", "vs", "versus",
        "make", "find", "doing", "having", "everyone", "people",
    ]

    // Split on anything not a-z0-9 (mirrors JS [^a-z0-9]+, not Unicode-aware).
    private static let alnumSeparators =
        CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789").inverted

    private static let wordSeparators =
        CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ","))

    private static func words(_ s: String) -> [String] {
        s.lowercased().components(separatedBy: wordSeparators).filter { !$0.isEmpty }
    }

    // Lowercase alphanumeric tokens, dropping stop words + sub-2-char fragments.
    // Mirrors tokenizeSubject.
    private static func tokenizeSubject(_ text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: alnumSeparators)
            .filter { $0.count >= 2 && !stopWords.contains($0) }
    }

    // Strip a trailing "s" on words longer than 3 (lightweight plural folding).
    private static func singular(_ w: String) -> String {
        (w.count > 3 && w.hasSuffix("s")) ? String(w.dropLast()) : w
    }

    // A token matches a trigger when either is a (singularized) prefix of the
    // other. Mirrors tokenHits.
    private static func tokenHits(_ token: String, _ trigger: String) -> Bool {
        let t = singular(token)
        let k = singular(trigger)
        return t == k || k.hasPrefix(t) || t.hasPrefix(k)
    }

    // Label words per category, split once (mirrors LABEL_WORDS).
    private static let labelWords: [String: [String]] = {
        var m: [String: [String]] = [:]
        for d in categoryDefs {
            m[d.value] = d.label.lowercased()
                .components(separatedBy: alnumSeparators)
                .filter { !$0.isEmpty }
        }
        return m
    }()

    // Full score (label hits 2, alias keyword 1) + label-only score, one pass.
    // Mirrors scoreBoth. Each token counts at most once.
    private static func scoreBoth(_ def: CategoryDef, _ tokens: [String]) -> (score: Int, labelScore: Int) {
        if tokens.isEmpty { return (0, 0) }
        let lw = labelWords[def.value] ?? []
        var score = 0
        var labelScore = 0
        for tok in tokens {
            if lw.contains(where: { tokenHits(tok, $0) }) {
                score += 2
                labelScore += 2
            } else if def.keywords.contains(where: { tokenHits(tok, $0) }) {
                score += 1
            }
        }
        return (score, labelScore)
    }

    // Split on a standalone "for" (whole word, case-insensitive); subject before,
    // context after. Mirrors parseForContext.
    static func parseForContext(_ raw: String) -> (subject: String, context: String) {
        let ns = raw as NSString
        guard
            let re = try? NSRegularExpression(pattern: "\\bfor\\b", options: [.caseInsensitive]),
            let m = re.firstMatch(in: raw, options: [], range: NSRange(location: 0, length: ns.length))
        else {
            return (raw.trimmingCharacters(in: .whitespacesAndNewlines), "")
        }
        let subject = ns.substring(to: m.range.location)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let context = ns.substring(from: m.range.location + m.range.length)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (subject, context)
    }

    // Split on commas + the word "or", trim, drop blanks, de-dupe
    // case-insensitively (keeping the first spelling). Mirrors parseOptionsFromText.
    static func parseOptions(_ text: String) -> [String] {
        let collapsed: String
        let ns = text as NSString
        if let re = try? NSRegularExpression(pattern: "\\s+or\\s+", options: [.caseInsensitive]) {
            collapsed = re.stringByReplacingMatches(
                in: text, options: [],
                range: NSRange(location: 0, length: ns.length), withTemplate: ","
            )
        } else {
            collapsed = text
        }
        var seen = Set<String>()
        var out: [String] = []
        for part in collapsed.split(separator: ",", omittingEmptySubsequences: false) {
            let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            let key = trimmed.lowercased()
            if seen.contains(key) { continue }
            seen.insert(key)
            out.append(trimmed)
        }
        return out
    }

    // The single best built-in category implied by a subject, or nil. Mirrors
    // detectCategory → topCategory (the top of the shared ranking). Sort:
    // score desc → label-hit desc (exact label beats alias) → precedence (the
    // categoryDefs order). Recency tie-break is web-box-only (not mirrored here).
    static func detectCategory(_ subject: String) -> String? {
        let tokens = tokenizeSubject(subject)
        if tokens.isEmpty { return nil }
        var ranked: [(value: String, score: Int, labelScore: Int, order: Int)] = []
        for (i, def) in categoryDefs.enumerated() {
            let s = scoreBoth(def, tokens)
            if s.score > 0 {
                ranked.append((def.value, s.score, s.labelScore, i))
            }
        }
        ranked.sort {
            if $0.score != $1.score { return $0.score > $1.score }
            if $0.labelScore != $1.labelScore { return $0.labelScore > $1.labelScore }
            return $0.order < $1.order
        }
        return ranked.first?.value
    }

    // Decide the single best poll. Mirrors decidePoll precedence:
    //   1. ≥2 options → options;  2. yes/no stem → yes/no;
    //   3. category trigger → category;  4. else → yes/no.
    static func decide(_ raw: String) -> Parsed {
        let prompt = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let (subject, context) = parseForContext(prompt)

        let options = parseOptions(subject)
        if options.count >= 2 {
            return Parsed(kind: .options, prompt: prompt, context: context, options: options, category: nil)
        }

        let firstWord = words(prompt).first ?? ""
        if yesNoStems.contains(firstWord) {
            return Parsed(kind: .yesNo, prompt: prompt, context: context, options: [], category: nil)
        }

        if let category = detectCategory(subject) {
            return Parsed(kind: .category, prompt: prompt, context: context, options: [], category: category)
        }

        return Parsed(kind: .yesNo, prompt: prompt, context: context, options: [], category: nil)
    }

    // --- Native title presentation (NOT in the alignment fixture) ----------

    // "?" appended unless the prompt already ends in terminal punctuation.
    // Mirrors yesNoTitleText (prompt is non-empty here).
    static func yesNoTitle(_ prompt: String) -> String {
        let t = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return t }
        if let last = t.last, "?!.".contains(last) { return t }
        return t + "?"
    }

    // "A or B?" / "A, B, or C[ for X]?" — mirrors the box's or-list title.
    static func optionsTitle(_ options: [String], context: String) -> String {
        let body: String
        if options.count <= 1 {
            body = options.first ?? ""
        } else if options.count == 2 {
            body = "\(options[0]) or \(options[1])"
        } else {
            body = options.dropLast().joined(separator: ", ") + ", or " + (options.last ?? "")
        }
        let withCtx = context.isEmpty ? body : "\(body) for \(context)"
        return withCtx + "?"
    }
}
