import { createClient } from '@supabase/supabase-js';

async function createTestPoll() {
  console.log('🔧 Creating test poll to reproduce the issue');
  
  const supabase = createClient(
    'https://kfngceqepnzlljkwedtd.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As'
  );

  // Create a poll with candidates A, B, C
  console.log('1. Creating poll...');
  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .insert({
      title: 'Test Borda Tie-Breaker',
      poll_type: 'ranked_choice',
      options: ['A', 'B', 'C'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      short_id: '5'
    })
    .select()
    .single();

  if (pollError) {
    console.log('❌ Poll creation failed:', pollError);
    return;
  }
  
  console.log('✅ Poll created with UUID:', poll.id);
  console.log('   Short ID:', poll.short_id);

  // Create votes that reproduce the user's exact bug scenario
  // A and C should have same Borda scores, B should have higher Borda
  console.log('\n2. Adding votes...');
  
  const votes = [
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'B', 'C'] }, // A=3pts, B=2pts, C=1pt
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'B', 'A'] }, // C=3pts, B=2pts, A=1pt  
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'C', 'A'] }  // B=3pts, C=2pts, A=1pt
  ];
  
  // Vote counts: A=1, B=1, C=1 (all tied for first place)
  // Borda scores: A=3+1+1=5, B=2+2+3=7, C=1+2+2=5
  // B has highest Borda (7), should be safe
  // A and C tied for lowest Borda (5), C should be eliminated alphabetically
  
  for (const vote of votes) {
    const { error: voteError } = await supabase
      .from('votes')
      .insert(vote);
      
    if (voteError) {
      console.log('❌ Vote creation failed:', voteError);
      return;
    }
  }
  
  console.log('✅ Added 3 votes');
  console.log('   Vote patterns create the exact Borda tie scenario');
  console.log('   A and C should have same Borda score (5)');
  console.log('   B should have higher Borda score (7)');
  console.log('   Expected: C eliminated first (alphabetically after A)');

  // Test the winner calculation
  console.log('\n3. Testing winner calculation...');
  const { data: winner, error: calcError } = await supabase
    .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });
    
  if (calcError) {
    console.log('❌ Calculation failed:', calcError);
    return;
  }
  
  console.log('✅ Calculation successful');
  console.log('Winner result:', winner);
  
  // Check the rounds
  console.log('\n4. Checking elimination rounds...');
  const { data: rounds, error: roundsError } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', poll.id)
    .order('round_number', { ascending: true });
    
  if (roundsError) {
    console.log('❌ Rounds fetch failed:', roundsError);
    return;
  }
  
  console.log('✅ Round data loaded successfully');
  rounds.forEach(round => {
    console.log(`Round ${round.round_number}: ${round.option_name} = ${round.vote_count} votes, eliminated: ${round.is_eliminated}, Borda: ${round.borda_score || 'N/A'}`);
  });
  
  // Verify the fix worked correctly
  const round1 = rounds.filter(r => r.round_number === 1);
  const eliminated = round1.find(r => r.is_eliminated);
  
  if (eliminated && eliminated.option_name === 'C') {
    console.log('\n🎉 SUCCESS: Borda tie-breaker fix works correctly!');
    console.log('   C was eliminated first (alphabetically correct among tied Borda scores)');
    console.log('   A and B survived to next round');
  } else if (eliminated && eliminated.option_name === 'A') {
    console.log('\n❌ FAILURE: A was eliminated instead of C');
    console.log('   This indicates the Borda tie-breaker logic still has issues');
  } else {
    console.log('\n❓ UNEXPECTED: Elimination pattern is not as expected');
    console.log('   Eliminated candidate:', eliminated?.option_name || 'none');
  }
  
  console.log(`\n🔗 Test poll URL: http://decisionbot.a.pinggy.link/p/${poll.short_id}`);
  console.log('   You can now test the UI to see if round data loads correctly');
}

createTestPoll().catch(console.error);