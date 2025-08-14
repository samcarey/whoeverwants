import { createClient } from '@supabase/supabase-js';

async function debugPoll5() {
  console.log('🔍 Debugging Poll ID 5 Issue');
  
  const supabase = createClient(
    'https://kfngceqepnzlljkwedtd.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As'
  );

  // Check if poll with short_id "5" exists
  console.log('1. Checking if poll with short_id "5" exists...');
  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .select('*')
    .eq('short_id', '5')
    .single();

  console.log('Poll 5 exists:', poll ? 'YES' : 'NO');
  if (pollError) {
    console.log('Poll error:', pollError);
    return;
  }
  
  if (!poll) {
    console.log('❌ Poll 5 not found');
    return;
  }
  
  console.log('Poll details:');
  console.log('  Type:', poll.poll_type);
  console.log('  Title:', poll.title);
  console.log('  Options:', poll.options);
  
  // Check votes for this poll
  console.log('\n2. Checking votes for poll 5...');
  const { data: votes, error: votesError } = await supabase
    .from('votes')
    .select('*')
    .eq('poll_id', poll.id);
    
  console.log('Votes count:', votes ? votes.length : 0);
  if (votesError) console.log('Votes error:', votesError);
  
  if (poll.poll_type === 'ranked_choice') {
    // Check existing round data
    console.log('\n3. Checking existing round data...');
    const { data: rounds, error: roundsError } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number', { ascending: true });
      
    console.log('Existing rounds:', rounds ? rounds.length + ' rounds found' : 'NO rounds');
    if (roundsError) console.log('Rounds error:', roundsError);
    
    if (rounds && rounds.length > 0) {
      console.log('Round details:');
      rounds.forEach(round => {
        console.log(`  Round ${round.round_number}: ${round.option_name} = ${round.vote_count} votes, eliminated: ${round.is_eliminated}`);
      });
    }
    
    // Try the winner calculation function
    console.log('\n4. Testing winner calculation...');
    const { data: winner, error: calcError } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });
      
    console.log('Winner calculation result:', winner);
    if (calcError) {
      console.log('❌ Calculation error:', calcError);
      console.log('Full error details:', JSON.stringify(calcError, null, 2));
    } else {
      console.log('✅ Calculation successful');
    }
    
    // Check round data after calculation
    console.log('\n5. Checking round data after calculation...');
    const { data: newRounds, error: newRoundsError } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number', { ascending: true });
      
    console.log('Post-calc rounds:', newRounds ? newRounds.length + ' rounds found' : 'NO rounds');
    if (newRoundsError) console.log('New rounds error:', newRoundsError);
    
    if (newRounds && newRounds.length > 0) {
      console.log('Updated round details:');
      newRounds.forEach(round => {
        console.log(`  Round ${round.round_number}: ${round.option_name} = ${round.vote_count} votes, eliminated: ${round.is_eliminated}, borda: ${round.borda_score || 'N/A'}`);
      });
    }
  }
}

debugPoll5().catch(console.error);