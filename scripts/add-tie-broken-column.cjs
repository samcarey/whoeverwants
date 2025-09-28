#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function addColumn() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Add tie_broken_by_borda column
  const query = `
    ALTER TABLE ranked_choice_rounds 
    ADD COLUMN IF NOT EXISTS tie_broken_by_borda BOOLEAN DEFAULT FALSE;
  `;
  
  console.log('Adding tie_broken_by_borda column...');
  
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
    console.log('✅ Column added successfully');
  } else {
    console.error('❌ Error adding column:', result);
  }
}

addColumn().catch(console.error);
