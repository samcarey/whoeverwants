import { describe, it, expect } from "vitest";
import { parseTemporal, stripTemporal } from "@/lib/pollTextParse";

// Anchor every case to a fixed "today" so the relative-date math is
// deterministic. 2026-06-08 is a MONDAY (verified: 2026-01-01 is a Thursday;
// June 1 2026 is a Monday; June 8 = +7 = Monday). Month arg is 0-indexed.
const TODAY = new Date(2026, 5, 8); // Mon 2026-06-08

// Expected weekday resolutions from Mon 2026-06-08 (getDay() === 1):
//   wednesday(3) → +2  → 06-10
//   friday(5)    → +4  → 06-12   ("next friday" → +7 → 06-19)
//   saturday(6)  → +5  → 06-13
//   sunday(0)    → +6  → 06-14
const w = (min: string, max: string) => ({ min, max });

describe("parseTemporal — window prefill (deterministic on a fixed today)", () => {
  it("day + band keyword: 'time for games tonight' → today, evening/night", () => {
    expect(parseTemporal("time for games tonight", TODAY)).toEqual([
      { day: "2026-06-08", windows: [w("18:00", "23:00")] },
    ]);
  });

  it("meal band + 'this <weekday>': 'dinner this friday'", () => {
    expect(parseTemporal("dinner this friday", TODAY)).toEqual([
      { day: "2026-06-12", windows: [w("18:00", "20:00")] },
    ]);
  });

  it("band across two days: 'lunch tomorrow or wednesday'", () => {
    expect(parseTemporal("lunch tomorrow or wednesday", TODAY)).toEqual([
      { day: "2026-06-09", windows: [w("11:30", "13:30")] },
      { day: "2026-06-10", windows: [w("11:30", "13:30")] },
    ]);
  });

  it("explicit pm range: 'meet saturday 7-9pm'", () => {
    expect(parseTemporal("meet saturday 7-9pm", TODAY)).toEqual([
      { day: "2026-06-13", windows: [w("19:00", "21:00")] },
    ]);
  });

  it("bare-hour clock, no day → today: 'coffee at 9' → 9am+2h", () => {
    expect(parseTemporal("coffee at 9", TODAY)).toEqual([
      { day: "2026-06-08", windows: [w("09:00", "11:00")] },
    ]);
  });

  it("'at 7pm' single point → start + 2h", () => {
    expect(parseTemporal("trivia at 7pm", TODAY)).toEqual([
      { day: "2026-06-08", windows: [w("19:00", "21:00")] },
    ]);
  });

  it("weekend × band: 'movie night this weekend' → Sat & Sun evening/night", () => {
    expect(parseTemporal("movie night this weekend", TODAY)).toEqual([
      { day: "2026-06-13", windows: [w("18:00", "23:00")] },
      { day: "2026-06-14", windows: [w("18:00", "23:00")] },
    ]);
  });

  it("bare day, no band → narrow evening suggestion: 'friday'", () => {
    expect(parseTemporal("friday", TODAY)).toEqual([
      { day: "2026-06-12", windows: [w("17:00", "21:00")] },
    ]);
  });

  it("'next friday' rolls a week forward", () => {
    expect(parseTemporal("next friday", TODAY)).toEqual([
      { day: "2026-06-19", windows: [w("17:00", "21:00")] },
    ]);
  });

  it("one day, two bands: 'tomorrow morning or evening'", () => {
    expect(parseTemporal("tomorrow morning or evening", TODAY)).toEqual([
      { day: "2026-06-09", windows: [w("08:00", "12:00"), w("17:00", "21:00")] },
    ]);
  });

  it("open-ended clock: 'after 6pm tomorrow' → 18:00–23:30", () => {
    expect(parseTemporal("after 6pm tomorrow", TODAY)).toEqual([
      { day: "2026-06-09", windows: [w("18:00", "23:30")] },
    ]);
  });

  it("'before noon today'", () => {
    expect(parseTemporal("before noon today", TODAY)).toEqual([
      { day: "2026-06-08", windows: [w("08:00", "12:00")] },
    ]);
  });

  it("multi-word band precedence: 'saturday late night'", () => {
    expect(parseTemporal("saturday late night", TODAY)).toEqual([
      { day: "2026-06-13", windows: [w("21:00", "23:30")] },
    ]);
  });

  it("'in 3 days' relative offset", () => {
    expect(parseTemporal("in 3 days", TODAY)).toEqual([
      { day: "2026-06-11", windows: [w("17:00", "21:00")] },
    ]);
  });

  it("no-meridiem range shares one half: 'between 6 and 8' → 6–8pm", () => {
    expect(parseTemporal("dinner between 6 and 8 friday", TODAY)).toEqual([
      // explicit clock wins; the lexicon "dinner" band de-dupes only if equal
      { day: "2026-06-12", windows: [w("18:00", "20:00")] },
    ]);
  });

  it("'this week' → rest of the week incl weekend, with the band", () => {
    const r = parseTemporal("dinner this week", TODAY);
    expect(r.map((d) => d.day)).toEqual([
      "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11",
      "2026-06-12", "2026-06-13", "2026-06-14",
    ]);
    expect(r.every((d) => d.windows.length === 1 && d.windows[0].min === "18:00" && d.windows[0].max === "20:00")).toBe(true);
  });

  it("'next week' → the following Mon–Sun", () => {
    expect(parseTemporal("lunch next week", TODAY).map((d) => d.day)).toEqual([
      "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18",
      "2026-06-19", "2026-06-20", "2026-06-21",
    ]);
  });

  it("'in 2 weeks' → +14 days", () => {
    expect(parseTemporal("offsite in 2 weeks", TODAY)).toEqual([
      { day: "2026-06-22", windows: [w("17:00", "21:00")] },
    ]);
  });

  it("'in a couple days' → +2, 'in a few days' → +3", () => {
    expect(parseTemporal("call in a couple days", TODAY)).toEqual([
      { day: "2026-06-10", windows: [w("17:00", "21:00")] },
    ]);
    expect(parseTemporal("call in a few days", TODAY)).toEqual([
      { day: "2026-06-11", windows: [w("17:00", "21:00")] },
    ]);
  });

  it("fuzzy clock '7ish' → 7pm + 2h", () => {
    expect(parseTemporal("trivia 7ish", TODAY)).toEqual([
      { day: "2026-06-08", windows: [w("19:00", "21:00")] },
    ]);
  });

  it("'after dinner tomorrow' → 8–10 PM (not the dinner band)", () => {
    expect(parseTemporal("drinks after dinner tomorrow", TODAY)).toEqual([
      { day: "2026-06-09", windows: [w("20:00", "22:00")] },
    ]);
  });

  it("'anytime saturday' → all-day band", () => {
    expect(parseTemporal("hangout anytime saturday", TODAY)).toEqual([
      { day: "2026-06-13", windows: [w("09:00", "21:00")] },
    ]);
  });

  // --- Negative / robustness cases (no temporal prefill) ---

  it("bare number is not a clock: '7 wonders' → []", () => {
    expect(parseTemporal("7 wonders", TODAY)).toEqual([]);
  });

  it("lone band word, no day or clock: 'dinner' → []", () => {
    expect(parseTemporal("dinner", TODAY)).toEqual([]);
  });

  it("no temporal content: 'best taco spot' → []", () => {
    expect(parseTemporal("best taco spot", TODAY)).toEqual([]);
  });

  it("empty input → []", () => {
    expect(parseTemporal("", TODAY)).toEqual([]);
    expect(parseTemporal("   ", TODAY)).toEqual([]);
  });

  it("category-agnostic: 'should we get pizza tonight' still yields windows", () => {
    // parseTemporal never inspects yes/no stems — it only finds the window.
    expect(parseTemporal("should we get pizza tonight", TODAY)).toEqual([
      { day: "2026-06-08", windows: [w("18:00", "23:00")] },
    ]);
  });
});

describe("stripTemporal — lift day/time text out, keep meal nouns", () => {
  it("keeps the meal noun, drops the day: 'dinner this friday' → 'dinner'", () => {
    expect(stripTemporal("dinner this friday")).toBe("dinner");
  });

  it("drops a pure time-of-day word: 'games tonight' → 'games'", () => {
    expect(stripTemporal("games tonight")).toBe("games");
  });

  it("drops the day, keeps the meal: 'lunch tomorrow or wednesday' → 'lunch'", () => {
    expect(stripTemporal("lunch tomorrow or wednesday")).toBe("lunch");
  });

  it("drops an explicit clock: 'coffee at 9' → 'coffee'", () => {
    expect(stripTemporal("coffee at 9")).toBe("coffee");
  });

  it("drops a clock range: 'meet saturday 7-9pm' → 'meet'", () => {
    expect(stripTemporal("meet saturday 7-9pm")).toBe("meet");
  });

  it("drops 'this weekend' and the band, keeps the subject: 'movie night this weekend' → 'movie'", () => {
    expect(stripTemporal("movie night this weekend")).toBe("movie");
  });

  it("a bare day strips to empty: 'friday' → ''", () => {
    expect(stripTemporal("friday")).toBe("");
  });

  it("leaves non-temporal text untouched: 'best taco spot' → unchanged", () => {
    expect(stripTemporal("best taco spot")).toBe("best taco spot");
  });

  it("'next friday' and 'in 3 days' fully strip", () => {
    expect(stripTemporal("hangout next friday")).toBe("hangout");
    expect(stripTemporal("trip in 3 days")).toBe("trip");
  });

  it("strips 'this week' / 'next week' but keeps the meal noun", () => {
    expect(stripTemporal("book club this week")).toBe("book club");
    expect(stripTemporal("standup next week")).toBe("standup");
    expect(stripTemporal("dinner this week")).toBe("dinner");
  });

  it("strips 'after dinner' wholesale (it's a time, not the meal)", () => {
    expect(stripTemporal("drinks after dinner")).toBe("drinks");
  });

  it("strips fuzzy clock + all-day words", () => {
    expect(stripTemporal("trivia 7ish")).toBe("trivia");
    expect(stripTemporal("whenever this weekend")).toBe("");
  });
});
