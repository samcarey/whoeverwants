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
  question_type: 'yes_no' | 'ranked_choice' | 'time';
  options?: string[];
  created_at: string;
  updated_at: string;
  // Phase 5b: wrapper-level fields (response_deadline, is_closed,
  // close_reason, creator_secret, creator_name, short_id, group_title,
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
  options_metadata?: OptionsMetadata | null;
  reference_latitude?: number | null;
  reference_longitude?: number | null;
  reference_location_label?: string | null;
  is_auto_title?: boolean;
  response_count?: number | null;
  min_availability_percent?: number | null;
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

export interface QuestionResults {
  question_id: string;
  title: string;
  question_type: 'yes_no' | 'ranked_choice' | 'time';
  created_at: string;
  response_deadline?: string;
  options?: string[];
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
  ranked_choice_rounds?: RankedChoiceRound[];
  ranked_choice_winner?: string;
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
  creator_secret?: string | null;
  creator_name?: string | null;
  response_deadline?: string | null;
  prephase_deadline?: string | null;
  prephase_deadline_minutes?: number | null;
  is_closed: boolean;
  close_reason?: string | null;
  // Migration 105: group name override. Surfaced from `groups.title`
  // (single source of truth, one row per group). Every poll in the same
  // group receives the same value.
  group_title?: string | null;
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
}
