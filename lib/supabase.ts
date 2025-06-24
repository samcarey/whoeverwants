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
}

export interface Vote {
  id: string;
  poll_id: string;
  vote_type: 'yes_no' | 'ranked_choice';
  yes_no_choice?: 'yes' | 'no';
  ranked_choices?: string[];
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
  winner: 'yes' | 'no' | 'tie' | null;
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

    return data;
  } catch (error) {
    console.error('Unexpected error fetching poll results:', error);
    return null;
  }
}