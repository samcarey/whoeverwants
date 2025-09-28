#!/usr/bin/env node

/**
 * Debug what poll.options contains for nomination polls
 */

const { createClient } = require('@supabase/supabase-js');

async function debugPollOptions() {
  console.log('🔍 Debug Poll Options for Nomination Polls');
  console.log('===========================================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Get our test poll
    const pollId = '12006c39-055b-4fea-8afd-dc061efbf891'; // From our API test
    
    // Check poll_results view (this is what PollResults component receives)
    console.log('\n📊 Checking poll_results view...');
    const { data: pollResults } = await supabase
      .from('poll_results')
      .select('*')
      .eq('poll_id', pollId)
      .single();
      
    console.log('Poll Results Data:');
    console.log(`   poll_type: ${pollResults.poll_type}`);
    console.log(`   options: ${JSON.stringify(pollResults.options)}`);
    console.log(`   options type: ${typeof pollResults.options}`);
    
    if (pollResults.options) {
      const parsedOptions = typeof pollResults.options === 'string' 
        ? JSON.parse(pollResults.options) 
        : pollResults.options;
      console.log(`   parsed options: ${JSON.stringify(parsedOptions)}`);
      console.log(`   parsed options length: ${parsedOptions?.length || 0}`);
    }

    // Check original polls table
    console.log('\n📊 Checking original polls table...');
    const { data: poll } = await supabase
      .from('polls')
      .select('*')
      .eq('id', pollId)
      .single();
      
    console.log('Original Poll Data:');
    console.log(`   poll_type: ${poll.poll_type}`);
    console.log(`   options: ${JSON.stringify(poll.options)}`);
    console.log(`   options type: ${typeof poll.options}`);

    // Check votes for this poll
    console.log('\n🗳️ Checking votes...');
    const { data: votes } = await supabase
      .from('votes')
      .select('nominations, is_abstain')
      .eq('poll_id', pollId)
      .eq('vote_type', 'nomination')
      .eq('is_abstain', false)
      .not('nominations', 'is', null);
      
    console.log(`Votes: ${votes.length}`);
    votes.forEach((vote, i) => {
      console.log(`   Vote ${i + 1}: ${JSON.stringify(vote.nominations)}`);
    });

  } catch (error) {
    console.error('Debug failed:', error.message);
  }
}

debugPollOptions();
