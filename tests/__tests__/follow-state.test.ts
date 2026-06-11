/**
 * Pins the Gap 1 follow/ignore tab classification (`lib/followState.ts`):
 *   - Old   = viewer_follow_state === 'old'
 *   - To Do = followed + needs the viewer's input (open, deadline not passed,
 *             not yet responded; active prephase still counts)
 *   - New   = followed, everything else (To Do ⊆ New)
 */

import { describe, expect, it } from "vitest";
import { classifyPollTab, tallyFollowTabs } from "@/lib/followState";
import type { Poll } from "@/lib/types";

const NOW = Date.parse("2026-06-02T12:00:00Z");
const HOUR = 3600_000;

function poll(overrides: Partial<Poll>): Poll {
  return {
    id: "p1",
    is_closed: false,
    title: "poll",
    created_at: new Date(NOW - 10 * HOUR).toISOString(),
    updated_at: new Date(NOW - 10 * HOUR).toISOString(),
    questions: [{ id: "q1" } as any],
    voter_names: [],
    anonymous_count: 0,
    viewer_follow_state: "new",
    ...overrides,
  } as Poll;
}

const NONE = new Set<string>();
const cls = (p: Poll, voted = NONE, abstained = NONE) =>
  classifyPollTab(p, voted, abstained, NOW);

describe("classifyPollTab", () => {
  it("'old' state → Old regardless of open/responded", () => {
    expect(cls(poll({ viewer_follow_state: "old" }))).toBe("old");
    expect(cls(poll({ viewer_follow_state: "old", is_closed: true }))).toBe("old");
  });

  it("open, unresponded, followed → To Do", () => {
    expect(cls(poll({}))).toBe("todo");
  });

  it("responded → New (followed but no longer needs input)", () => {
    expect(cls(poll({}), new Set(["q1"]))).toBe("new");
    expect(cls(poll({}), NONE, new Set(["q1"]))).toBe("new");
  });

  it("responded on another linked device (server viewer_responded) → New", () => {
    // Fresh sign-in on a new device: localStorage sets are empty, but the
    // account voted elsewhere — the server's account-aware flag clears To Do.
    expect(cls(poll({ viewer_responded: true }))).toBe("new");
  });

  it("closed → New (followed so the outcome is visible)", () => {
    expect(cls(poll({ is_closed: true }))).toBe("new");
  });

  it("past response deadline → New", () => {
    expect(
      cls(poll({ response_deadline: new Date(NOW - HOUR).toISOString() })),
    ).toBe("new");
  });

  it("future deadline, unresponded → still To Do", () => {
    expect(
      cls(poll({ response_deadline: new Date(NOW + HOUR).toISOString() })),
    ).toBe("todo");
  });

  it("active prephase, unresponded → To Do (viewer can contribute)", () => {
    expect(
      cls(poll({ prephase_deadline: new Date(NOW + HOUR).toISOString() })),
    ).toBe("todo");
  });
});

describe("tallyFollowTabs", () => {
  it("counts To Do as a subset of New; Old separate", () => {
    const polls = [
      poll({ id: "a" }), // todo
      poll({ id: "b" }, ), // todo
      poll({ id: "c", is_closed: true }), // new (followed, not todo)
      poll({ id: "d", viewer_follow_state: "old" }), // old
    ];
    const counts = tallyFollowTabs(polls, NONE, NONE, NOW);
    expect(counts).toEqual({ todo: 2, new: 3, old: 1 });
  });
});
