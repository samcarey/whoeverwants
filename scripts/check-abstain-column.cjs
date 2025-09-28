#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
  try {
    // Check if is_abstain column exists in votes table
    const { data, error } = await supabase
      .from('votes')
      .select('*')
      .limit(0);  // Just check schema, don't fetch data
    
    if (error) {
      console.log('Error checking votes table:', error.message);
      if (error.message.includes('is_abstain')) {
        console.log('❌ is_abstain column does not exist in votes table');
        console.log('Need to add the abstain column migration');
      }
    } else {
      console.log('✅ votes table is accessible');
    }
    
    // Try a simple query to check if is_abstain exists
    const { data: testData, error: testError } = await supabase
      .from('votes')
      .select('id, is_abstain')
      .limit(1);
    
    if (testError) {
      if (testError.message.includes('is_abstain')) {
        console.log('❌ Confirmed: is_abstain column is missing');
      } else {
        console.log('Other error:', testError.message);
      }
    } else {
      console.log('✅ is_abstain column exists');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkColumns();
