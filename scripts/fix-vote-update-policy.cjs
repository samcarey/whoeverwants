#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function fixVoteUpdatePolicy() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Fix the RLS policies to actually prevent updates
  const query = `
    -- First ensure RLS is enabled
    ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
    
    -- Drop all existing policies
    DROP POLICY IF EXISTS votes_insert_policy ON votes;
    DROP POLICY IF EXISTS votes_select_policy ON votes;
    DROP POLICY IF EXISTS votes_update_policy ON votes;
    DROP POLICY IF EXISTS votes_delete_policy ON votes;
    
    -- Recreate policies with proper restrictions
    
    -- Allow inserts
    CREATE POLICY votes_insert_policy ON votes
    FOR INSERT
    WITH CHECK (true);
    
    -- Allow selects
    CREATE POLICY votes_select_policy ON votes
    FOR SELECT
    USING (true);
    
    -- Block ALL updates (no USING or WITH CHECK clauses that return true)
    CREATE POLICY votes_update_policy ON votes
    FOR UPDATE
    USING (false);
    
    -- Allow deletes for cleanup
    CREATE POLICY votes_delete_policy ON votes
    FOR DELETE
    USING (true);
  `;
  
  console.log('Fixing vote update policy...');
  
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  
  const result = await response.json();
  
  if (response.ok) {
    console.log('✅ Vote update policy fixed');
  } else {
    console.error('❌ Error fixing policy:', result);
  }
}

fixVoteUpdatePolicy().catch(console.error);
