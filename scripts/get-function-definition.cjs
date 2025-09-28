#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function getFunctionDef() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // Get the function definition
  const query = `
    SELECT pg_get_functiondef(oid) as definition
    FROM pg_proc
    WHERE proname = 'calculate_ranked_choice_winner'
    LIMIT 1;
  `;
  
  console.log('Getting function definition...');
  
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  
  const result = await response.json();
  
  if (response.ok && result.result && result.result.length > 0) {
    const def = result.result[0].definition;
    // Look for lines with 'c' reference
    const lines = def.split('\n');
    lines.forEach((line, i) => {
      if (line.includes(' c ') || line.includes(',c,') || line.includes('(c)') || line.includes(' c.') || line.includes(',c ')) {
        console.log(`Line ${i+1}: ${line}`);
      }
    });
  } else {
    console.error('Error or no function found:', result);
  }
}

getFunctionDef().catch(console.error);
