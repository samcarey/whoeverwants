import { createClient } from "@supabase/supabase-js";

// Automatically switch between test and production databases
const isProduction = process.env.NODE_ENV === 'production';

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

// Log which database we're using (only in development)
if (!isProduction) {
  console.log(`🔧 Using ${isProduction ? 'PRODUCTION' : 'TEST'} database:`, supabaseUrl);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Poll {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  response_deadline: string | null;
}