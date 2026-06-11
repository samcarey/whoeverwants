// JS↔Swift parser parity harness.
//
// Compiled together with ios/App/App/PollTextParser.swift by
// scripts/ios/test-parser.sh (so `internal` members are visible — same module),
// this reads the SHARED fixture tests/fixtures/poll-parse-cases.json — the same
// file tests/__tests__/poll-text-parse.test.ts asserts against in the JS CI —
// and asserts PollTextParser.decide produces the identical decision for every
// case. This is the Swift half of the alignment contract described in
// docs/poll-textbox-followups.md (TODO 1); it deliberately duplicates ZERO
// cases in Swift.
//
// Usage: parser-parity <path-to-poll-parse-cases.json>

import Foundation

struct Expectation: Decodable {
    let kind: String
    let options: [String]?
    let category: String?
    let context: String?
}

struct Case: Decodable {
    let text: String
    let expect: Expectation
}

struct Fixture: Decodable {
    let cases: [Case]
}

func kindName(_ kind: PollTextParser.Kind) -> String {
    switch kind {
    case .options: return "options"
    case .category: return "category"
    case .yesNo: return "yes_no"
    }
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: parser-parity <poll-parse-cases.json>\n".utf8))
    exit(2)
}

let fixturePath = CommandLine.arguments[1]
let fixture: Fixture
do {
    let data = try Data(contentsOf: URL(fileURLWithPath: fixturePath))
    fixture = try JSONDecoder().decode(Fixture.self, from: data)
} catch {
    FileHandle.standardError.write(Data("failed to load fixture \(fixturePath): \(error)\n".utf8))
    exit(2)
}

var failures: [String] = []

// Mirrors the assertion semantics of tests/__tests__/poll-text-parse.test.ts:
// kind always; context when the fixture specifies it; options for kind=options;
// category for kind=category.
for c in fixture.cases {
    let parsed = PollTextParser.decide(c.text)
    var problems: [String] = []
    let gotKind = kindName(parsed.kind)
    if gotKind != c.expect.kind {
        problems.append("kind: expected \(c.expect.kind), got \(gotKind)")
    }
    if let expectedContext = c.expect.context, parsed.context != expectedContext {
        problems.append("context: expected \"\(expectedContext)\", got \"\(parsed.context)\"")
    }
    if c.expect.kind == "options", let expectedOptions = c.expect.options, parsed.options != expectedOptions {
        problems.append("options: expected \(expectedOptions), got \(parsed.options)")
    }
    if c.expect.kind == "category", parsed.category != c.expect.category {
        problems.append("category: expected \(c.expect.category ?? "nil"), got \(parsed.category ?? "nil")")
    }
    if !problems.isEmpty {
        failures.append("\"\(c.text)\" — " + problems.joined(separator: "; "))
    }
}

if failures.isEmpty {
    print("parser parity OK: \(fixture.cases.count)/\(fixture.cases.count) fixture cases match PollTextParser.decide")
    exit(0)
}

print("parser parity FAILED: \(failures.count)/\(fixture.cases.count) fixture cases diverge from PollTextParser.decide")
print("(the JS source of truth is lib/pollTextParse.ts + lib/categoryMatch.ts — update the Swift port in ios/App/App/PollTextParser.swift)")
for f in failures {
    print("  ✗ \(f)")
}
exit(1)
