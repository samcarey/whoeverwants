#!/usr/bin/env node

/**
 * Find a poll that actually has multiple nominations to test the display bug
 */

const { createClient } = require('@supabase/supabase-js');

async function findMultiNominationPoll() {
  console.log('🔍 Finding Poll with Multiple Nominations');
  console.log('==========================================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Get all recent polls
    const { data: polls } = await supabase
      .from('polls')
      .select('id, title, poll_type')
      .eq('poll_type', 'nomination')
      .order('created_at', { ascending: false })
      .limit(10);

    console.log(`\n📊 Checking ${polls.length} recent nomination polls:`);

    for (const poll of polls) {
      const { data: votes } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', poll.id)
        .not('nominations', 'is', null);

      // Find votes with multiple nominations
      const multiNominationVotes = votes.filter(vote =>
        vote.nominations && Array.isArray(vote.nominations) && vote.nominations.length > 1
      );

      if (multiNominationVotes.length > 0) {
        console.log(`\n✅ Found poll with multiple nominations:`);
        console.log(`   Poll ID: ${poll.id}`);
        console.log(`   Title: ${poll.title}`);
        console.log(`   Votes with multiple nominations: ${multiNominationVotes.length}`);

        multiNominationVotes.forEach((vote, i) => {
          console.log(`   Vote ${i + 1}: ${JSON.stringify(vote.nominations)}`);
        });

        return poll.id;
      } else if (votes.length > 0) {
        console.log(`   ${poll.id}: ${votes.length} vote(s), max nominations: ${Math.max(...votes.map(v => v.nominations?.length || 0))}`);
      } else {
        console.log(`   ${poll.id}: No votes`);
      }
    }

    console.log('\n❌ No polls found with multiple nominations');
    return null;

  } catch (error) {
    console.error('Search failed:', error.message);
    return null;
  }
}

findMultiNominationPoll()
  .then(pollId => {
    if (pollId) {
      console.log(`\n🎯 Use this poll for testing: ${pollId}`);
      console.log(`   URL: http://localhost:3000/p/${pollId}`);
    } else {
      console.log('\n⚠️ Need to create a poll with multiple nominations first');
    }
  });