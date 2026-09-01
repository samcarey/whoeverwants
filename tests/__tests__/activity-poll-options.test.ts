import { describe, it, expect } from "vitest";
import {
  DEFAULT_POLL_OPTIONS,
  POLL_DEADLINE_OPTIONS,
  POLL_SUGGESTION_OPTIONS,
  pollDeadlineLabel,
  pollOptionsFromWire,
  pollOptionsSummary,
  pollOptionsToWire,
  pollSuggestionsAfterDeadline,
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

  it("offers suggestions off the deadline AND off the event", () => {
    expect(POLL_SUGGESTION_OPTIONS[0]).toEqual({ value: "none", label: "Do not allow" });
    // Both bases carry the same six lead times.
    const deadline = POLL_SUGGESTION_OPTIONS.filter((o) => o.value.startsWith("deadline:"));
    const event = POLL_SUGGESTION_OPTIONS.filter((o) => o.value.startsWith("event:"));
    expect(deadline).toHaveLength(6);
    expect(event).toHaveLength(6);
    expect(deadline[0].label).toBe("1 hour before deadline");
    expect(event[5].label).toBe("4 days before event");
  });

  it("labels the selected values", () => {
    expect(pollDeadlineLabel(opts({ deadline: "2h" }))).toBe("2 hours before event");
    expect(pollSuggestionsLabel(opts({ suggestions: "deadline:1d" }))).toBe("1 day before deadline");
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

describe("pollSuggestionsAfterDeadline", () => {
  it("is false when suggestions are off, or measured from the deadline", () => {
    expect(pollSuggestionsAfterDeadline(opts({ suggestions: "none" }))).toBe(false);
    expect(
      pollSuggestionsAfterDeadline(opts({ deadline: "4d", suggestions: "deadline:1h" })),
    ).toBe(false);
  });

  it("catches an event-anchored cutoff that lands at/after voting closes", () => {
    // Voting closes 4 days out; suggesting until an hour before the event
    // would be after that.
    expect(pollSuggestionsAfterDeadline(opts({ deadline: "4d", suggestions: "event:1h" }))).toBe(
      true,
    );
    // Equal leads collide too (both land on the same instant).
    expect(pollSuggestionsAfterDeadline(opts({ deadline: "2h", suggestions: "event:2h" }))).toBe(
      true,
    );
    // Comfortably before the deadline is fine.
    expect(pollSuggestionsAfterDeadline(opts({ deadline: "2h", suggestions: "event:1d" }))).toBe(
      false,
    );
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
      "Voting closes 2 hours before the event.",
      "Anyone can add options until 1 hour before the voting deadline.",
    ]);
  });

  it("says so when the cutoff would outlast voting (the server clamps it)", () => {
    expect(pollOptionsSummary(opts({ deadline: "4d", suggestions: "event:1h" }))[1]).toBe(
      "Suggestions would close after voting does, so they close with it.",
    );
  });
});
