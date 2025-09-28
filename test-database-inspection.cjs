#!/usr/bin/env node

/**
 * Direct database inspection to see what's in the votes table after the playwright test
 */

const { createClient } = require('@supabase/supabase-js');

async function inspectDatabase() {
  console.log('🔍 Database Inspection After Test');
  console.log('=================================');

  // Use test environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || '';
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('\n✅ Step 1: Get all recent nomination votes...');

    // Get all recent nomination votes from the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: allVotes, error: allError } = await supabase
      .from('votes')
      .select('*')
      .eq('vote_type', 'nomination')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false });

    if (allError) {
      console.error('❌ Error fetching votes:', allError);
      return false;
    }

    console.log(`   Found ${allVotes.length} recent nomination votes:`);
    allVotes.forEach((vote, index) => {
      console.log(`   Vote ${index + 1}:`);
      console.log(`     ID: ${vote.id}`);
      console.log(`     Poll: ${vote.poll_id}`);
      console.log(`     Nominations: ${JSON.stringify(vote.nominations)}`);
      console.log(`     Is Abstain: ${vote.is_abstain}`);
      console.log(`     Created: ${vote.created_at}`);
      console.log(`     Updated: ${vote.updated_at}`);
      console.log(`     Voter: ${vote.voter_name || 'Anonymous'}`);
      console.log('');
    });

    console.log('\n✅ Step 2: Group votes by poll ID...');

    const votesByPoll = {};
    allVotes.forEach(vote => {
      if (!votesByPoll[vote.poll_id]) {
        votesByPoll[vote.poll_id] = [];
      }
      votesByPoll[vote.poll_id].push(vote);
    });

    Object.keys(votesByPoll).forEach(pollId => {
      const pollVotes = votesByPoll[pollId];
      console.log(`   Poll ${pollId}:`);
      console.log(`     Total votes: ${pollVotes.length}`);

      // Check for multiple votes (indicating potential issue)
      if (pollVotes.length > 1) {
        console.log(`     ⚠️  WARNING: Multiple votes found for this poll`);
        pollVotes.forEach((vote, index) => {
          console.log(`       Vote ${index + 1}: ${JSON.stringify(vote.nominations)} (${vote.created_at})`);
        });
      } else {
        console.log(`     Single vote: ${JSON.stringify(pollVotes[0].nominations)}`);
      }
    });

    console.log('\n✅ Step 3: Check for any duplicate or conflicting votes...');

    let foundIssues = false;
    Object.keys(votesByPoll).forEach(pollId => {
      const pollVotes = votesByPoll[pollId];

      if (pollVotes.length > 1) {
        console.log(`   ⚠️  Poll ${pollId} has ${pollVotes.length} votes - this could cause display issues`);
        foundIssues = true;

        // Check if votes have different nominations
        const nominations = pollVotes.map(v => JSON.stringify(v.nominations));
        const uniqueNominations = [...new Set(nominations)];

        if (uniqueNominations.length > 1) {
          console.log(`     📍 Different nominations found: ${uniqueNominations.join(' vs ')}`);
          console.log(`     📍 This explains why frontend shows multiple values!`);
        }

        // Check if all votes have same voter (indicating edit attempts)
        const voters = pollVotes.map(v => v.voter_name || 'Anonymous');
        const uniqueVoters = [...new Set(voters)];

        if (uniqueVoters.length === 1) {
          console.log(`     📍 All votes from same voter: ${uniqueVoters[0]}`);
          console.log(`     📍 This suggests vote editing is creating new records instead of updating`);
        }
      }
    });

    if (!foundIssues) {
      console.log('   ✅ No duplicate votes found - each poll has exactly one vote');
    }

    console.log('\n✅ Step 4: Test nomination counting query...');

    // Test the same query logic that the frontend uses
    if (Object.keys(votesByPoll).length > 0) {
      const testPollId = Object.keys(votesByPoll)[0];
      console.log(`   Testing count query for poll: ${testPollId}`);

      const { data: countVotes, error: countError } = await supabase
        .from('votes')
        .select('nominations')
        .eq('poll_id', testPollId)
        .eq('vote_type', 'nomination')
        .eq('is_abstain', false)
        .not('nominations', 'is', null);

      if (countError) {
        console.error('❌ Error in count query:', countError);
      } else {
        console.log(`   Query returned ${countVotes.length} votes for counting:`);

        // Count nominations like the frontend does
        const nominationCounts = {};
        countVotes.forEach(vote => {
          if (vote.nominations && Array.isArray(vote.nominations)) {
            vote.nominations.forEach(nomination => {
              nominationCounts[nomination] = (nominationCounts[nomination] || 0) + 1;
            });
          }
        });

        console.log('   Aggregated nomination counts:');
        Object.entries(nominationCounts).forEach(([nom, count]) => {
          console.log(`     "${nom}": ${count} vote(s)`);
        });

        if (Object.keys(nominationCounts).length > 1) {
          console.log('   📍 ISSUE FOUND: Multiple nominations being counted!');
          console.log('   📍 This explains the frontend bug - it shows all nominations with counts');
        }
      }
    }

    return true;

  } catch (error) {
    console.error('\n❌ Inspection failed with error:', error.message);
    return false;
  }
}

// Run the inspection
inspectDatabase()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Inspection Result:', success ? '✅ COMPLETED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });