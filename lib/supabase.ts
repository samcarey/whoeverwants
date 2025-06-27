import { createClient } from "@supabase/supabase-js";

// Automatically switch between test and production databases
// For client-side apps, we detect production by checking if we're on a production domain
const isProductionDomain = typeof window !== 'undefined' && (
  window.location.hostname.includes('vercel.app') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.hostname.includes('whoeverwants.com') ||
  window.location.hostname === 'whoeverwants.com' ||
  !window.location.hostname.includes('localhost')
);

// In build time, default to test unless explicitly set to production
const isProduction = typeof window !== 'undefined' 
  ? isProductionDomain 
  : process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_USE_PRODUCTION_DB === 'true';

// Try environment-specific variables first, then fall back to standard ones
const supabaseUrl = isProduction 
  ? (process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION || process.env.NEXT_PUBLIC_SUPABASE_URL)
  : (process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || process.env.NEXT_PUBLIC_SUPABASE_URL);

const supabaseAnonKey = isProduction 
  ? (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_PRODUCTION || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    `Missing Supabase environment variables. Please check your environment configuration.`
  );
}

// Log which database we're using (always show in dev environments)
if (typeof window !== 'undefined' && (window.location.hostname.includes('localhost') || window.location.hostname === '127.0.0.1')) {
  console.log(`🔧 Using ${isProduction ? 'PRODUCTION' : 'TEST'} database:`, supabaseUrl);
  console.log(`🔧 Is production domain:`, isProductionDomain);
  console.log(`🔧 Current hostname:`, window.location.hostname);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Poll {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  response_deadline: string | null;
  poll_type: 'yes_no' | 'ranked_choice';
  options: string[] | null;
  is_closed: boolean;
  creator_secret?: string; // Optional for security - only returned on creation
}

export interface Vote {
  id: string;
  poll_id: string;
  vote_type: 'yes_no' | 'ranked_choice';
  yes_no_choice?: 'yes' | 'no';
  ranked_choices?: string[];
  created_at: string;
}

export interface RankedChoiceRound {
  id: string;
  poll_id: string;
  round_number: number;
  option_name: string;
  vote_count: number;
  is_eliminated: boolean;
  created_at: string;
}

export interface PollResults {
  poll_id: string;
  title: string;
  poll_type: 'yes_no' | 'ranked_choice';
  created_at: string;
  response_deadline: string | null;
  options: string[] | null;
  yes_count: number | null;
  no_count: number | null;
  total_votes: number;
  yes_percentage: number | null;
  no_percentage: number | null;
  winner: 'yes' | 'no' | 'tie' | string | null;
  total_rounds: number | null;
}

// Function to get aggregated poll results (no individual votes exposed)
export async function getPollResults(pollId: string): Promise<PollResults | null> {
  try {
    // Get aggregated results from the database view
    const { data, error } = await supabase
      .from('poll_results')
      .select('*')
      .eq('poll_id', pollId)
      .single();

    if (error) {
      console.error('Error fetching poll results:', error);
      return null;
    }

    // If this is a ranked choice poll, calculate the winner separately
    if (data.poll_type === 'ranked_choice') {
      try {
        // Call the ranked choice function to get winner and total rounds
        const { data: rcData, error: rcError } = await supabase
          .rpc('calculate_ranked_choice_winner', { target_poll_id: pollId });

        if (rcError) {
          console.error('Error calculating ranked choice winner:', rcError);
        } else if (rcData && rcData.length > 0) {
          // Update the result with ranked choice data
          data.winner = rcData[0].winner;
          data.total_rounds = rcData[0].total_rounds;
        }
      } catch (rcError) {
        console.error('Unexpected error in ranked choice calculation:', rcError);
      }
    }

    return data;
  } catch (error) {
    console.error('Unexpected error fetching poll results:', error);
    return null;
  }
}

// Function to get ranked choice elimination rounds
export async function getRankedChoiceRounds(pollId: string): Promise<RankedChoiceRound[]> {
  try {
    const { data, error } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', pollId)
      .order('round_number', { ascending: true })
      .order('vote_count', { ascending: false });

    if (error) {
      console.error('Error fetching ranked choice rounds:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Unexpected error fetching ranked choice rounds:', error);
    return [];
  }
}

// Function to manually close a poll (requires creator secret)
export async function closePoll(pollId: string, creatorSecret: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('polls')
      .update({ is_closed: true })
      .eq('id', pollId)
      .eq('creator_secret', creatorSecret)
      .select();

    if (error) {
      console.error('Error closing poll:', error);
      return false;
    }

    if (!data || data.length === 0) {
      console.error('No rows updated when closing poll - invalid poll ID or creator secret');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Unexpected error closing poll:', error);
    return false;
  }
}