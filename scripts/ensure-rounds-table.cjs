#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function ensureRoundsTable() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Create ranked_choice_rounds table if it doesn't exist
  const query = `
    CREATE TABLE IF NOT EXISTS ranked_choice_rounds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL,
      option_name TEXT NOT NULL,
      vote_count INTEGER NOT NULL DEFAULT 0,
      is_eliminated BOOLEAN DEFAULT FALSE,
      borda_score INTEGER,
      tie_broken_by_borda BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(poll_id, round_number, option_name)
    );
    
    -- Create index for faster queries
    CREATE INDEX IF NOT EXISTS idx_ranked_choice_rounds_poll_id 
    ON ranked_choice_rounds(poll_id);
    
    CREATE INDEX IF NOT EXISTS idx_ranked_choice_rounds_round 
    ON ranked_choice_rounds(poll_id, round_number);
  `;
  
  console.log('Ensuring ranked_choice_rounds table exists...');
  
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
    console.log('✅ ranked_choice_rounds table ensured');
  } else {
    console.error('❌ Error creating table:', result);
  }
}

ensureRoundsTable().catch(console.error);
