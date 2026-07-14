import { describe, it, expect } from "vitest";
import type { Slot } from "@/lib/api/slots";
import {
  formatDecimalHours,
  slotWindowLines,
  slotWindowEntries,
  buildActivityColorMap,
  activityColor,
  sortSlotsChronological,
  slotStartAbs,
} from "@/lib/slotUtils";

function slot(
  id: string,
  day_time_windows: Slot["day_time_windows"],
  activities: Slot["activities"] = [],
  created_at: string | null = null,
): Slot {
  return { id, day_time_windows, activities, created_at };
}

describe("formatDecimalHours", () => {
  it("renders decimal hours, trailing zeros stripped", () => {
    expect(formatDecimalHours(135)).toBe("2.25h");
    expect(formatDecimalHours(60)).toBe("1h");
    expect(formatDecimalHours(90)).toBe("1.5h");
    expect(formatDecimalHours(200)).toBe("3.33h");
    expect(formatDecimalHours(30)).toBe("0.5h");
  });
});

describe("slotWindowLines", () => {
  it("single window: one line with its own times + duration, no end date", () => {
    const lines = slotWindowLines([{ day: "2099-06-15", windows: [{ min: "14:00", max: "16:15" }] }]);
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.date).toContain("Jun 15");
    expect(l.startTime).toBe("2:00 PM");
    expect(l.endTime).toBe("4:15 PM");
    expect(l.endDate).toBeNull();
    expect(l.duration).toBe("2.25h");
    expect(typeof l.relative).toBe("string");
  });

  it("disjoint windows render as separate lines (NOT one collapsed span), chronological", () => {
    const lines = slotWindowLines([
      { day: "2099-06-17", windows: [{ min: "18:00", max: "20:00" }] },
      { day: "2099-06-15", windows: [{ min: "09:00", max: "10:00" }] },
    ]);
    expect(lines).toHaveLength(2);
    // Sorted soonest-first.
    expect(lines[0].date).toContain("Jun 15");
    expect(lines[0].startTime).toBe("9:00 AM");
    expect(lines[0].endTime).toBe("10:00 AM");
    expect(lines[0].duration).toBe("1h");
    expect(lines[1].date).toContain("Jun 17");
    expect(lines[1].startTime).toBe("6:00 PM");
    expect(lines[1].endTime).toBe("8:00 PM");
    expect(lines[1].duration).toBe("2h");
  });

  it("two windows on the SAME day are two separate lines", () => {
    const lines = slotWindowLines([
      { day: "2099-06-15", windows: [{ min: "09:00", max: "10:00" }, { min: "14:00", max: "16:00" }] },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].startTime).toBe("9:00 AM");
    expect(lines[1].startTime).toBe("2:00 PM");
  });

  it("is empty for a slot with no windows", () => {
    expect(slotWindowLines([])).toEqual([]);
    expect(slotWindowLines([{ day: "2099-06-15", windows: [] }])).toEqual([]);
  });
});

describe("buildActivityColorMap", () => {
  it("assigns one stable color per activity, consistent across slots", () => {
    const slots = [
      slot("a", [{ day: "2099-06-15", windows: [{ min: "09:00", max: "10:00" }] }], [
        { name: "Hiking", emoji: null },
        { name: "Coffee", emoji: null },
      ]),
      slot("b", [{ day: "2099-06-16", windows: [{ min: "09:00", max: "10:00" }] }], [
        { name: "hiking", emoji: null }, // same activity, different casing
      ]),
    ];
    const colors = buildActivityColorMap(slots);
    const hikingA = activityColor("Hiking", colors);
    const hikingB = activityColor("hiking", colors);
    expect(hikingA).toEqual(hikingB); // req 1: consistent per activity
    // req 2: distinct activities get distinct palette entries
    expect(activityColor("Coffee", colors)).not.toEqual(hikingA);
  });
});

describe("slotWindowEntries", () => {
  it("explodes each slot into one entry per window, sorted soonest-first across slots", () => {
    const a = slot(
      "a",
      [
        { day: "2099-06-17", windows: [{ min: "18:00", max: "20:00" }] },
        { day: "2099-06-15", windows: [{ min: "09:00", max: "10:00" }] },
      ],
      [{ name: "Hiking", emoji: null }],
    );
    const b = slot("b", [{ day: "2099-06-16", windows: [{ min: "12:00", max: "13:00" }] }], [
      { name: "Coffee", emoji: null },
    ]);
    const entries = slotWindowEntries([a, b]);
    // 3 windows total, chronological regardless of which slot they belong to.
    expect(entries.map((e) => e.line.date.replace(/^\w+, /, ""))).toEqual([
      "Jun 15",
      "Jun 16",
      "Jun 17",
    ]);
    // Both of slot "a"'s windows carry slot a (its activities render the bars).
    expect(entries[0].slot.id).toBe("a");
    expect(entries[2].slot.id).toBe("a");
    expect(entries[1].slot.id).toBe("b");
    // Keys are unique per window.
    expect(new Set(entries.map((e) => e.key)).size).toBe(3);
  });

  it("returns nothing for a slot with no windows", () => {
    expect(slotWindowEntries([slot("x", [])])).toEqual([]);
  });
});

describe("sortSlotsChronological", () => {
  it("orders soonest availability start first", () => {
    const later = slot("later", [{ day: "2099-06-20", windows: [{ min: "09:00", max: "10:00" }] }]);
    const sooner = slot("sooner", [{ day: "2099-06-15", windows: [{ min: "20:00", max: "21:00" }] }]);
    const soonestTime = slot("soonestTime", [
      { day: "2099-06-15", windows: [{ min: "08:00", max: "09:00" }] },
    ]);
    const sorted = sortSlotsChronological([later, sooner, soonestTime]);
    expect(sorted.map((s) => s.id)).toEqual(["soonestTime", "sooner", "later"]);
  });

  it("slots with no windows sort last", () => {
    const empty = slot("empty", []);
    const real = slot("real", [{ day: "2099-06-15", windows: [{ min: "09:00", max: "10:00" }] }]);
    expect(slotStartAbs(empty)).toBe(Number.POSITIVE_INFINITY);
    expect(sortSlotsChronological([empty, real]).map((s) => s.id)).toEqual(["real", "empty"]);
  });
});
