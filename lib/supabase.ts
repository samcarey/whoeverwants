import { createClient } from "@supabase/supabase-js";

// Automatically switch between test and production databases
const isProduction = process.env.NODE_ENV === 'production';

const supabaseUrl = isProduction 
  ? process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION!
  : process.env.NEXT_PUBLIC_SUPABASE_URL_TEST!;

const supabaseAnonKey = isProduction 
  ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_PRODUCTION!
  : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST!;

if (!supabaseUrl || !supabaseAnonKey) {
  const env = isProduction ? 'production' : 'test';
  throw new Error(
    `Missing Supabase ${env} environment variables. Please check your .env.local file.`
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
}