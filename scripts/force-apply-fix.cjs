#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');

async function forceApplyFix() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // First completely drop the function
  console.log('1. Dropping existing function...');
  const dropQuery = 'DROP FUNCTION IF EXISTS calculate_ranked_choice_winner(UUID) CASCADE;';
  
  const dropResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: dropQuery })
  });
  
  if (!dropResponse.ok) {
    const dropResult = await dropResponse.json();
    console.error('Error dropping function:', dropResult);
  } else {
    console.log('✅ Function dropped');
  }
  
  // Read the fix SQL
  const fixSql = fs.readFileSync('./scripts/fix-ranked-choice-complete.sql', 'utf8');
  
  // Apply the fix
  console.log('2. Applying fixed function...');
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: fixSql })
  });
  
  const result = await response.json();
  
  if (response.ok) {
    console.log('✅ Function recreated successfully');
  } else {
    console.error('❌ Error applying function:', result);
  }
}

forceApplyFix().catch(console.error);
