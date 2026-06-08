import { describe, it, expect } from "vitest";
import { parseTemporal } from "@/lib/pollTextParse";

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
