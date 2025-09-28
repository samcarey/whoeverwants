const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY
);

async function checkVoteConstraints() {
  console.log('Checking constraints on votes table...\n');

  // First, let's try to insert a test nomination vote to see the exact error
  const testVote = {
    poll_id: '56f230a1-d4ab-45de-b219-f0bf55215b42',
    vote_type: 'nomination',
    nominations: ['Test'],
    is_abstain: false,
    voter_name: 'Test User'
  };

  console.log('Attempting to insert test nomination vote:', testVote);

  const { data: insertData, error: insertError } = await supabase
    .from('votes')
    .insert([testVote])
    .select();

  if (insertError) {
    console.log('\n❌ Insert failed with error:');
    console.log('  Code:', insertError.code);
    console.log('  Message:', insertError.message);
    console.log('  Details:', insertError.details);
    console.log('  Hint:', insertError.hint);

    // Extract constraint name from error message
    const constraintMatch = insertError.message.match(/violates check constraint "([^"]+)"/);
    if (constraintMatch) {
      console.log('\n🔍 Problematic constraint:', constraintMatch[1]);
    }
  } else {
    console.log('✅ Test vote inserted successfully!');
    // Clean up test vote
    if (insertData && insertData[0]) {
      await supabase.from('votes').delete().eq('id', insertData[0].id);
      console.log('Cleaned up test vote.');
    }
  }

  // Try to get table structure
  console.log('\n📊 Checking table structure...');
  const { data: sampleVote, error: selectError } = await supabase
    .from('votes')
    .select('*')
    .limit(1);

  if (!selectError && sampleVote) {
    console.log('Sample vote columns:', Object.keys(sampleVote[0] || {}));
  }

  // Check if we can query votes with nomination type
  console.log('\n🔍 Checking existing nomination votes...');
  const { data: nominationVotes, error: nomError, count } = await supabase
    .from('votes')
    .select('id, poll_id, vote_type, nominations, is_abstain', { count: 'exact' })
    .eq('vote_type', 'nomination')
    .limit(5);

  if (!nomError) {
    console.log(`Found ${count || 0} nomination votes in database`);
    if (nominationVotes && nominationVotes.length > 0) {
      console.log('Sample nomination vote:', nominationVotes[0]);
    }
  } else {
    console.log('Error querying nomination votes:', nomError.message);
  }
}

checkVoteConstraints().catch(console.error);