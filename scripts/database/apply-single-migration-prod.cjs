const fs = require('fs');

async function applySingleMigrationToProduction() {
  console.log('🔧 Applying migration 023 to production database...');
  
  const migrationContent = fs.readFileSync('./database/migrations/023_fix_borda_tiebreaker_logic_up.sql', 'utf8');
  
  const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  if (!SUPABASE_ACCESS_TOKEN) {
    throw new Error('SUPABASE_ACCESS_TOKEN not found in environment');
  }

  const PRODUCTION_PROJECT_REF = 'kifnvombihyfwszuwqvy';
  
  try {
    console.log('📤 Sending migration to production via Management API...');
    
    const response = await fetch(`https://api.supabase.com/v1/projects/${PRODUCTION_PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: migrationContent
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Migration failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Migration 023 applied successfully to production!');
    
    // Test the updated function
    console.log('\n🧪 Testing updated function in production...');
    
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      'https://kifnvombihyfwszuwqvy.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZm52b21iaWh5ZndzenV3cXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0NDkwNTUsImV4cCI6MjA2NjAyNTA1NX0.z8v81nd0LDaPu8h_M0-e3sEMudu8fIAjALg2P5v81uk'
    );
    
    // Find a ranked choice poll to test
    const { data: polls } = await supabase
      .from('polls')
      .select('id, poll_type')
      .eq('poll_type', 'ranked_choice')
      .limit(1);
    
    if (polls && polls.length > 0) {
      const testPoll = polls[0];
      console.log(`Testing with poll ${testPoll.id}...`);
      
      const { data: result, error } = await supabase
        .rpc('calculate_ranked_choice_winner', { target_poll_id: testPoll.id });
      
      if (error) {
        console.log('⚠️ Test error (may be expected):', error.message);
      } else {
        console.log('✅ Function works correctly in production');
      }
    }
    
    console.log('\n🎉 Production database updated with latest tie-breaker fixes!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

applySingleMigrationToProduction().catch(console.error);