#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function addShortId() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Add short_id column if it doesn't exist
  const query = `
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS short_id TEXT UNIQUE;
    
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS sequential_id INTEGER;
  `;
  
  console.log('Adding short_id and sequential_id columns to polls table...');
  
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
    console.log('✅ Columns added successfully');
  } else {
    console.error('❌ Error adding columns:', result);
  }
}

addShortId().catch(console.error);
