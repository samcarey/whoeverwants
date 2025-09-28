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
    -- Add nominations column
    ALTER TABLE votes 
    ADD COLUMN IF NOT EXISTS nominations TEXT[];
    
    -- Add yes_no_choice column
    ALTER TABLE votes 
    ADD COLUMN IF NOT EXISTS yes_no_choice TEXT;
    
    -- Add created_at with default
    ALTER TABLE votes 
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    
    -- Add voter_name column
    ALTER TABLE votes 
    ADD COLUMN IF NOT EXISTS voter_name TEXT;
    
    -- Add abstain-related columns
    ALTER TABLE votes 
    ADD COLUMN IF NOT EXISTS abstain_reason TEXT;
  `;
  
  console.log('Adding missing columns to votes table...');
  
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
