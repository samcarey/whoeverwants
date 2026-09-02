import { describe, it, expect } from "vitest";
import {
  DEFAULT_POLL_OPTIONS,
  POLL_DEADLINE_OPTIONS,
  POLL_SUGGESTION_OPTIONS,
  pollDeadlineLabel,
  pollOptionsFromWire,
  pollOptionsSummary,
  pollOptionsToWire,
  pollSuggestionsLabel,
} from "@/lib/activityPollDraft";
import type { ActivityPollOptions } from "@/lib/api/slots";

const opts = (over: Partial<ActivityPollOptions> = {}): ActivityPollOptions => ({
  ...DEFAULT_POLL_OPTIONS,
  ...over,
});

describe("poll option catalogs", () => {
  it("offers the event start plus every lead time as a deadline", () => {
    expect(POLL_DEADLINE_OPTIONS[0]).toEqual({ value: "event_start", label: "Event start" });
    expect(POLL_DEADLINE_OPTIONS.map((o) => o.value)).toEqual([
      "event_start",
      "1h",
      "2h",
      "8h",
      "1d",
      "2d",
      "4d",
    ]);
  });

  it("anchors suggestions to the deadline ONLY — no before-event base", () => {
    expect(POLL_SUGGESTION_OPTIONS[0]).toEqual({ value: "none", label: "Do not allow" });
    const deadline = POLL_SUGGESTION_OPTIONS.filter((o) => o.value.startsWith("deadline:"));
    expect(deadline).toHaveLength(6);
    // The retired base must not creep back: it was the only way to express a
    // cutoff landing after voting closed.
    expect(POLL_SUGGESTION_OPTIONS.some((o) => o.value.startsWith("event:"))).toBe(false);
    expect(POLL_SUGGESTION_OPTIONS).toHaveLength(7);
  });

  it("labels every lead with the abbreviated unit", () => {
    expect(POLL_DEADLINE_OPTIONS.map((o) => o.label)).toEqual([
      "Event start",
      "1h before event",
      "2h before event",
      "8h before event",
      "1d before event",
      "2d before event",
      "4d before event",
    ]);
    expect(POLL_SUGGESTION_OPTIONS.map((o) => o.label)).toEqual([
      "Do not allow",
      "1h before deadline",
      "2h before deadline",
      "8h before deadline",
      "1d before deadline",
      "2d before deadline",
      "4d before deadline",
    ]);
  });

  it("labels the selected values", () => {
    expect(pollDeadlineLabel(opts({ deadline: "2h" }))).toBe("2h before event");
    expect(pollSuggestionsLabel(opts({ suggestions: "deadline:1d" }))).toBe("1d before deadline");
  });
});

describe("pollOptionsFromWire", () => {
  it("defaults a missing blob", () => {
    expect(pollOptionsFromWire(null)).toEqual(DEFAULT_POLL_OPTIONS);
  });

  it("keeps known values and defaults unknown ones PER FIELD", () => {
    // Mirrors the server sanitizer: one bad field doesn't discard the rest.
    const out = pollOptionsFromWire({
      deadline: "8h",
      suggestions: "whenever:3h",
      winner_method: "favorite",
      timezone: "America/Chicago",
    } as ActivityPollOptions);
    expect(out.deadline).toBe("8h");
    expect(out.suggestions).toBe("none");
    expect(out.winner_method).toBe("favorite");
    expect(out.timezone).toBe("America/Chicago");
  });
});

describe("pollOptionsToWire", () => {
  it("stamps the browser's zone — without it the server can't date the event", () => {
    const wire = pollOptionsToWire(opts({ deadline: "1d" }));
    expect(wire.deadline).toBe("1d");
    expect(typeof wire.timezone).toBe("string");
    expect(wire.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("pollOptionsSummary", () => {
  it("spells out the default: closes at the event, fixed options", () => {
    expect(pollOptionsSummary(opts())).toEqual([
      "Voting closes when the event starts.",
      "Options are fixed — voters can't add their own.",
    ]);
  });

  it("spells out a lead deadline and an open suggestion phase", () => {
    expect(pollOptionsSummary(opts({ deadline: "2h", suggestions: "deadline:1h" }))).toEqual([
      "Voting closes 2h before the event.",
      "Anyone can add options until 1h before the voting deadline.",
    ]);
  });

  it("echoes a retired before-event cutoff as no suggestions at all", () => {
    // pollOptionsFromWire already drops it to the default; the recap agrees
    // rather than describing a phase that will never start.
    const stale = pollOptionsFromWire({ ...opts(), suggestions: "event:1h" });
    expect(pollOptionsSummary(stale)[1]).toBe("Options are fixed — voters can't add their own.");
  });
});
