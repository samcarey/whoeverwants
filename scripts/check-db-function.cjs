#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Use test database
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabase() {
  try {
    console.log('Checking database functions and tables...\n');
    
    // Check if calculate_ranked_choice_winner function exists
    const { data: functions, error: funcError } = await supabase
      .from('pg_proc')
      .select('proname')
      .eq('pronamespace', 2200)  // public schema
      .like('proname', '%ranked_choice%');
    
    if (funcError) {
      console.log('Error checking functions:', funcError);
    } else {
      console.log('Ranked choice functions found:', functions?.length || 0);
      functions?.forEach(f => console.log(`  - ${f.proname}`));
    }
    
    // Check if _migrations table exists
    const { data: migrations, error: migError } = await supabase
      .from('_migrations')
      .select('migration_name')
      .order('applied_at', { ascending: false })
      .limit(10);
    
    if (migError) {
      console.log('\n_migrations table error:', migError.message);
    } else {
      console.log('\nLast 10 applied migrations:');
      migrations?.forEach(m => console.log(`  - ${m.migration_name}`));
    }
    
    // Test the calculate_ranked_choice_winner function directly
    const { data: testResult, error: testError } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: '00000000-0000-0000-0000-000000000000' });
    
    if (testError) {
      console.log('\nFunction test error:', testError.message);
      if (testError.message.includes('does not exist')) {
        console.log('⚠️  The calculate_ranked_choice_winner function is missing!');
      }
    } else {
      console.log('\n✅ Function calculate_ranked_choice_winner exists and can be called');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkDatabase();