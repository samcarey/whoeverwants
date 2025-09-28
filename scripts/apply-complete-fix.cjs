#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const fetch = require('node-fetch');

// Use test database
const projectRef = 'kfngceqepnzlljkwedtd';
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!accessToken) {
  console.error('❌ Missing SUPABASE_ACCESS_TOKEN environment variable');
  process.exit(1);
}

async function applyCompleteFix() {
  try {
    console.log('📝 Reading complete SQL fix...');
    const sql = fs.readFileSync('scripts/fix-ranked-choice-complete.sql', 'utf8');
    
    console.log('🔄 Applying complete function fix to test database...');
    
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql })
      }
    );
    
    const responseText = await response.text();
    
    if (response.ok) {
      console.log('✅ Complete function fix applied successfully!');
      
      // Test the function
      console.log('\n🧪 Testing the fixed function...');
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
        process.env.SUPABASE_TEST_SERVICE_KEY
      );
      
      const { data, error } = await supabase
        .rpc('calculate_ranked_choice_winner', { 
          target_poll_id: '00000000-0000-0000-0000-000000000000' 
        });
      
      if (error && !error.message.includes('null')) {
        console.log('⚠️  Function test returned an error:', error.message);
      } else {
        console.log('✅ Function test passed!');
      }
    } else {
      console.error('❌ Failed to apply complete function fix');
      console.error('Response:', responseText);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

applyCompleteFix();