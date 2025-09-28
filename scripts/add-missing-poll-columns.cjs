#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function addMissingColumns() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Add all potentially missing columns
  const query = `
    -- Add is_private column
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE;
    
    -- Add creator_secret column
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS creator_secret TEXT;
    
    -- Add response_deadline column
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMP WITH TIME ZONE;
    
    -- Add created_at with default
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    
    -- Add is_closed column
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT FALSE;
    
    -- Add fork_of column
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS fork_of UUID REFERENCES polls(id) ON DELETE SET NULL;
    
    -- Add creator_name column
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS creator_name TEXT;
  `;
  
  console.log('Adding missing columns to polls table...');
  
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
    console.log('✅ Missing columns added successfully');
  } else {
    console.error('❌ Error adding columns:', result);
  }
}

addMissingColumns().catch(console.error);
