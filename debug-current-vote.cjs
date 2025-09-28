const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function debugCurrentVote() {
  console.log('=== CURRENT VOTE STATE AFTER EDIT ===\n');

  // Get latest nomination poll
  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .select('*')
    .eq('poll_type', 'nomination')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (pollError) {
    console.log('Error fetching poll:', pollError);
    return;
  }

  console.log('Poll ID:', poll.id);
  console.log('Created:', poll.created_at);

  // Get the most recent vote
  const { data: votes, error: votesError } = await supabase
    .from('votes')
    .select('*')
    .eq('poll_id', poll.id)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (votesError) {
    console.log('Error fetching votes:', votesError);
    return;
  }

  if (votes.length === 0) {
    console.log('No votes found');
    return;
  }

  const vote = votes[0];
  console.log('\n=== CURRENT VOTE IN DATABASE ===');
  console.log('Vote ID:', vote.id);
  console.log('Nominations:', JSON.stringify(vote.nominations));
  console.log('Created:', vote.created_at);
  console.log('Updated:', vote.updated_at);

  const wasEdited = vote.created_at !== vote.updated_at;
  console.log('Was edited:', wasEdited);

  if (wasEdited) {
    console.log('Edit timestamp difference:',
      Math.round((new Date(vote.updated_at) - new Date(vote.created_at)) / 1000), 'seconds');
  }

  console.log('\n=== ANALYSIS ===');
  if (vote.nominations && Array.isArray(vote.nominations)) {
    console.log('Number of nominations:', vote.nominations.length);
    vote.nominations.forEach((nom, i) => {
      console.log(`  ${i + 1}. "${nom}"`);
    });

    if (vote.nominations.length === 1 && vote.nominations[0] === 'B') {
      console.log('✅ Database shows correct result: just "B"');
    } else if (vote.nominations.length === 2 && vote.nominations.includes('A') && vote.nominations.includes('B')) {
      console.log('❌ Database still shows both A and B - edit failed to save correctly');
    } else {
      console.log('❓ Unexpected result in database');
    }
  } else {
    console.log('❌ Invalid nominations data:', vote.nominations);
  }
}

debugCurrentVote().catch(console.error);