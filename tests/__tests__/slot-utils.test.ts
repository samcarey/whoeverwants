import { describe, it, expect } from "vitest";
import type { Slot } from "@/lib/api/slots";
import {
  formatDecimalHours,
  slotHeader,
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

describe("slotHeader", () => {
  it("single-day single-window: times + duration, no end date", () => {
    const h = slotHeader([{ day: "2099-06-15", windows: [{ min: "14:00", max: "16:15" }] }]);
    expect(h).not.toBeNull();
    expect(h!.startDate).toContain("Jun 15");
    expect(h!.startTime).toBe("2:00 PM");
    expect(h!.endTime).toBe("4:15 PM");
    expect(h!.endDate).toBeNull();
    expect(h!.duration).toBe("2.25h");
    expect(typeof h!.relative).toBe("string");
  });

  it("spans multiple days: end date shown, duration is the window total", () => {
    const h = slotHeader([
      { day: "2099-06-15", windows: [{ min: "09:00", max: "10:00" }] },
      { day: "2099-06-17", windows: [{ min: "18:00", max: "20:00" }] },
    ]);
    expect(h).not.toBeNull();
    expect(h!.startDate).toContain("Jun 15");
    expect(h!.startTime).toBe("9:00 AM");
    expect(h!.endDate).toContain("Jun 17");
    expect(h!.endTime).toBe("8:00 PM");
    // 1h + 2h across the two windows.
    expect(h!.duration).toBe("3h");
  });

  it("returns null for a slot with no windows", () => {
    expect(slotHeader([])).toBeNull();
    expect(slotHeader([{ day: "2099-06-15", windows: [] }])).toBeNull();
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
