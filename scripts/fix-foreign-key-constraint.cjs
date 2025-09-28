#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');

async function fixConstraint() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!supabaseUrl || !accessToken) {
    console.error('Missing required environment variables');
    process.exit(1);
  }
  
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  // First add the follow_up_to column if it doesn't exist, then fix the constraint
  const query = `
    -- Add follow_up_to column if it doesn't exist
    ALTER TABLE polls 
    ADD COLUMN IF NOT EXISTS follow_up_to UUID REFERENCES polls(id) ON DELETE SET NULL;
    
    -- Drop existing constraint if it exists
    ALTER TABLE polls 
    DROP CONSTRAINT IF EXISTS polls_follow_up_to_fkey;
    
    -- Add the constraint with ON DELETE SET NULL to prevent deletion issues
    ALTER TABLE polls 
    ADD CONSTRAINT polls_follow_up_to_fkey 
    FOREIGN KEY (follow_up_to) 
    REFERENCES polls(id) 
    ON DELETE SET NULL;
  `;
  
  console.log('Fixing follow_up_to constraint...');
  
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
    console.log('✅ Constraint fixed successfully');
  } else {
    console.error('❌ Error fixing constraint:', result);
  }
}

fixConstraint().catch(console.error);
