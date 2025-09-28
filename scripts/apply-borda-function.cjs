#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');

async function applyBordaFunction() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Read the SQL file
  const sql = fs.readFileSync('./scripts/create-borda-count-function.sql', 'utf8');
  
  console.log('Applying Borda count function...');
  
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  
  const result = await response.json();
  
  if (response.ok) {
    console.log('✅ Borda count function created successfully');
  } else {
    console.error('❌ Error creating function:', result);
  }
}

applyBordaFunction().catch(console.error);
