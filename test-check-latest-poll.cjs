#!/usr/bin/env node

/**
 * Check database state for the latest test poll to see if editing worked
 */

const { createClient } = require('@supabase/supabase-js');

async function checkLatestPoll() {
  console.log('🔍 Checking Latest Test Poll After Edit');
  console.log('======================================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || '';
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Get the latest poll ID from the test (from the URL: 9358d740-5c0b-4db8-96e8-c37f9f14800b)
    const latestPollId = '9358d740-5c0b-4db8-96e8-c37f9f14800b';

    console.log(`✅ Checking latest poll: ${latestPollId}`);

    // Get all votes for this poll
    const { data: votes, error: votesError } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', latestPollId)
      .order('created_at', { ascending: false });

    if (votesError) {
      console.error('❌ Error fetching votes:', votesError);
      return false;
    }

    console.log(`\n📊 Total votes for this poll: ${votes.length}`);

    if (votes.length === 0) {
      console.log('❌ No votes found - the test voting may have failed');
      return false;
    }

    console.log('\n📋 All votes:');
    votes.forEach((vote, i) => {
      console.log(`   Vote ${i + 1}:`);
      console.log(`     ID: ${vote.id}`);
      console.log(`     Nominations: ${JSON.stringify(vote.nominations)}`);
      console.log(`     Is Abstain: ${vote.is_abstain}`);
      console.log(`     Voter: ${vote.voter_name || 'Anonymous'}`);
      console.log(`     Created: ${vote.created_at}`);
      console.log(`     Updated: ${vote.updated_at}`);
      console.log('');
    });

    // Analysis
    if (votes.length === 1) {
      const singleVote = votes[0];
      console.log('✅ GOOD: Only one vote found (no duplicates created)');

      const hasA = singleVote.nominations && singleVote.nominations.includes('A');
      const hasB = singleVote.nominations && singleVote.nominations.includes('B');
      const wasUpdated = singleVote.created_at !== singleVote.updated_at;

      console.log(`   Vote contains A: ${hasA}`);
      console.log(`   Vote contains B: ${hasB}`);
      console.log(`   Vote was updated: ${wasUpdated}`);

      if (!hasA && hasB && wasUpdated) {
        console.log('\n🎉 PERFECT: Vote was correctly updated from A to B');
        console.log('   Database edit functionality is working correctly');
        console.log('   The issue must be in the frontend display logic');
        return true;
      } else if (hasA && hasB) {
        console.log('\n❌ PROBLEM: Vote contains both A and B');
        console.log('   This should not happen - vote should only contain B after edit');
        return false;
      } else if (hasA && !hasB) {
        console.log('\n❌ PROBLEM: Vote still contains only A');
        console.log('   The edit did not update the vote correctly');
        return false;
      } else {
        console.log('\n❓ UNEXPECTED: Vote has unusual nomination state');
        return false;
      }
    } else if (votes.length === 2) {
      console.log('❌ PROBLEM: Two votes found (duplicate creation)');
      console.log('   The userVoteId fix did not work correctly');

      const firstVote = votes[0]; // Most recent
      const secondVote = votes[1]; // Earlier

      console.log('\n📊 Vote comparison:');
      console.log(`   Earlier vote: ${JSON.stringify(secondVote.nominations)} (${secondVote.created_at})`);
      console.log(`   Later vote:   ${JSON.stringify(firstVote.nominations)} (${firstVote.created_at})`);

      return false;
    } else {
      console.log(`❌ PROBLEM: ${votes.length} votes found (unexpected number)`);
      return false;
    }

  } catch (error) {
    console.error('\n❌ Check failed with error:', error.message);
    return false;
  }
}

// Run the check
checkLatestPoll()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Check Result:', success ? '✅ DATABASE EDIT WORKS' : '❌ DATABASE EDIT FAILS');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });