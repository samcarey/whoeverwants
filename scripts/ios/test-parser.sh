#!/usr/bin/env bash
# JS↔Swift poll-parser parity test.
#
# Compiles the REAL shipped parser (ios/App/App/PollTextParser.swift — pure
# Foundation, no UIKit/Capacitor) together with the harness
# (scripts/ios/parser-harness/main.swift) via swiftc for the macOS host, then
# runs it against the SHARED fixture tests/fixtures/poll-parse-cases.json — the
# same file the JS test (tests/__tests__/poll-text-parse.test.ts) asserts in
# the Node CI. Run by .github/workflows/ios-build.yml on the Mac runner before
# archiving, so a Swift port that drifts from lib/pollTextParse.ts fails the
# iOS build instead of silently shipping a divergent Siri parser.
#
# Requires swiftc (Xcode CLT) — i.e. a macOS host. Usage: bash scripts/ios/test-parser.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PARSER="$ROOT/ios/App/App/PollTextParser.swift"
HARNESS="$ROOT/scripts/ios/parser-harness/main.swift"
FIXTURE="$ROOT/tests/fixtures/poll-parse-cases.json"

for f in "$PARSER" "$HARNESS" "$FIXTURE"; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 2; }
done

BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "Compiling parser parity harness..."
# No -O: the harness only needs correct output, and an unoptimized compile is
# meaningfully faster on the shared Mac runner.
swiftc "$PARSER" "$HARNESS" -o "$BUILD_DIR/parser-parity"

"$BUILD_DIR/parser-parity" "$FIXTURE"
