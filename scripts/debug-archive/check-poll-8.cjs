const { createClient } = require('@supabase/supabase-js');

(async () => {
const supabase = createClient(
  'https://kfngceqepnzlljkwedtd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As'
);

// Check poll 8
const { data: poll } = await supabase.from('polls').select('*').eq('short_id', '8').single();

if (!poll) {
  console.log('Poll 8 does not exist, creating it...');
  
  const { data: newPoll, error } = await supabase
    .from('polls')
    .insert({
      title: 'Test Poll 8',
      poll_type: 'ranked_choice', 
      options: ['A', 'B', 'C'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      short_id: '8'
    })
    .select()
    .single();

  if (error) throw error;
  
  // Create votes where A and C have same Borda score
  const votes = [
    ['A', 'B', 'C'], // A=3, B=2, C=1
    ['C', 'B', 'A'], // C=3, B=2, A=1  
    ['B', 'A', 'C'], // B=3, A=2, C=1
    ['B', 'C', 'A']  // B=3, C=2, A=1
  ];
  
  // Expected: A=3+1+2+1=7, B=2+2+3+3=10, C=1+3+1+2=7
  // A and C tied at 7, B higher at 10
  // Vote counts: A=1, B=2, C=1 (A and C tied for lowest votes)
  // Should eliminate A alphabetically
  
  for (const votePattern of votes) {
    await supabase.from('votes').insert({
      poll_id: newPoll.id,
      vote_type: 'ranked_choice',
      ranked_choices: votePattern
    });
  }
  
  await supabase.rpc('calculate_ranked_choice_winner', { target_poll_id: newPoll.id });
  
  console.log('Created poll 8 with A-C Borda tie scenario');
}

const { data: rounds } = await supabase
  .from('ranked_choice_rounds') 
  .select('*')
  .eq('poll_id', poll ? poll.id : newPoll.id)
  .eq('round_number', 1)
  .order('borda_score', { ascending: false });

console.log('Round 1 results:');
rounds?.forEach(r => 
  console.log(`  ${r.option_name}: ${r.borda_score} Borda, eliminated: ${r.is_eliminated}, tie-broken: ${r.tie_broken_by_borda}`)
);

const eliminatedCandidate = rounds?.find(r => r.is_eliminated);
const survivors = rounds?.filter(r => !r.is_eliminated) || [];

if (eliminatedCandidate) {
  console.log(`\nEliminated: ${eliminatedCandidate.option_name} with Borda score ${eliminatedCandidate.borda_score}`);
  
  const sameScoreSurvivors = survivors.filter(s => s.borda_score === eliminatedCandidate.borda_score);
  
  if (sameScoreSurvivors.length > 0) {
    console.log(`❌ BUG CONFIRMED: ${eliminatedCandidate.option_name} eliminated but ${sameScoreSurvivors.map(s => s.option_name).join(', ')} have same Borda score!`);
    console.log(`   This should be "alphabetical order" not "Borda count" in the explanation`);
  } else {
    console.log(`✅ Correct: ${eliminatedCandidate.option_name} had lowest Borda score`);
  }
}

console.log('\nURL: http://decisionbot.a.pinggy.link/p/8#round1');
})();