#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function fixCleanupOrder() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Add CASCADE delete to votes foreign key so deleting a poll deletes its votes
  const query = `
    -- Drop existing constraint
    ALTER TABLE votes 
    DROP CONSTRAINT IF EXISTS votes_poll_id_fkey;
    
    -- Re-add with CASCADE delete
    ALTER TABLE votes 
    ADD CONSTRAINT votes_poll_id_fkey 
    FOREIGN KEY (poll_id) 
    REFERENCES polls(id) 
    ON DELETE CASCADE;
    
    -- Also fix ranked_choice_rounds if it exists
    ALTER TABLE ranked_choice_rounds 
    DROP CONSTRAINT IF EXISTS ranked_choice_rounds_poll_id_fkey;
    
    ALTER TABLE ranked_choice_rounds 
    ADD CONSTRAINT ranked_choice_rounds_poll_id_fkey 
    FOREIGN KEY (poll_id) 
    REFERENCES polls(id) 
    ON DELETE CASCADE;
  `;
  
  console.log('Fixing foreign key constraints to use CASCADE delete...');
  
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
    console.log('✅ Foreign key constraints fixed with CASCADE delete');
  } else {
    console.error('❌ Error fixing constraints:', result);
  }
}

fixCleanupOrder().catch(console.error);
