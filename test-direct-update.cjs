#!/usr/bin/env node

/**
 * Direct test: simulate the exact update operation that should happen when editing votes
 */

const { createClient } = require('@supabase/supabase-js');

async function testDirectUpdate() {
  console.log('🧪 Testing Direct Vote Update Operation');
  console.log('====================================');

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
    const voteId = 'd86479c5-6703-4ec8-88dd-f8798e720f71'; // The vote ID from our test

    console.log('\n✅ Step 1: Check current vote state...');

    const { data: beforeVote, error: beforeError } = await supabase
      .from('votes')
      .select('id, nominations, is_abstain, updated_at')
      .eq('id', voteId)
      .single();

    if (beforeError) {
      console.error('❌ Error fetching vote before update:', beforeError);
      return false;
    }

    console.log('   Before update:');
    console.log(`     nominations: ${JSON.stringify(beforeVote.nominations)}`);
    console.log(`     is_abstain: ${beforeVote.is_abstain}`);
    console.log(`     updated_at: ${beforeVote.updated_at}`);

    console.log('\n✅ Step 2: Performing direct update (A → B)...');

    // This simulates exactly what the frontend should do
    const updateData = {
      nominations: ['B'],
      is_abstain: false,
      updated_at: new Date().toISOString()
    };

    console.log('   Update data:', updateData);

    const { error: updateError, data: returnedData } = await supabase
      .from('votes')
      .update(updateData)
      .eq('id', voteId)
      .select();

    if (updateError) {
      console.error('❌ Update failed:', updateError);
      return false;
    }

    console.log('   Update response:', returnedData);

    console.log('\n✅ Step 3: Check vote state after update...');

    const { data: afterVote, error: afterError } = await supabase
      .from('votes')
      .select('id, nominations, is_abstain, updated_at')
      .eq('id', voteId)
      .single();

    if (afterError) {
      console.error('❌ Error fetching vote after update:', afterError);
      return false;
    }

    console.log('   After update:');
    console.log(`     nominations: ${JSON.stringify(afterVote.nominations)}`);
    console.log(`     is_abstain: ${afterVote.is_abstain}`);
    console.log(`     updated_at: ${afterVote.updated_at}`);

    console.log('\n✅ Step 4: Verification...');

    const beforeHasA = beforeVote.nominations && beforeVote.nominations.includes('A');
    const beforeHasB = beforeVote.nominations && beforeVote.nominations.includes('B');
    const afterHasA = afterVote.nominations && afterVote.nominations.includes('A');
    const afterHasB = afterVote.nominations && afterVote.nominations.includes('B');
    const timestampChanged = beforeVote.updated_at !== afterVote.updated_at;

    console.log(`   Before: A=${beforeHasA}, B=${beforeHasB}`);
    console.log(`   After:  A=${afterHasA}, B=${afterHasB}`);
    console.log(`   Timestamp changed: ${timestampChanged}`);

    if (beforeHasA && !beforeHasB && !afterHasA && afterHasB && timestampChanged) {
      console.log('\n🎉 SUCCESS: Vote update worked correctly!');
      console.log('   - Started with A only');
      console.log('   - Ended with B only');
      console.log('   - Timestamp was updated');
      return true;
    } else {
      console.log('\n❌ FAILURE: Vote update did not work as expected');

      if (!timestampChanged) {
        console.log('   - Timestamp was not updated (suggests database constraints or triggers not working)');
      }
      if (afterHasA) {
        console.log('   - Still contains A (update did not replace existing nomination)');
      }
      if (!afterHasB) {
        console.log('   - Does not contain B (update did not set new nomination)');
      }

      return false;
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    return false;
  }
}

// Run the test
testDirectUpdate()
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