#!/usr/bin/env node

/**
 * Check database state for the specific contaminated poll
 */

const { createClient } = require('@supabase/supabase-js');

async function checkSpecificPoll() {
  console.log('🔍 Checking Specific Contaminated Poll');
  console.log('=====================================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || '';
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const contaminatedPollId = '72fab48b-876c-4323-a816-b16123c4043d';

    console.log(`✅ Checking poll: ${contaminatedPollId}`);

    // Get poll data
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .select('*')
      .eq('id', contaminatedPollId)
      .single();

    if (pollError) {
      console.error('❌ Error fetching poll:', pollError);
      return false;
    }

    console.log('\n📊 Poll Data:');
    console.log(`   Title: "${poll.title}"`);
    console.log(`   Type: ${poll.poll_type}`);
    console.log(`   Options: ${JSON.stringify(poll.options)}`);
    console.log(`   Created: ${poll.created_at}`);

    // Get all votes for this poll
    const { data: votes, error: votesError } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', contaminatedPollId)
      .order('created_at', { ascending: false });

    if (votesError) {
      console.error('❌ Error fetching votes:', votesError);
      return false;
    }

    console.log(`\n📊 Votes for this poll: ${votes.length}`);
    if (votes.length > 0) {
      votes.forEach((vote, i) => {
        console.log(`   Vote ${i + 1}:`);
        console.log(`     ID: ${vote.id}`);
        console.log(`     Type: ${vote.vote_type}`);
        console.log(`     Nominations: ${JSON.stringify(vote.nominations)}`);
        console.log(`     Is Abstain: ${vote.is_abstain}`);
        console.log(`     Voter: ${vote.voter_name || 'Anonymous'}`);
        console.log(`     Created: ${vote.created_at}`);
        console.log(`     Updated: ${vote.updated_at}`);
        console.log('');
      });

      // Test the same query that loadExistingNominations uses
      console.log('\n🔍 Testing loadExistingNominations query:');
      const { data: nominationVotes, error: nomError } = await supabase
        .from('votes')
        .select('id, nominations, voter_name, created_at, updated_at, is_abstain')
        .eq('poll_id', contaminatedPollId)
        .not('nominations', 'is', null)
        .eq('is_abstain', false)
        .order('updated_at', { ascending: false })
        .limit(100);

      if (nomError) {
        console.error('   ❌ Query error:', nomError);
      } else {
        console.log(`   ✅ Query returned ${nominationVotes.length} votes`);

        if (nominationVotes.length > 0) {
          console.log('   📋 Nomination votes found:');
          nominationVotes.forEach((vote, i) => {
            console.log(`     ${i + 1}. ${JSON.stringify(vote.nominations)} (ID: ${vote.id.slice(0,8)}...)`);
          });

          // Count nominations like the frontend does
          const allNominations = new Set();
          nominationVotes.forEach(vote => {
            if (vote.nominations && Array.isArray(vote.nominations)) {
              vote.nominations.forEach(nom => allNominations.add(nom));
            }
          });

          console.log(`   🎯 Aggregated nominations: ${JSON.stringify(Array.from(allNominations))}`);

          if (allNominations.has('A') || allNominations.has('B')) {
            console.log('\n🎯 SOURCE FOUND!');
            console.log('   The database DOES contain nominations A and/or B');
            console.log('   This explains why they appear in the frontend');
          }
        } else {
          console.log('   ❓ Query returned no votes, but frontend shows A and B');
          console.log('   This suggests a query issue or caching problem');
        }
      }
    } else {
      console.log('   ❓ No votes found, but frontend shows A and B');
      console.log('   This suggests the nominations are coming from somewhere else');
    }

    return true;

  } catch (error) {
    console.error('\n❌ Check failed with error:', error.message);
    return false;
  }
}

// Run the check
checkSpecificPoll()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Check Result:', success ? '✅ COMPLETED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });