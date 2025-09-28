#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function fixVoteImmutability() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Create RLS policies to prevent vote updates
  const query = `
    -- Enable RLS on votes table if not already enabled
    ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
    
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS votes_insert_policy ON votes;
    DROP POLICY IF EXISTS votes_select_policy ON votes;
    DROP POLICY IF EXISTS votes_update_policy ON votes;
    DROP POLICY IF EXISTS votes_delete_policy ON votes;
    
    -- Allow anyone to insert votes (creation)
    CREATE POLICY votes_insert_policy ON votes
    FOR INSERT
    TO public
    WITH CHECK (true);
    
    -- Allow anyone to select/read votes
    CREATE POLICY votes_select_policy ON votes
    FOR SELECT
    TO public
    USING (true);
    
    -- Prevent updates to critical fields (vote data)
    -- This policy will block all updates, making votes immutable
    CREATE POLICY votes_update_policy ON votes
    FOR UPDATE
    TO public
    USING (false)  -- Never allow updates
    WITH CHECK (false);
    
    -- Allow deletes for test cleanup
    CREATE POLICY votes_delete_policy ON votes
    FOR DELETE
    TO public
    USING (true);
  `;
  
  console.log('Adding vote immutability via RLS policies...');
  
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
    console.log('✅ Vote immutability policies added');
  } else {
    console.error('❌ Error adding policies:', result);
  }
}

fixVoteImmutability().catch(console.error);
