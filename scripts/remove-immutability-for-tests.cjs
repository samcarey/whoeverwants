#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function removeImmutability() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Remove the trigger that prevents updates
  const query = `
    -- Drop the trigger that prevents updates
    DROP TRIGGER IF EXISTS enforce_vote_immutability ON votes;
    
    -- Drop the function
    DROP FUNCTION IF EXISTS prevent_vote_update();
  `;
  
  console.log('Removing vote immutability constraint for testing...');
  
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
    console.log('✅ Vote immutability constraint removed');
  } else {
    console.error('❌ Error removing constraint:', result);
  }
}

removeImmutability().catch(console.error);
