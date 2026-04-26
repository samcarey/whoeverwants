// Core type definitions for WhoeverWants
// Extracted from lib/supabase.ts during Phase 3 cleanup

export type PollCategory = string;

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

export interface Poll {
  id: string;
  title: string;
  poll_type: 'yes_no' | 'ranked_choice' | 'participation' | 'time';
  options?: string[];
  response_deadline?: string;
  created_at: string;
  updated_at: string;
  creator_secret?: string;
  creator_name?: string;
  is_closed?: boolean;
  close_reason?: 'manual' | 'deadline' | 'max_capacity' | 'uncontested';
  follow_up_to?: string;
  fork_of?: string;
  min_participants?: number;
  max_participants?: number;
  short_id?: string;
  suggestion_deadline?: string | null;
  suggestion_deadline_minutes?: number | null;
  allow_pre_ranking?: boolean;
  auto_close_after?: number;
  details?: string;
  // Location/time fields for participation polls
  location_mode?: 'set' | 'preferences' | 'suggestions' | null;
  location_value?: string | null;
  location_options?: string[] | null;
  resolved_location?: string | null;
  time_mode?: 'set' | 'preferences' | 'suggestions' | null;
  time_value?: string | null;
  time_options?: string[] | null;
  resolved_time?: string | null;
  is_sub_poll?: boolean;
  sub_poll_role?: string | null;
  parent_participation_poll_id?: string | null;
  location_suggestions_deadline_minutes?: number | null;
  location_preferences_deadline_minutes?: number | null;
  time_suggestions_deadline_minutes?: number | null;
  time_preferences_deadline_minutes?: number | null;
  day_time_windows?: DayTimeWindow[] | null;
  duration_window?: DurationWindow | null;
  category?: PollCategory | null;
  options_metadata?: OptionsMetadata | null;
  reference_latitude?: number | null;
  reference_longitude?: number | null;
  reference_location_label?: string | null;
  is_auto_title?: boolean;
  min_responses?: number | null;
  show_preliminary_results?: boolean;
  response_count?: number | null;
  min_availability_percent?: number | null;
  thread_title?: string | null;
  results?: PollResults | null;
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
  poll_id: string;
  vote_data: any;
  created_at: string;
}

export interface SuggestionCount {
  option: string;
  count: number;
}

export interface PollResults {
  poll_id: string;
  title: string;
  poll_type: 'yes_no' | 'ranked_choice' | 'participation' | 'time';
  created_at: string;
  response_deadline?: string;
  options?: string[];
  yes_count?: number;
  no_count?: number;
  abstain_count?: number;
  total_yes_votes?: number;
  total_votes: number;
  yes_percentage?: number;
  no_percentage?: number;
  winner?: string;
  total_rounds?: number;
  min_participants?: number;
  max_participants?: number;
  participants_in_count?: number;
  is_happening?: boolean;
  suggestion_counts?: SuggestionCount[];
  time_slot_rounds?: TimeSlotResult[];
  participating_vote_ids?: string[];
  participating_voter_names?: string[];
  // Time poll fields
  availability_counts?: Record<string, number>;
  max_availability?: number;
  included_slots?: string[];
  like_counts?: Record<string, number>;
  dislike_counts?: Record<string, number>;
  ranked_choice_rounds?: RankedChoiceRound[];
  ranked_choice_winner?: string;
}

export interface TimeSlotResult {
  round_number: number;
  slot_date: string;
  slot_start_time: string;
  slot_end_time: string;
  duration_hours: number;
  participant_count: number;
  participant_vote_ids: string[];
  participant_names: string[];
  is_winner: boolean;
}

export interface RankedChoiceRound {
  id: string;
  poll_id: string;
  round_number: number;
  option_name: string;
  vote_count: number;
  is_eliminated: boolean;
  created_at: string;
  borda_score?: number;
  tie_broken_by_borda?: boolean;
}

// Multipoll wrapper. Mirrors MultipollResponse in server/models.py.
// See docs/multipoll-phasing.md.
export interface Multipoll {
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
  fork_of?: string | null;
  thread_title?: string | null;
  context?: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  sub_polls: Poll[];
}
