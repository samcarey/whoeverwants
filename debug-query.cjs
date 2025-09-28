#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

async function debugQuery() {
  console.log('🔍 Debugging Results Query...');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  const pollId = '00748a10-394c-4b40-a4b1-8c9211e2c53a';
  
  console.log('\n📊 Query 1: All votes for this poll');
  const { data: allVotes } = await supabase
    .from('votes')
    .select('id, is_abstain, nominations, vote_type, created_at, updated_at')
    .eq('poll_id', pollId)
    .order('created_at');
    
  allVotes.forEach(vote => {
    console.log(`   Vote ${vote.id.slice(0,8)}: is_abstain=${vote.is_abstain}, nominations=${JSON.stringify(vote.nominations)}, updated=${vote.created_at !== vote.updated_at}`);
  });
  
  console.log('\n📊 Query 2: Non-abstain votes (our problematic query)');
  const { data: nonAbstainVotes } = await supabase
    .from('votes')
    .select('*')
    .eq('poll_id', pollId)
    .eq('is_abstain', false)
    .not('nominations', 'is', null);
    
  console.log(`   Count: ${nonAbstainVotes.length}`);
  nonAbstainVotes.forEach(vote => {
    console.log(`   Vote ${vote.id.slice(0,8)}: is_abstain=${vote.is_abstain}, nominations=${JSON.stringify(vote.nominations)}`);
  });
  
  console.log('\n📊 Query 3: Abstain votes');
  const { data: abstainVotes } = await supabase
    .from('votes')
    .select('*')
    .eq('poll_id', pollId)
    .eq('is_abstain', true);
    
  console.log(`   Count: ${abstainVotes.length}`);
  abstainVotes.forEach(vote => {
    console.log(`   Vote ${vote.id.slice(0,8)}: is_abstain=${vote.is_abstain}, nominations=${JSON.stringify(vote.nominations)}`);
  });
  
  console.log('\n📊 Query 4: Votes with SimpleTest nomination');
  const { data: simpleTestVotes } = await supabase
    .from('votes')
    .select('*')
    .eq('poll_id', pollId)
    .contains('nominations', ['SimpleTest']);
    
  console.log(`   Count: ${simpleTestVotes.length}`);
  simpleTestVotes.forEach(vote => {
    console.log(`   Vote ${vote.id.slice(0,8)}: is_abstain=${vote.is_abstain}, nominations=${JSON.stringify(vote.nominations)}, updated=${vote.created_at !== vote.updated_at}`);
  });
}

debugQuery().catch(console.error);
