// Pure, React-free PLANNER for the new-poll search box's suggestion list.
//
// SINGLE SOURCE OF TRUTH for *which* suggestion rows appear and *in what order*.
// `app/create-poll/page.tsx` consumes this to render the rows (it maps each
// PlannedRow to its icon/segments/overrides), and the committed scoring harness
// (`tests/__tests__/poll-suggestion-scoring.test.ts`) consumes the SAME function
// — so the regression numbers measure the real box, with zero drift.
//
// The list is rendered BOTTOM-ANCHORED: rows stack upward from the search bar,
// and the LAST element is nearest the bar — the de-facto default. So this
// planner returns rows top→bottom with the single `primary` row LAST.
//
// Design (fixes the review findings):
//   • Category matching is delegated to lib/categoryMatch.ts (any-token, stop-
//     word-filtered, ranked), so natural sentences ("movie night", "where
//     should we eat") surface their category instead of falling through.
//   • The most-specific PRESENT interpretation is the primary (nearest bar); the
//     generic Custom/Context rows are the fallback floor, never the default.
//   • Primary precedence mirrors decidePoll (the Siri parser): explicit options
//     ≥2 → yes/no question stem → matched category → temporal time → custom.

import type { DayTimeWindow } from "./types";
import {
  parseForContext,
  parseOptionsFromText,
  parseTemporal,
  startsWithYesNoStem,
  stripTemporal,
} from "./pollTextParse";
import { rankCategories, CATEGORY_ORDER } from "./categoryMatch";
import { splitLeadingEmoji } from "./emojiData";

export type PlannedKind =
  | "yes_no"
  | "limited_supply"
  | "custom"
  | "context"
  | "options"
  | "time"
  | "category";

export interface PlannedRow {
  kind: PlannedKind;
  /** 'category' → built-in category value; 'custom' → the typed subject text. */
  category?: string;
  /** 'options' → the ≥2 parsed ballot options. */
  options?: string[];
  /** Question-level context (the "for X" tail, or the subject for the
   *  context-interpretation row), prefilled into the form's forField. */
  context?: string;
  /** Raw subject used as the yes/no prompt + limited-supply item name. */
  subject?: string;
  /** time / time-category rows: prefill windows parsed from the phrase. */
  temporalWindows?: DayTimeWindow[];
  /** Exactly one row per non-empty plan is the nearest-bar default. */
  primary: boolean;
}

export interface PlanOptions {
  /** orderedBubbleEntries values — recency order, used only to break score
   *  ties among co-matched categories (keeps the default deterministic). */
  categoryOrder?: string[];
  now?: Date;
}

const keyOf = (kind: PlannedKind, category?: string) =>
  kind === "category" ? `category:${category}` : kind;

/**
 * Plan the search box's suggestion rows for a typed query. Returns [] for empty
 * input. Rows are top→bottom; the last (primary) row is the nearest-bar default.
 */
export function planPollSuggestions(rawInput: string, opts: PlanOptions = {}): PlannedRow[] {
  // A leading emoji is a display concern (handled by the box); strip it so the
  // REST drives the interpretation ("🍕 pizza or tacos" plans as "pizza or tacos").
  const { rest } = splitLeadingEmoji(rawInput.trim());
  const raw = rest.trim();
  // Empty input (box focused, nothing typed) = browse the category menu: all
  // searchable categories in the caller's recency order, the first nearest the
  // bar. Mirrors the box's pre-rework empty-focus state.
  if (!raw) {
    const order = (opts.categoryOrder ?? []).filter((v) => CATEGORY_ORDER.includes(v));
    const vals = order.length ? [...new Set(order)] : [...CATEGORY_ORDER];
    return vals
      .slice()
      .reverse()
      .map((value, idx, a): PlannedRow => ({ kind: "category", category: value, context: "", primary: idx === a.length - 1 }));
  }

  const { subject, context } = parseForContext(raw);
  const hasFor = /\bfor\b/i.test(raw);
  const options = parseOptionsFromText(subject);
  const hasOptions = options.length >= 2;
  const temporal = parseTemporal(raw, opts.now ?? new Date());
  const hasTemporal = temporal.length > 0;
  const ranked = rankCategories(subject, opts.categoryOrder ?? []);
  const customCategory = subject.trim() || raw;

  // ── Primary (nearest-bar default) — decidePoll-style precedence ──────────
  let primaryKind: PlannedKind;
  let primaryCategory: string | undefined;
  if (hasOptions) primaryKind = "options";
  else if (startsWithYesNoStem(raw)) primaryKind = "yes_no";
  else if (ranked.length) {
    primaryKind = "category";
    primaryCategory = ranked[0].value;
  } else if (hasTemporal) primaryKind = "time";
  else primaryKind = "custom";

  const categoryRow = (value: string, primary: boolean): PlannedRow => {
    const isTime = value === "time";
    return {
      kind: "category",
      category: value,
      context: isTime ? stripTemporal(context) : context,
      ...(isTime && hasTemporal ? { temporalWindows: temporal } : {}),
      primary,
    };
  };

  let primaryRow: PlannedRow;
  switch (primaryKind) {
    case "options":
      primaryRow = { kind: "options", options, context, primary: true };
      break;
    case "yes_no":
      primaryRow = { kind: "yes_no", subject: raw, context, primary: true };
      break;
    case "category":
      primaryRow = categoryRow(primaryCategory!, true);
      break;
    case "time":
      primaryRow = { kind: "time", context: stripTemporal(subject), temporalWindows: temporal, primary: true };
      break;
    default:
      primaryRow = { kind: "custom", category: customCategory, context, primary: true };
  }
  const primaryKey = keyOf(primaryRow.kind, primaryRow.category);

  // ── Non-primary rows, weak→strong (top→just above primary) ───────────────
  const rows: PlannedRow[] = [];
  // Generic floor (weakest, top).
  if (subject && !hasFor) rows.push({ kind: "context", context: subject, primary: false });
  if (subject) rows.push({ kind: "custom", category: customCategory, context, primary: false });
  // "Frame the whole text" rows.
  rows.push({ kind: "limited_supply", subject: raw, context, primary: false });
  rows.push({ kind: "yes_no", subject: raw, context, primary: false });
  // Specific interpretations.
  if (hasOptions) rows.push({ kind: "options", options, context, primary: false });
  if (hasTemporal && !(primaryKind === "category" && primaryCategory === "time") && primaryKind !== "time") {
    rows.push({ kind: "time", context: stripTemporal(subject), temporalWindows: temporal, primary: false });
  }
  // Matched categories, weakest first so the 2nd-best sits just above primary.
  for (const r of [...ranked].reverse()) rows.push(categoryRow(r.value, false));

  // Drop the duplicate of whatever became primary, then pin primary last.
  return [...rows.filter((r) => keyOf(r.kind, r.category) !== primaryKey), primaryRow];
}

/** The single nearest-bar default for a query (the primary row), or null for
 *  empty input. Convenience for callers that only need the default. */
export function primarySuggestion(rawInput: string, opts: PlanOptions = {}): PlannedRow | null {
  const rows = planPollSuggestions(rawInput, opts);
  return rows.length ? rows[rows.length - 1] : null;
}
