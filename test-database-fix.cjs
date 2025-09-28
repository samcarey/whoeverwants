#!/usr/bin/env node

/**
 * Direct database test to verify the is_abstain filter is working
 */

const { createClient } = require('@supabase/supabase-js');

async function testDatabaseFix() {
  console.log('🧪 Testing Database Fix for Nomination Editing');
  console.log('============================================');

  // Use test environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || '';
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const pollId = '4dfa4706-8de2-40a5-ac51-3ce351c2a0fb';

    console.log('\n✅ Step 1: Checking ALL vote records for this poll...');

    // Query ALL votes to see what's actually in the database
    const { data: allVotes, error: allError } = await supabase
      .from('votes')
      .select('id, nominations, is_abstain, voter_name, created_at, updated_at')
      .eq('poll_id', pollId)
      .order('updated_at', { ascending: false });

    if (allError) {
      console.error('❌ Error querying all votes:', allError);
      return false;
    }

    console.log(`   Found ${allVotes.length} total vote records:`);
    allVotes.forEach((vote, index) => {
      console.log(`     ${index + 1}. Vote ${vote.id}:`);
      console.log(`        nominations: ${JSON.stringify(vote.nominations)}`);
      console.log(`        is_abstain: ${vote.is_abstain}`);
      console.log(`        voter_name: ${vote.voter_name}`);
      console.log(`        created_at: ${vote.created_at}`);
      console.log(`        updated_at: ${vote.updated_at}`);
      console.log('');
    });

    console.log('\n✅ Step 2: Testing query WITH is_abstain filter (the fix)...');

    // Query with the filter (this should be the fix)
    const { data: activeVotes, error: activeError } = await supabase
      .from('votes')
      .select('id, nominations, is_abstain, updated_at')
      .eq('poll_id', pollId)
      .eq('vote_type', 'nomination')
      .eq('is_abstain', false)  // The fix
      .not('nominations', 'is', null)
      .order('updated_at', { ascending: false });

    if (activeError) {
      console.error('❌ Error querying active votes:', activeError);
      return false;
    }

    console.log('   Active votes only (excluding abstaining):');
    activeVotes.forEach(vote => {
      console.log(`     Vote ${vote.id}: nominations=${JSON.stringify(vote.nominations)}, is_abstain=${vote.is_abstain}, updated=${vote.updated_at}`);
    });

    console.log('\n✅ Step 3: Analyzing nomination counts...');

    // Count nominations from all votes (broken way)
    const allNominationCounts = {};
    allVotes.forEach(vote => {
      if (vote.nominations && Array.isArray(vote.nominations)) {
        vote.nominations.forEach(nom => {
          allNominationCounts[nom] = (allNominationCounts[nom] || 0) + 1;
        });
      }
    });

    // Count nominations from active votes only (fixed way)
    const activeNominationCounts = {};
    activeVotes.forEach(vote => {
      if (vote.nominations && Array.isArray(vote.nominations)) {
        vote.nominations.forEach(nom => {
          activeNominationCounts[nom] = (activeNominationCounts[nom] || 0) + 1;
        });
      }
    });

    console.log('   Broken way (all votes including abstaining):');
    Object.entries(allNominationCounts).forEach(([nom, count]) => {
      console.log(`     "${nom}": ${count} votes`);
    });

    console.log('   Fixed way (active votes only):');
    Object.entries(activeNominationCounts).forEach(([nom, count]) => {
      console.log(`     "${nom}": ${count} votes`);
    });

    console.log('\n✅ Step 4: Verification...');

    const hasA_all = 'A' in allNominationCounts;
    const hasB_all = 'B' in allNominationCounts;
    const hasA_active = 'A' in activeNominationCounts;
    const hasB_active = 'B' in activeNominationCounts;

    console.log(`   Broken way shows A: ${hasA_all}, shows B: ${hasB_all}`);
    console.log(`   Fixed way shows A: ${hasA_active}, shows B: ${hasB_active}`);

    if (hasA_all && hasB_all) {
      console.log('\n✅ CONFIRMED: Broken query shows both A and B (the bug)');
    }

    if (!hasA_active && hasB_active) {
      console.log('\n🎉 SUCCESS: Fixed query shows only B (correct behavior)');
      return true;
    } else if (hasA_active && !hasB_active) {
      console.log('\n❌ ISSUE: Fixed query still shows A instead of B');
      return false;
    } else if (hasA_active && hasB_active) {
      console.log('\n❌ ISSUE: Fixed query still shows both A and B');
      return false;
    } else {
      console.log('\n⚠️ UNEXPECTED: Fixed query shows neither A nor B');
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    return false;
  }
}

// Run the test
testDatabaseFix()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Test Result:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });