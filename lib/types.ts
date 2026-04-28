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
  // Phase 3.5: the wrapper's follow_up_to (a poll_id) is the source of
  // truth for thread chains. The legacy per-question `follow_up_to` column was
  // dropped in Phase 5.
  poll_follow_up_to?: string | null;
  // Phase 5b: wrapper-level fields (response_deadline, is_closed,
  // close_reason, creator_secret, creator_name, short_id, thread_title,
  // suggestion_deadline) live on the parent Poll. Resolve via
  // questionCache.getPollForQuestion() or accept a Poll prop.
  suggestion_deadline_minutes?: number | null;
  allow_pre_ranking?: boolean;
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
  min_responses?: number | null;
  show_preliminary_results?: boolean;
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
  creator_secret?: string | null;
  creator_name?: string | null;
  response_deadline?: string | null;
  prephase_deadline?: string | null;
  prephase_deadline_minutes?: number | null;
  is_closed: boolean;
  close_reason?: string | null;
  follow_up_to?: string | null;
  thread_title?: string | null;
  context?: string | null;
  details?: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  questions: Question[];
  // Poll-level voter aggregates (Phase 3.2). Use these instead of
  // iterating questions — see CLAUDE.md → "Addressability paradigm".
  voter_names: string[];
  anonymous_count: number;
}
