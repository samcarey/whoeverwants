import { createClient } from '@supabase/supabase-js';

// Determine which environment to use based on NODE_ENV
const isProduction = process.env.NODE_ENV === 'production';

const supabaseUrl = isProduction 
  ? process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION!
  : process.env.NEXT_PUBLIC_SUPABASE_URL_TEST!;

const supabaseAnonKey = isProduction
  ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_PRODUCTION!
  : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Type definitions
export interface Poll {
  id: string;
  title: string;
  poll_type: 'yes_no' | 'ranked_choice';
  options?: string[];
  response_deadline?: string;
  created_at: string;
  updated_at: string;
  creator_secret?: string;
  is_closed?: boolean;
}

export interface Vote {
  id: string;
  poll_id: string;
  vote_data: any;
  created_at: string;
}

export interface PollResults {
  id: string;
  title: string;
  poll_type: 'yes_no' | 'ranked_choice';
  options?: string[];
  yes_votes?: number;
  no_votes?: number;
  total_votes: number;
  ranked_choice_winner?: string;
  ranked_choice_results?: any[];
  is_closed?: boolean;
  response_deadline?: string;
}

export interface RankedChoiceRound {
  round_number: number;
  eliminated_candidate?: string;
  vote_counts: Record<string, number>;
  total_votes: number;
}

// Utility functions
export async function getPollResults(pollId: string): Promise<PollResults> {
  const { data, error } = await supabase
    .from('poll_results')
    .select('*')
    .eq('id', pollId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch poll results: ${error.message}`);
  }

  return data;
}

export async function getRankedChoiceRounds(pollId: string): Promise<RankedChoiceRound[]> {
  const { data, error } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', pollId)
    .order('round_number');

  if (error) {
    throw new Error(`Failed to fetch ranked choice rounds: ${error.message}`);
  }

  return data || [];
}

export async function closePoll(pollId: string, creatorSecret: string): Promise<Poll> {
  const { data, error } = await supabase
    .from('polls')
    .update({ is_closed: true, updated_at: new Date().toISOString() })
    .eq('id', pollId)
    .eq('creator_secret', creatorSecret)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to close poll: ${error.message}`);
  }

  return data;
}

export async function submitVote(pollId: string, voteData: any): Promise<void> {
  const { error } = await supabase
    .from('votes')
    .insert({
      poll_id: pollId,
      vote_data: voteData
    });

  if (error) {
    throw new Error(`Failed to submit vote: ${error.message}`);
  }
}

export async function createPoll(poll: Omit<Poll, 'id' | 'created_at' | 'updated_at'>): Promise<Poll> {
  const { data, error } = await supabase
    .from('polls')
    .insert({
      ...poll,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create poll: ${error.message}`);
  }

  return data;
}