/**
 * Bridge between the activity editor's Poll card (NewSlotSheet) and the
 * create-poll draft machinery — so an attached activity poll reuses the SAME
 * suggestion planner, title derivation, and draft→wire conversion the new-poll
 * search box uses, instead of growing a parallel implementation.
 *
 * The editable state (`ActivityPollEdit`) is the minimal subset of
 * QuestionDraft an attached poll can express in v1: a yes/no question (the
 * typed prompt IS the title) or a fixed-options ranked choice (a category or
 * custom subject + ≥2 options + an optional "for X" context). Everything
 * funnels through `toQuestionDraft` so titles/wire params can never drift
 * from what the create-poll flow would produce for the same fields.
 *
 * NOTE: imports from app/create-poll/createPollHelpers — per that file's
 * header, helpers get promoted to lib/ when they grow external callsites;
 * this module is deliberately the ONLY import site outside create-poll so a
 * future promotion is a one-file re-point.
 */

import {
  deriveDraftTitle,
  draftTitleSegments,
  draftToQuestionParams,
  emptyDraft,
  type QuestionDraft,
  type TitleSegment,
} from "@/app/create-poll/createPollHelpers";
import { getBuiltInType } from "@/components/TypeFieldInput";
import type { PlannedRow } from "@/lib/pollSuggestions";
import { planPollSuggestions } from "@/lib/pollSuggestions";
import type { ActivityPollDraft, ActivityPollQuestion } from "@/lib/api/slots";

export type { TitleSegment } from "@/app/create-poll/createPollHelpers";

/** The Poll submodal's editable state. `category` is 'yes_no', a built-in
 *  category value, or free custom text (the create-poll custom-row shape). */
export interface ActivityPollEdit {
  category: string;
  /** The yes/no prompt (unused for other categories — those auto-title). */
  title: string;
  /** The "for X" context. */
  forField: string;
  options: string[];
  categoryIcon: string;
}

function toQuestionDraft(e: ActivityPollEdit): QuestionDraft {
  return {
    ...emptyDraft({ category: e.category === "yes_no" ? "yes_no" : undefined }),
    category: e.category,
    title: e.title,
    isAutoTitle: e.category !== "yes_no",
    forField: e.forField,
    options: e.options.length > 0 ? e.options : [""],
    categoryIcon: e.categoryIcon,
    // Fixed options only — an attached poll is prephase-free (the server
    // starts it with no suggestion/availability deadline).
    collectSuggestions: false,
  };
}

/** The title the started poll would land on, as annotated segments (the
 *  suggestion-row display) / plain text. */
export function pollEditTitleSegments(e: ActivityPollEdit): TitleSegment[] {
  return draftTitleSegments(toQuestionDraft(e));
}

export function pollEditTitle(e: ActivityPollEdit): string {
  return deriveDraftTitle(toQuestionDraft(e));
}

/** Complete enough to actually start: a yes/no needs its prompt, anything
 *  else needs ≥2 options (the server drops incomplete drafts on save). */
export function pollEditValid(e: ActivityPollEdit): boolean {
  if (e.category === "yes_no") return e.title.trim().length > 0;
  return e.options.filter((o) => o.trim()).length >= 2;
}

/** Human label for the edit's category row ("Yes / No", "Movie", or the
 *  custom text verbatim). */
export function pollEditCategoryLabel(e: ActivityPollEdit): string {
  if (e.category === "yes_no") return "Yes / No";
  return getBuiltInType(e.category)?.label ?? (e.category === "custom" ? "Custom" : e.category);
}

/** The row/card icon: the chosen emoji, else the category's default glyph. */
export function pollEditIcon(e: ActivityPollEdit): string {
  const chosen = e.categoryIcon.trim();
  if (chosen) return chosen;
  if (e.category === "yes_no") return "👍";
  return getBuiltInType(e.category)?.icon ?? "🗳️";
}

/** Editable state → the stored wire draft, via the REAL draft→params
 *  converter so the replayed question matches what creating the same poll by
 *  hand would send. Null when incomplete (the card warns instead of saving a
 *  draft the server would silently drop). */
export function pollEditToWire(e: ActivityPollEdit): ActivityPollDraft | null {
  if (!pollEditValid(e)) return null;
  const p = draftToQuestionParams(toQuestionDraft(e), null);
  const question: ActivityPollQuestion = {
    question_type: p.question_type === "yes_no" ? "yes_no" : "ranked_choice",
    category: p.category ?? null,
    category_icon: p.category_icon ?? null,
    options: p.options ?? null,
    context: p.context ?? null,
    winner_method:
      p.winner_method ?? (p.question_type === "yes_no" ? null : "consensus"),
    is_auto_title: p.is_auto_title === true,
  };
  return { title: pollEditTitle(e), question };
}

/** Stored wire draft → editable state (reopening the submodal). The mapping
 *  inverts draftToQuestionParams' conventions: a yes/no prompt rides as
 *  `context`; a ranked choice's `context` is the "for X" field. */
export function pollEditFromWire(pd: ActivityPollDraft): ActivityPollEdit {
  const q = pd.question;
  if (q.question_type === "yes_no") {
    return {
      category: "yes_no",
      title: (q.context ?? pd.title ?? "").replace(/\?$/, ""),
      forField: "",
      options: [],
      categoryIcon: q.category_icon ?? "",
    };
  }
  return {
    category: q.category ?? "custom",
    title: "",
    forField: q.context ?? "",
    options: [...(q.options ?? [])],
    categoryIcon: q.category_icon ?? "",
  };
}

/** A planner row → the poll edit it would attach; null for the kinds an
 *  attached poll can't be (time — the event already HAS a time; showtime —
 *  needs the live catalog; limited_supply — needs a supply count). */
export function plannedRowToPollEdit(row: PlannedRow): ActivityPollEdit | null {
  const base = { title: "", forField: row.context ?? "", options: [] as string[], categoryIcon: "" };
  switch (row.kind) {
    case "yes_no":
      return { ...base, category: "yes_no", title: row.subject ?? "" };
    case "options":
      return { ...base, category: "custom", options: [...(row.options ?? [])] };
    case "category": {
      const v = row.category ?? "";
      if (!v || v === "time" || v === "showtime" || v === "limited_supply") return null;
      return { ...base, category: v };
    }
    case "custom":
      return { ...base, category: row.category ?? "custom" };
    case "context":
      return { ...base, category: "custom" };
    default:
      return null;
  }
}

export interface PollSuggestionRow {
  key: string;
  icon: string;
  segments: TitleSegment[];
  edit: ActivityPollEdit;
}

/** The Poll card's suggestion rows for a typed query: the SAME planner the
 *  new-poll search box uses, filtered to attachable kinds and flipped so the
 *  planner's primary (nearest-bar default) comes FIRST — this dropdown is
 *  top-anchored, unlike the box's bottom-anchored list. */
export function pollSuggestionRows(query: string): PollSuggestionRow[] {
  const rows: PollSuggestionRow[] = [];
  for (const row of planPollSuggestions(query)) {
    const edit = plannedRowToPollEdit(row);
    if (!edit) continue;
    rows.push({
      key: `${row.kind}:${row.category ?? ""}:${rows.length}`,
      icon: pollEditIcon(edit),
      segments: pollEditTitleSegments(edit),
      edit,
    });
  }
  return rows.reverse();
}
