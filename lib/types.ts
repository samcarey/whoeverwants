// Core type definitions for WhoeverWants
// Extracted from lib/supabase.ts during Phase 3 cleanup

export type QuestionCategory = string;

export type OptionMetadataEntry = {
  imageUrl?: string;
  infoUrl?: string;
  name?: string;
  address?: string;
  distance_miles?: number;
  lat?: string;
  lon?: string;
  rating?: number;
  reviewCount?: number;
  cuisine?: string;
  priceLevel?: string;
};

export type OptionsMetadata = Record<string, OptionMetadataEntry>;

export interface Question {
  id: string;
  title: string;
  question_type: 'yes_no' | 'ranked_choice' | 'time' | 'limited_supply';
  options?: string[];
  created_at: string;
  updated_at: string;
  // Phase 5b: wrapper-level fields (response_deadline, is_closed,
  // close_reason, creator_name, short_id, group_title,
  // suggestion_deadline) live on the parent Poll. Resolve via
  // questionCache.getPollForQuestion() or accept a Poll prop. Migration
  // 105 retired `polls.follow_up_to` (and the FE-only mirror
  // `poll_follow_up_to` along with it); groups are flat lists of polls
  // under one `Poll.group_id`.
  suggestion_deadline_minutes?: number | null;
  auto_close_after?: number;
  details?: string;
  day_time_windows?: DayTimeWindow[] | null;
  duration_window?: DurationWindow | null;
  category?: QuestionCategory | null;
  /** Emoji chosen for a custom category; null/undefined for built-in
   *  categories or when none was picked. Preferred over the category/type
   *  fallback by getCategoryIcon(). */
  category_icon?: string | null;
  options_metadata?: OptionsMetadata | null;
  reference_latitude?: number | null;
  reference_longitude?: number | null;
  reference_location_label?: string | null;
  is_auto_title?: boolean;
  response_count?: number | null;
  min_availability_percent?: number | null;
  // "Minimum Participants" viability gate for time questions (default 2). The
  // finalized "event's off" state is surfaced on QuestionResults, not here.
  time_min_participants?: number | null;
  // Number of available slots for a limited_supply question. Null otherwise.
  supply_count?: number | null;
  // limited_supply: when false, only the creator sees claimant names.
  reveal_claimant_names?: boolean | null;
  // Phase 2.5: poll wrapper this question belongs to. Phase 4 backfilled
  // every existing question, so this is effectively NOT NULL on every row.
  poll_id?: string | null;
  question_index?: number | null;
  results?: QuestionResults | null;
  voter_names?: string[] | null;
}

export interface TimeWindow {
  min: string; // HH:MM format
  max: string; // HH:MM format
  enabled?: boolean; // For voter form: whether this window is active (default true)
}

export interface DayTimeWindow {
  day: string; // YYYY-MM-DD format
  windows: TimeWindow[];
}

export interface DurationWindow {
  minValue: number | null;
  maxValue: number | null;
  minEnabled: boolean;
  maxEnabled: boolean;
}

export interface Vote {
  id: string;
  question_id: string;
  vote_data: any;
  created_at: string;
}

export interface SuggestionCount {
  option: string;
  count: number;
}

export interface SupplyClaim {
  name?: string | null;
  secured: boolean;
  position: number;
  created_at: string;
}

export interface QuestionResults {
  question_id: string;
  title: string;
  question_type: 'yes_no' | 'ranked_choice' | 'time' | 'limited_supply';
  created_at: string;
  response_deadline?: string;
  options?: string[];
  // True iff `options` is the pre-cutoff tentative list emitted by the server for
  // time questions with `allow_pre_ranking` enabled. The slot list will shift as
  // more voters submit availability; final slots land at the availability cutoff.
  options_are_tentative?: boolean;
  yes_count?: number;
  no_count?: number;
  abstain_count?: number;
  total_votes: number;
  yes_percentage?: number;
  no_percentage?: number;
  winner?: string;
  total_rounds?: number;
  suggestion_counts?: SuggestionCount[];
  // Time question fields
  availability_counts?: Record<string, number>;
  max_availability?: number;
  included_slots?: string[];
  like_counts?: Record<string, number>;
  dislike_counts?: Record<string, number>;
  // True when the availability cutoff passed but no slot met the
  // "Minimum Participants" gate → the event is off (no time works).
  time_event_cancelled?: boolean;
  ranked_choice_rounds?: RankedChoiceRound[];
  ranked_choice_winner?: string;
  // Limited-supply fields. supply_count = number of slots; claims = the
  // ordered first-come signup roster (secured first). All undefined for
  // non-limited_supply questions.
  supply_count?: number;
  secured_count?: number;
  waitlist_count?: number;
  claims?: SupplyClaim[];
  // True when claimant names were stripped for this viewer (reveal toggle off
  // + viewer isn't the creator) — the FE renders an anonymized roster.
  names_hidden?: boolean;
  // {option_name: borda_score} across all non-abstain ballots. Used by the
  // result gloss (lib/rankedChoiceGloss.ts) to spot a broadly-acceptable
  // option that IRV eliminated early.
  borda_scores?: Record<string, number>;
}

export interface RankedChoiceRound {
  id: string;
  question_id: string;
  round_number: number;
  option_name: string;
  vote_count: number;
  is_eliminated: boolean;
  created_at: string;
  borda_score?: number;
  tie_broken_by_borda?: boolean;
}

/** Minimal group metadata for a group that may not have polls yet.
 *  Mirrors GroupSummary in server/routers/groups.py — returned by
 *  POST /api/groups (empty-group create), POST /api/groups/empty
 *  (membership-only groups for the home list), and
 *  GET /api/groups/by-route-id/{id}/summary (fallback for the group
 *  page when no polls are visible). */
export interface GroupSummary {
  id: string;
  short_id?: string | null;
  title?: string | null;
  created_at: string;
  // Migration 108: ISO timestamp of when the group's avatar image was
  // last set. Null when no custom image is set. Doubles as the cache-
  // buster query param on `/api/groups/by-route-id/<id>/image`.
  image_updated_at?: string | null;
  // Migration 114 (Phase E): group-level privacy state.
  // 'public' (default for anonymous-created groups; grandfathered for
  // pre-Phase-E rows) or 'private' (signed-in-created groups by default).
  // creator_user_id is the user_id that created the group while signed
  // in — null for anonymous-created groups (which are always public).
  privacy?: string | null;
  creator_user_id?: string | null;
}

// Poll wrapper. Mirrors PollResponse in server/models.py.
// See docs/poll-phasing.md.
export interface Poll {
  id: string;
  short_id?: string | null;
  // Phase B.4 + Migration 105: every poll carries its group's id +
  // short_id. The FE builds /g/<group.short_id>?p=<poll.short_id> URLs
  // straight from these fields — no chain walks. Both are nullable for
  // resilience: synthesized placeholder polls don't have them yet, and
  // pre-Phase-B.4 cached polls (in-memory across a deploy) won't either.
  group_id?: string | null;
  group_short_id?: string | null;
  creator_name?: string | null;
  // Migration 122/123: the creator's user_id. Every poll has one now — a
  // signed-in creator's account, or the lightweight account auto-minted for
  // an anonymous creator at create time. Null only on pre-122 cached polls.
  creator_user_id?: string | null;
  // Per-viewer flag computed server-side: true when the caller is this
  // poll's creator (their resolved user_id — bearer session OR the account
  // linked to their browser_id — matches creator_user_id). The FE gates the
  // close/reopen/cutoff controls on this; it can't compare creator_user_id
  // locally because an anonymous-with-account viewer doesn't know its own
  // user_id. Absent on synthesized placeholder / pre-this-change cached polls.
  viewer_is_creator?: boolean;
  response_deadline?: string | null;
  prephase_deadline?: string | null;
  prephase_deadline_minutes?: number | null;
  is_closed: boolean;
  close_reason?: string | null;
  // Migration 105: group name override. Surfaced from `groups.title`
  // (single source of truth, one row per group). Every poll in the same
  // group receives the same value.
  group_title?: string | null;
  // Migration 108: ISO timestamp of when the group's avatar image was
  // last set/cleared. Null when no custom image is set. Every poll in
  // the same group carries the same value (sourced from groups.image_updated_at
  // via JOIN). Doubles as the cache-buster query param on the image URL.
  group_image_updated_at?: string | null;
  // Migration 114 (Phase E): group-level privacy state surfaced per poll
  // so the FE can render the privacy badge + creator-only toggle without
  // a second fetch. Every poll in the same group carries the same value.
  // 'public' or 'private'; null on synthesized placeholder polls + pre-
  // Phase-E cached polls that predate the field.
  group_privacy?: string | null;
  group_creator_user_id?: string | null;
  context?: string | null;
  details?: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  // Migration 098: poll-level results-display + ranked-choice settings.
  min_responses?: number | null;
  show_preliminary_results?: boolean;
  allow_pre_ranking?: boolean;
  questions: Question[];
  // Poll-level voter aggregates (Phase 3.2). Use these instead of
  // iterating questions — see CLAUDE.md → "Addressability paradigm".
  voter_names: string[];
  anonymous_count: number;
  // Parallel name→count map: how many DISTINCT people voted under each name.
  // Drives the "×2" multiplier when genuinely different voters share a name.
  // Names absent from the map (or count ≤ 1) render with no multiplier.
  // Optional for pre-feature cached polls. See CLAUDE.md → VoterList note.
  voter_name_counts?: Record<string, number>;
  // "Viewed (N)" roster: browsers that opened the poll (>5 min ago) but never
  // voted/abstained. Optional for pre-feature cached polls. See CLAUDE.md
  // 'App-Icon Badge Model + Viewed Tracking'.
  viewed_ignored_count?: number;
  // Turnout denominator: distinct viewers who opened the poll (account-collapsed
  // so two devices of one signed-in viewer count once). Drives the "M of V seen"
  // turnout line on the group card. Optional for pre-feature cached polls.
  viewed_total?: number;
  // Distinct non-empty suggestions voters proposed across the poll's
  // ranked_choice suggestion phase(s). 0 for polls with no suggestion phase.
  // Drives the "N suggestions" segment of the group-card info line.
  suggestion_count?: number;
}
