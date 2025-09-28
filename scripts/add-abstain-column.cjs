#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function addAbstainColumn() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Add is_abstain column if it doesn't exist
  const query = `
    ALTER TABLE votes 
    ADD COLUMN IF NOT EXISTS is_abstain BOOLEAN DEFAULT FALSE;
  `;
  
  console.log('Adding is_abstain column to votes table...');
  
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
    console.log('✅ is_abstain column added successfully');
  } else {
    console.error('❌ Error adding column:', result);
  }
}

addAbstainColumn().catch(console.error);
