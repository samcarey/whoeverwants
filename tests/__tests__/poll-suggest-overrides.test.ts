import { describe, it, expect } from "vitest";
import { suggestionToOverrides } from "@/app/create-poll/createPollHelpers";
import type { PollSuggestion } from "@/lib/api/users";

/**
 * The structured-AI-suggestion → draft-overrides mapping. A suggestion from the
 * server LLM ({category, title?, options?, context?}) must prefill the create-
 * poll form's draft fields so the displayed title auto-generates from them — the
 * same per-type mapping the recent-poll reuse path uses. This pins the mapping;
 * the server validates the suggestion shape, and the eval harness
 * (prototypes/poll-suggest/) judges the LLM's quality.
 */
describe("suggestionToOverrides", () => {
  const s = (o: Partial<PollSuggestion> & { category: string }): PollSuggestion => o;

  it("maps yes_no to a typed-prompt draft", () => {
    expect(suggestionToOverrides(s({ category: "yes_no", title: "Offsite in Q3?" }))).toEqual({
      category: "yes_no",
      title: "Offsite in Q3?",
      isAutoTitle: false,
    });
  });

  it("maps limited_supply to a typed-item draft", () => {
    expect(
      suggestionToOverrides(s({ category: "limited_supply", title: "2 spare tickets" })),
    ).toEqual({ category: "limited_supply", title: "2 spare tickets", isAutoTitle: false });
  });

  it("drops yes_no / limited_supply with no title (unusable draft)", () => {
    expect(suggestionToOverrides(s({ category: "yes_no" }))).toBeNull();
    expect(suggestionToOverrides(s({ category: "limited_supply", title: "  " }))).toBeNull();
  });

  it("maps a fixed-options choice poll (>=2 options) to a fixed-options draft", () => {
    expect(
      suggestionToOverrides(
        s({ category: "movie", options: ["Dune", "Barbie"], context: "movie night" }),
      ),
    ).toEqual({
      category: "movie",
      options: ["Dune", "Barbie"],
      collectSuggestions: false,
      forField: "movie night",
    });
  });

  it("maps a choice category with <2 options to a suggestion-collection draft", () => {
    expect(
      suggestionToOverrides(s({ category: "restaurant", context: "team lunch" })),
    ).toEqual({ category: "restaurant", forField: "team lunch", collectSuggestions: true });
    // A single option can't form a fixed ballot → suggestion-collection.
    expect(suggestionToOverrides(s({ category: "restaurant", options: ["Chipotle"] }))).toEqual({
      category: "restaurant",
      forField: "",
      collectSuggestions: true,
    });
  });

  it("maps time to a context-only draft (no options re-seeded)", () => {
    expect(suggestionToOverrides(s({ category: "time", context: "game night" }))).toEqual({
      category: "time",
      forField: "game night",
    });
  });

  it("trims context", () => {
    expect(
      suggestionToOverrides(s({ category: "custom", options: ["A", "B"], context: "  x  " })),
    ).toEqual({ category: "custom", options: ["A", "B"], collectSuggestions: false, forField: "x" });
  });

  it("restores per-option DB ref (optionsMetadata) for kept options", () => {
    expect(
      suggestionToOverrides(
        s({
          category: "movie",
          options: ["Dune", "Barbie"],
          optionsMetadata: {
            Dune: { imageUrl: "https://img/dune.jpg", infoUrl: "https://tmdb/1" },
            // Metadata for an option that isn't kept must be dropped.
            Oppenheimer: { imageUrl: "https://img/opp.jpg" },
          },
          context: "movie night",
        }),
      ),
    ).toEqual({
      category: "movie",
      options: ["Dune", "Barbie"],
      collectSuggestions: false,
      forField: "movie night",
      optionsMetadata: { Dune: { imageUrl: "https://img/dune.jpg", infoUrl: "https://tmdb/1" } },
    });
  });

  it("omits optionsMetadata when none of the kept options carry a ref", () => {
    expect(
      suggestionToOverrides(s({ category: "custom", options: ["A", "B"] })),
    ).toEqual({ category: "custom", options: ["A", "B"], collectSuggestions: false, forField: "" });
  });
});
