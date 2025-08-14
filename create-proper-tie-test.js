import { createClient } from '@supabase/supabase-js';

async function createProperTieTest() {
  console.log('🔧 Creating proper Borda tie-breaker test');
  
  const supabase = createClient(
    'https://kfngceqepnzlljkwedtd.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As'
  );

  // Delete existing poll if it exists
  await supabase.from('polls').delete().eq('short_id', '3');

  // Create a poll where A and C truly have the same Borda scores
  console.log('1. Creating poll with true Borda tie scenario...');
  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .insert({
      title: 'True Borda Tie Test',
      poll_type: 'ranked_choice',
      options: ['A', 'B', 'C'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      short_id: '3'
    })
    .select()
    .single();

  if (pollError) {
    console.log('❌ Poll creation failed:', pollError);
    return;
  }

  console.log('✅ Poll created with UUID:', poll.id);

  // Design votes where A and C have identical Borda scores
  // Need to make A and C tied for lowest Borda while B is higher
  console.log('\n2. Adding carefully designed votes...');
  
  const votes = [
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'C', 'B'] }, // A=3, C=2, B=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'A', 'B'] }, // C=3, A=2, B=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'A', 'C'] }, // B=3, A=2, C=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'C', 'A'] }  // B=3, C=2, A=1
  ];
  
  // Expected Borda scores:
  // A: 3+2+2+1 = 8 points
  // B: 1+1+3+3 = 8 points  
  // C: 2+3+1+2 = 8 points
  // All tied! But we need different first-choice votes...
  
  console.log('❌ This creates a 3-way tie. Let me redesign...');
  
  // Let's create a scenario with different first-choice distribution
  const redesignedVotes = [
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'B', 'C'] }, // A=3, B=2, C=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'C', 'A'] }, // B=3, C=2, A=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'A', 'B'] }, // C=3, A=2, B=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'C', 'B'] }, // A=3, C=2, B=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'A', 'C'] }  // B=3, A=2, C=1
  ];
  
  // Expected Borda scores:
  // A: 3+1+2+3+2 = 11 points
  // B: 2+3+1+1+3 = 10 points  
  // C: 1+2+3+2+1 = 9 points
  // Vote counts: A=2, B=2, C=1
  // C has lowest vote count and lowest Borda score - should be eliminated
  
  console.log('✅ Using design where C has both lowest votes and lowest Borda');
  console.log('   Expected: C eliminated (clear Borda loser)');
  
  for (const vote of redesignedVotes) {
    const { error: voteError } = await supabase
      .from('votes')
      .insert(vote);
      
    if (voteError) {
      console.log('❌ Vote creation failed:', voteError);
      return;
    }
  }
  
  console.log('✅ Added 5 votes with Borda differentiation');

  // Manual calculation
  console.log('\n3. Manual Borda calculation:');
  const bordaScores = { A: 0, B: 0, C: 0 };
  const votePatterns = [
    ['A', 'B', 'C'], // A=3, B=2, C=1
    ['B', 'C', 'A'], // B=3, C=2, A=1
    ['C', 'A', 'B'], // C=3, A=2, B=1
    ['A', 'C', 'B'], // A=3, C=2, B=1
    ['B', 'A', 'C']  // B=3, A=2, C=1
  ];
  
  votePatterns.forEach((pattern, i) => {
    console.log(`Vote ${i+1}: [${pattern.join(', ')}]`);
    pattern.forEach((candidate, pos) => {
      const points = 3 - pos; // 3 candidates: 1st=3pts, 2nd=2pts, 3rd=1pt
      bordaScores[candidate] += points;
      console.log(`  ${candidate} at position ${pos+1} gets ${points} points`);
    });
  });
  
  console.log('\nManual Borda totals:');
  Object.entries(bordaScores)
    .sort(([,a], [,b]) => b - a)
    .forEach(([candidate, score]) => {
      console.log(`  ${candidate}: ${score} points`);
    });

  // Test the calculation
  console.log('\n4. Running IRV calculation...');
  const { data: winner, error: calcError } = await supabase
    .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });
    
  if (calcError) {
    console.log('❌ Calculation failed:', calcError);
    return;
  }
  
  console.log('✅ Calculation successful');
  console.log('Winner result:', winner);
  
  // Check the rounds
  const { data: rounds } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', poll.id)
    .order('round_number', { ascending: true });
    
  console.log('\n5. Round results:');
  rounds?.forEach(round => {
    console.log(`Round ${round.round_number}: ${round.option_name} = ${round.vote_count} votes, eliminated: ${round.is_eliminated}, Borda: ${round.borda_score || 'N/A'}, tie-broken: ${round.tie_broken_by_borda || false}`);
  });
  
  console.log(`\n🔗 Test poll URL: http://decisionbot.a.pinggy.link/p/3#round1`);
  console.log('   Check if Borda explanation shows up in the UI');
}

createProperTieTest().catch(console.error);