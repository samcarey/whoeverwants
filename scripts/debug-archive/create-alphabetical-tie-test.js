import { createClient } from '@supabase/supabase-js';

async function createAlphabeticalTieTest() {
  console.log('🔧 Creating alphabetical tie-breaker test');
  
  const supabase = createClient(
    'https://kfngceqepnzlljkwedtd.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As'
  );

  // Delete existing polls
  await supabase.from('polls').delete().eq('short_id', '6');

  console.log('1. Creating poll for alphabetical tie-breaker test...');
  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .insert({
      title: 'Alphabetical Tie-Breaker Test',
      poll_type: 'ranked_choice',
      options: ['A', 'B', 'C'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      short_id: '6'
    })
    .select()
    .single();

  if (pollError) {
    console.log('❌ Poll creation failed:', pollError);
    return;
  }

  // Design votes where A and C have identical Borda scores but both have lowest votes
  console.log('\n2. Designing votes for A-C Borda tie...');
  
  const votes = [
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'C', 'B'] }, // A=3, C=2, B=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'A', 'B'] }, // C=3, A=2, B=1  
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'A', 'C'] }, // B=3, A=2, C=1
    { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'C', 'A'] }  // B=3, C=2, A=1
  ];
  
  // Expected results:
  // Vote counts: A=1, B=2, C=1 (A and C tied for lowest votes)
  // Borda scores: 
  //   A: 3+2+2+1 = 8 points
  //   C: 2+3+1+2 = 8 points  
  //   B: 1+1+3+3 = 8 points
  // All have same Borda! Need to redesign...
  
  console.log('❌ That creates 3-way Borda tie. Redesigning...');
  
  // Try with 4 candidates to create more differentiation
  await supabase.from('polls').delete().eq('short_id', '6');
  
  const { data: poll4, error: poll4Error } = await supabase
    .from('polls')
    .insert({
      title: 'Alphabetical Tie-Breaker Test (4 candidates)',
      poll_type: 'ranked_choice',
      options: ['A', 'B', 'C', 'D'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      short_id: '6'
    })
    .select()
    .single();

  if (poll4Error) {
    console.log('❌ 4-candidate poll creation failed:', poll4Error);
    return;
  }

  // Design with 4 candidates where A and C are tied for lowest Borda
  const votes4 = [
    { poll_id: poll4.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'D', 'A', 'C'] }, // B=4, D=3, A=2, C=1
    { poll_id: poll4.id, vote_type: 'ranked_choice', ranked_choices: ['D', 'B', 'C', 'A'] }, // D=4, B=3, C=2, A=1
    { poll_id: poll4.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'C', 'B', 'D'] }, // A=4, C=3, B=2, D=1
    { poll_id: poll4.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'A', 'D', 'B'] }  // C=4, A=3, D=2, B=1
  ];
  
  // Expected Borda scores (4 candidates = 4,3,2,1 points):
  // A: 2+1+4+3 = 10 points
  // B: 4+3+2+1 = 10 points
  // C: 1+2+3+4 = 10 points  
  // D: 3+4+1+2 = 10 points
  // Still all tied! This is tricky...
  
  console.log('❌ 4-way tie again. Let me try strategic asymmetric voting...');
  
  // Strategic design: Make B and D clearly higher, A and C tied for lowest
  const strategicVotes = [
    { poll_id: poll4.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'D', 'A', 'C'] }, // B=4, D=3, A=2, C=1
    { poll_id: poll4.id, vote_type: 'ranked_choice', ranked_choices: ['D', 'B', 'C', 'A'] }, // D=4, B=3, C=2, A=1
    { poll_id: poll4.id, vote_type: 'ranked_choice', ranked_choices: ['B', 'D', 'C', 'A'] }, // B=4, D=3, C=2, A=1
    { poll_id: poll4.id, vote_type: 'ranked_choice', ranked_choices: ['D', 'B', 'A', 'C'] }  // D=4, B=3, A=2, C=1
  ];
  
  // Expected Borda scores:
  // A: 2+1+1+2 = 6 points
  // B: 4+3+4+3 = 14 points
  // C: 1+2+2+1 = 6 points
  // D: 3+4+3+4 = 14 points
  // Vote counts: All tied at 0 first-place votes
  // A and C tied for lowest Borda (6), C should be eliminated alphabetically
  
  console.log('✅ Using strategic design: B and D high Borda, A and C tied low Borda');
  console.log('   Expected: C eliminated (alphabetical tie-breaker among A and C)');
  
  for (const vote of strategicVotes) {
    const { error: voteError } = await supabase
      .from('votes')
      .insert(vote);
      
    if (voteError) {
      console.log('❌ Vote creation failed:', voteError);
      return;
    }
  }
  
  console.log('✅ Added 4 strategic votes');

  // Manual verification
  console.log('\n3. Manual Borda calculation:');
  const bordaScores = { A: 0, B: 0, C: 0, D: 0 };
  const votePatterns = [
    ['B', 'D', 'A', 'C'], // B=4, D=3, A=2, C=1
    ['D', 'B', 'C', 'A'], // D=4, B=3, C=2, A=1
    ['B', 'D', 'C', 'A'], // B=4, D=3, C=2, A=1
    ['D', 'B', 'A', 'C']  // D=4, B=3, A=2, C=1
  ];
  
  votePatterns.forEach((pattern, i) => {
    console.log(`Vote ${i+1}: [${pattern.join(', ')}]`);
    pattern.forEach((candidate, pos) => {
      const points = 4 - pos; // 4 candidates: 1st=4pts, 2nd=3pts, 3rd=2pts, 4th=1pt
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
    .rpc('calculate_ranked_choice_winner', { target_poll_id: poll4.id });
    
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
    .eq('poll_id', poll4.id)
    .order('round_number', { ascending: true })
    .order('borda_score', { ascending: false });
    
  console.log('\n5. Round results:');
  rounds?.forEach(round => {
    console.log(`Round ${round.round_number}: ${round.option_name} = ${round.vote_count} votes, eliminated: ${round.is_eliminated}, Borda: ${round.borda_score || 'N/A'}, tie-broken: ${round.tie_broken_by_borda || false}`);
  });
  
  const firstRoundEliminated = rounds?.find(r => r.round_number === 1 && r.is_eliminated);
  
  if (firstRoundEliminated) {
    const tiedCandidates = rounds?.filter(r => 
      r.round_number === 1 && 
      r.borda_score === firstRoundEliminated.borda_score
    );
    
    if (tiedCandidates && tiedCandidates.length > 1) {
      console.log(`\n🎯 SUCCESS: Found ${tiedCandidates.length} candidates tied at ${firstRoundEliminated.borda_score} Borda points`);
      console.log(`   Candidates: ${tiedCandidates.map(c => c.option_name).join(', ')}`);
      console.log(`   Eliminated: ${firstRoundEliminated.option_name} (should be alphabetically first among tied)`);
      
      const sortedAlphabetically = tiedCandidates.map(c => c.option_name).sort();
      const expectedEliminated = sortedAlphabetically[0];
      
      if (firstRoundEliminated.option_name === expectedEliminated) {
        console.log(`   ✅ CORRECT: ${expectedEliminated} was eliminated (alphabetically first)`);
      } else {
        console.log(`   ❌ INCORRECT: Expected ${expectedEliminated} to be eliminated, but ${firstRoundEliminated.option_name} was eliminated`);
      }
    }
  }
  
  console.log(`\n🔗 Test poll URL: http://decisionbot.a.pinggy.link/p/6#round1`);
  console.log('   Check if Borda tie-breaker explanation shows up in the UI');
}

createAlphabeticalTieTest().catch(console.error);