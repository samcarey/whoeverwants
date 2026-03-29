// Core type definitions for WhoeverWants
// Extracted from lib/supabase.ts during Phase 3 cleanup

export type PollCategory = string;

export type OptionMetadataEntry = {
  imageUrl?: string;
  infoUrl?: string;
  name?: string;
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
  poll_type: 'yes_no' | 'ranked_choice' | 'nomination' | 'participation';
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
  auto_create_preferences?: boolean;
  auto_preferences_deadline_minutes?: number;
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
}

export interface TimeWindow {
  min: string; // HH:MM format
  max: string; // HH:MM format
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

export interface NominationCount {
  option: string;
  count: number;
}

export interface PollResults {
  poll_id: string;
  title: string;
  poll_type: 'yes_no' | 'ranked_choice' | 'nomination' | 'participation';
  created_at: string;
  response_deadline?: string;
  options?: string[];
  yes_count?: number;
  no_count?: number;
  total_votes: number;
  yes_percentage?: number;
  no_percentage?: number;
  winner?: string;
  total_rounds?: number;
  min_participants?: number;
  max_participants?: number;
  participants_in_count?: number;
  is_happening?: boolean;
  nomination_counts?: NominationCount[];
  time_slot_rounds?: TimeSlotResult[];
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
