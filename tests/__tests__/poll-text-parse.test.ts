import { describe, it, expect } from "vitest";
import {
  decidePoll,
  detectCategory,
  parseForContext,
  parseOptionsFromText,
} from "@/lib/pollTextParse";
import fixture from "../fixtures/poll-parse-cases.json";

// The fixture is the SHARED alignment contract between this JS parser
// (lib/pollTextParse.ts) and the Swift port (AppDelegate.swift:
// PollTextParser.decide). Keep all three in lockstep — see the header comment
// in lib/pollTextParse.ts.
type Case = {
  text: string;
  expect: {
    kind: "options" | "category" | "yes_no";
    options?: string[];
    category?: string;
    context?: string;
  };
};

describe("decidePoll — shared fixture (JS↔Swift alignment contract)", () => {
  for (const c of (fixture.cases as Case[])) {
    it(`"${c.text}" → ${c.expect.kind}`, () => {
      const parsed = decidePoll(c.text);
      expect(parsed.kind).toBe(c.expect.kind);
      if (c.expect.context !== undefined) {
        expect(parsed.context).toBe(c.expect.context);
      }
      if (c.expect.kind === "options") {
        expect(parsed.options).toEqual(c.expect.options);
      }
      if (c.expect.kind === "category") {
        expect(parsed.category).toBe(c.expect.category);
      }
    });
  }
});

describe("parseForContext", () => {
  it("splits on a standalone 'for'", () => {
    expect(parseForContext("movie for friday")).toEqual({ subject: "movie", context: "friday" });
  });
  it("only matches 'for' as a whole word", () => {
    expect(parseForContext("fortnite tournament")).toEqual({ subject: "fortnite tournament", context: "" });
    expect(parseForContext("comfortable chairs")).toEqual({ subject: "comfortable chairs", context: "" });
  });
  it("splits on the FIRST 'for' only", () => {
    expect(parseForContext("snacks for the trip for sunday")).toEqual({
      subject: "snacks",
      context: "the trip for sunday",
    });
  });
});

describe("parseOptionsFromText", () => {
  it("splits commas and 'or', de-duping case-insensitively", () => {
    expect(parseOptionsFromText("Pizza, Tacos or pizza")).toEqual(["Pizza", "Tacos"]);
  });
  it("returns a single element for non-list text", () => {
    expect(parseOptionsFromText("get a dog")).toEqual(["get a dog"]);
  });
});

describe("detectCategory", () => {
  it("is precedence-ordered (restaurant beats location)", () => {
    expect(detectCategory("where should we eat")).toBe("restaurant");
  });
  it("returns null when nothing matches", () => {
    expect(detectCategory("favorite color")).toBeNull();
  });
});
