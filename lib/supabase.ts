import { createClient } from '@supabase/supabase-js';

// Determine which environment to use based on NODE_ENV
const isProduction = process.env.NODE_ENV === 'production';

const supabaseUrl = isProduction 
  ? (process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION || '')
  : (process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || '');

const supabaseAnonKey = isProduction
  ? (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_PRODUCTION || '')
  : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST || '');

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder-key'
);

// Type definitions
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
  close_reason?: 'manual' | 'deadline' | 'max_capacity';
  follow_up_to?: string;
  fork_of?: string;
  min_participants?: number;
  max_participants?: number;
}

export interface Vote {
  id: string;
  poll_id: string;
  vote_data: any;
  created_at: string;
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

// Utility functions
export async function getPollResults(pollId: string): Promise<PollResults> {
  const { data, error } = await supabase
    .from('poll_results')
    .select('*')
    .eq('poll_id', pollId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch poll results: ${error.message}`);
  }

  // For nomination polls, manually calculate vote counts since poll_results view doesn't include them
  if (data && data.poll_type === 'nomination') {
    const nominationCounts = await getNominationVoteCounts(pollId);
    return {
      ...data,
      options: nominationCounts
    };
  }

  return data;
}

export async function getNominationVoteCounts(pollId: string): Promise<{ option: string; count: number }[]> {
  const { data: votes, error } = await supabase
    .from('votes')
    .select('nominations')
    .eq('poll_id', pollId)
    .eq('vote_type', 'nomination')
    .eq('is_abstain', false)  // Only count non-abstaining votes
    .not('nominations', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch nomination votes: ${error.message}`);
  }

  // Count occurrences of each nomination
  const nominationCounts: Record<string, number> = {};

  votes.forEach(vote => {
    if (vote.nominations && Array.isArray(vote.nominations)) {
      vote.nominations.forEach((nomination: string) => {
        nominationCounts[nomination] = (nominationCounts[nomination] || 0) + 1;
      });
    }
  });

  // Convert to array format expected by component
  return Object.entries(nominationCounts).map(([option, count]) => ({
    option,
    count
  })).sort((a, b) => b.count - a.count); // Sort by vote count descending
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
  // First get the poll to check if it's ranked choice
  const { data: pollData, error: pollError } = await supabase
    .from('polls')
    .select('poll_type')
    .eq('id', pollId)
    .single();

  if (pollError) {
    throw new Error(`Failed to fetch poll: ${pollError.message}`);
  }

  // Close the poll
  const isDev = process.env.NODE_ENV === 'development';
  let query = supabase
    .from('polls')
    .update({ is_closed: true, updated_at: new Date().toISOString() })
    .eq('id', pollId);
  
  // In production, require creator secret verification
  if (!isDev) {
    query = query.eq('creator_secret', creatorSecret);
  }
  
  const { data, error } = await query.select().single();

  if (error) {
    throw new Error(`Failed to close poll: ${error.message}`);
  }

  // If it's a ranked choice poll, calculate the results
  if (pollData.poll_type === 'ranked_choice') {
    try {
      await supabase.rpc('calculate_ranked_choice_winner', { target_poll_id: pollId });
    } catch (rpcError) {
      console.error('Failed to calculate ranked choice results:', rpcError);
      // Don't fail the close operation if ranked choice calculation fails
    }
  }

  return data;
}

export async function reopenPoll(pollId: string, creatorSecret: string): Promise<Poll> {
  // Reopen the poll
  const isDev = process.env.NODE_ENV === 'development';
  let query = supabase
    .from('polls')
    .update({ is_closed: false, updated_at: new Date().toISOString() })
    .eq('id', pollId);
  
  // In production, require creator secret verification
  if (!isDev) {
    query = query.eq('creator_secret', creatorSecret);
  }
  
  const { data, error } = await query.select().single();

  if (error) {
    throw new Error(`Failed to reopen poll: ${error.message}`);
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


export async function getPollById(id: string): Promise<Poll> {
  const { data, error } = await supabase
    .from('polls')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(`Failed to fetch poll by id: ${error.message}`);
  }

  return data;
}