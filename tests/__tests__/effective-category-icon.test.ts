import { describe, it, expect } from "vitest";
import {
  effectiveCategoryIcon,
  emptyDraft,
  type QuestionDraft,
} from "@/app/create-poll/createPollHelpers";

/**
 * Regression guard for the production-Safari poll-submission crash
 * (PR #647): `effectiveCategoryIcon` ran `d.categoryIcon.trim()`, which threw
 * `TypeError: undefined is not an object` when a draft was restored from a
 * localStorage `questionFormState` (or staged `drafts[]`) saved BEFORE the
 * `categoryIcon` field shipped (migration 127). Those old-shaped drafts are
 * replayed verbatim by the create-poll restore paths, so the helper must
 * tolerate a missing `categoryIcon` and never throw mid-submit.
 *
 * `QuestionDraft` requires `categoryIcon: string` at compile time, but the
 * whole point is that RUNTIME data (old localStorage) can violate that — so
 * the stale shapes are deliberately cast.
 */
describe("effectiveCategoryIcon", () => {
  it("does not throw and returns null for a draft missing categoryIcon (stale localStorage shape)", () => {
    const { categoryIcon, ...rest } = emptyDraft();
    const stale = rest as unknown as QuestionDraft; // pre-migration-127 draft: no categoryIcon key
    expect(() => effectiveCategoryIcon(stale)).not.toThrow();
    expect(effectiveCategoryIcon(stale)).toBeNull();
  });

  it("does not throw and returns null when categoryIcon is explicitly undefined", () => {
    const stale = { ...emptyDraft(), categoryIcon: undefined } as unknown as QuestionDraft;
    expect(() => effectiveCategoryIcon(stale)).not.toThrow();
    expect(effectiveCategoryIcon(stale)).toBeNull();
  });

  it("returns null for an empty / whitespace-only categoryIcon", () => {
    expect(effectiveCategoryIcon({ ...emptyDraft(), categoryIcon: "" })).toBeNull();
    expect(effectiveCategoryIcon({ ...emptyDraft(), categoryIcon: "   " })).toBeNull();
  });

  it("returns the trimmed chosen emoji when one is set", () => {
    expect(effectiveCategoryIcon({ ...emptyDraft(), categoryIcon: "🎬" })).toBe("🎬");
    expect(effectiveCategoryIcon({ ...emptyDraft(), categoryIcon: "  🍕 " })).toBe("🍕");
  });
});
